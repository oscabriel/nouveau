# Draft: one extraction pipeline that writes structured facts at crawl time

**Status: draft, not decided.** Written 2026-09-15 from `.agents/research/extraction-audit.md`. The owner decides; the audit is the evidence.

## The situation

Two systems read roaster copy. Crawl-time (`extraction.ts`) parses products.json into `lotCopy` with regex over tags and prose and writes it to `products` every hour. Request-time (`recommendationWorker.ts`, `recommendationRules.ts`) scrapes up to two product pages per Find-my-next-bag run with Firecrawl's JSON extraction against a richer schema (process, variety, region, elevation, producer, roast level, tasting notes), verifies each value verbatim against the page markdown, and stores the result as prose passages in `recommendationEvidence` for 24 hours. It also rebuilds `catalogPassages` from `products.description` on every request. Nothing from the second system reaches `products`.

The audit found that the facts the second system fetches per request are in the feed for about half the roasters (tags, titles, `body_html` lines and tables) and on the page only for six (Onyx, Sey, Intelligentsia, Merit, Counter Culture, Stumptown). It also found that Firecrawl's extraction is deterministic for fields with a shape (elevation, process, region, tasting notes were identical across paired runs on five pages) and drifts for open prose (producer, sentences), and that the verbatim check alone lets a wrong-field value through (`roastLevel: "Espresso"`).

## Option A: unify

Crawl-time extraction becomes the only writer of facts. It reads tags, titles, body lines and tables into typed columns (`origin[]`, `process[]`, `roastLevel`, `variety`, `region`, `elevation`, `producer`, `roasterNotes[]`) through one per-field shape verifier. For the six page-only roasters, a lot's first sighting also schedules one Firecrawl json scrape whose values pass the same verbatim-plus-shape verifier and land in a page-owned `pageFacts` object with `copyFetchedAt`, so the next feed crawl cannot clear them. The recommendation path reads the columns, builds its fact passage from them (`Process: Washed. Variety: Heirloom. Tasting notes: a, b, c.`), and scrapes only when a candidate has neither feed facts nor `pageFacts`. `catalogPassages` shrinks to the description-sentence part; the label-run mapper from #21/#24 moves to crawl time where it belongs.

Consequences: lot pages and cards get attributes for 19 of 20 roasters instead of 3; Find my next bag stops spending 10 credits per run and its evidence stops expiring every 24 hours; there is one vocabulary for `process` whether it came from a tag or a page; and every extractor change is a catalog correction that needs `rebaselineSource` discipline, same as today. Cost: one migration (`roasterNotes` to `string[]`), new optional columns, ~120 scrapes once and ~100 credits a week after, and the risk that a verifier bug writes a wrong fact into a column that a card shows as the roaster's words. The verifier must be strict enough that an unverified value is dropped, never stored as if verified.

## Option B: keep two systems, share the verifier

Crawl-time gains the feed-side coverage fixes (origin, process, roast level, notes) and nothing page-derived. Request-time keeps scraping, but its `extractedPassages` uses the same shape verifier as the feed path so `Espresso` cannot become a roast level. `products` gains no page facts.

Consequences: smaller change, no migration, no new credit spend at crawl time. Six roasters' lot pages stay thin (Onyx, the demo's favorite, shows no process or notes on its own page). Recommendation evidence stays a 24-hour cache rebuilt per request. Two code paths keep drifting apart, as they already have (the label-run mapper exists only on the request side).

## Option C: unify, but page enrichment on demand

As A, except the page scrape is not scheduled at first sighting. It runs the first time anyone looks at the lot (lot page load, recommendation candidate), writes `pageFacts`, and the row is enriched from then on. Same schema and verifier as A.

Consequences: credits scale with attention, not catalog size; a lot nobody looks at is never scraped. Lot pages show a "loading roaster facts" state on first view, which is fine for a page and awkward for a card in a feed. The feed card would show feed facts only, which after the coverage fixes is enough for a card.

## What decides it

- If the demo needs Onyx's lot page to show process, variety and notes, A or C.
- If the week has room for one migration and one new action, A. If not, C is the same schema with less plumbing now.
- B is the fallback if the owner wants zero risk of a stored wrong fact before the video. The feed-side coverage fixes ship either way.

## Recommendation from the audit

C, with A's schema. The verifier and the schema are the real decision; when the scrape runs is a scheduling detail that can flip later without a migration. Write the ADR as decided only after the owner reads the audit.
