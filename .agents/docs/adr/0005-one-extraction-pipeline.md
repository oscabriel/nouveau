# One extraction pipeline writes structured facts at crawl time; page enrichment runs on demand

Decided 2026-09-15 (owner, closing issue #32). Evidence: `.agents/research/extraction-audit.md` (§3 where facts live, §4 determinism, §5 schema, §11 change list). Decision: Option C with A's schema.

Scheduling amended by ADR-0008 (2026-09-18): the page read now also runs at crawl time for thin lots, from the shop's own page first. The schema and verifier decisions below stand.

Two systems read roaster copy today: crawl-time regex into `lotCopy` (`extraction.ts`) and request-time Firecrawl json extraction into 24-hour `recommendationEvidence` passages (`recommendationRules.ts`). The second system's facts never reach `products`, so lot pages show attributes for 3 of 20 roasters, Find-my-next-bag spends ~10 credits per run, and evidence expires daily. The audit found the page is the only source for variety, elevation, producer and tasting notes at six roasters (Onyx, Sey, Intelligentsia, Merit, Counter Culture, Stumptown), and that Firecrawl extraction is stable for shaped fields but drifts on prose and lets a wrong-field value through the verbatim check (`roastLevel: "Espresso"`).

## Decision

Crawl-time extraction becomes the only writer of structured facts on `products`, with one per-field shape verifier shared by both the feed and page paths (shapes in audit §4). A page scrape is **not** scheduled at a lot's first sighting; it runs the first time anyone looks at the lot (lot page load, recommendation candidate), writes `pageFacts`, and the row is enriched from then on. Credits scale with attention, not catalog size.

The schema pieces, as proposed in the audit and approved here:

- `roasterNotes: string[]` (migration via `@convex-dev/migrations`).
- New optional `variety`, `region`, `elevation`, `producer`, `productType` on `products`.
- `origin` and `process` become multi-valued (joined string is acceptable this week).
- `pageFacts?: { process?, variety?, region?, elevation?, producer?, roastLevel?, tastingNotes?: string[] }` plus `copyFetchedAt` on the row. Owned by the page scrape, never touched by the feed write. The feed write continues to clear absent fields in the plain columns, which is right for feed facts.
- One shared shape verifier. An unverified value is dropped, never stored as if verified. Feed values pass the same gate as page values.

## Why C over A and B

- **Against A** (enrich at first sighting): A spends ~600 credits once and ~100 a week scraping lots nobody views, plus the scheduling plumbing, inside a week that also owes a demo video. The schema is identical, so the difference is only when the scrape fires.
- **Against B** (keep two systems): six roasters' lot pages stay thin (Onyx, the demo's favorite, shows no process or notes on its own page), and two code paths keep drifting apart, which is how the request-side-only label-run mapper happened.
- The verifier and the schema are the real decision; when the scrape runs is a scheduling detail. C can flip to A without a migration.

## Consequences

- Lot pages and cards get attributes for 19 of 20 roasters after the feed-side coverage fixes (#27–#31, all shipped).
- The recommendation path reads `pageFacts` first and scrapes only when a candidate has neither feed facts nor `pageFacts`, so its per-request Firecrawl calls mostly disappear.
- Every extractor change becomes a catalog correction needing `rebaselineSource`, same as today.
- A wrong fact that passes the verifier is stored in a column a card shows as the roaster's words; strictness of the verifier is the guard, not provenance display.
- The crawl-time page pass (audit §11 item 7) is unblocked by this ADR but is its own change, sequenced after the schema migration (item 6).
