# Hackathon log

- **Project:** nouveau
- **Event:** Convex All Gas Hackathon
- **What it does:** A coffee memory for home brewers. Log the lots you tried, ask Find my next bag for a shortlist of coffees in stock right now (OpenAI compares them to your logs using the roaster's own words, fetched with Firecrawl), save the ones you want to try, and watch roasters so AgentMail emails you when a new lot drops, one comes back in stock, or a price falls.
- **Demo:** _video link to be added at submission (Task 6)_
- **Live app:** https://nouveau.coffee (https://artful-chameleon-402.convex.site)
- **Repo:** https://github.com/oscabriel/nouveau
- **Frontend:** Convex static hosting
- **Convex deployment:** https://api.nouveau.coffee (https://artful-chameleon-402.convex.cloud)
- **Components:** @agentmail/convex, @convex-dev/aggregate, @convex-dev/auth (core + Google OAuth), @convex-dev/rate-limiter, @convex-dev/static-hosting, @convex-dev/workpool, @firecrawl/firecrawl-convex
- **Convex features:** schema, indexes, queries, mutations, actions, crons, scheduled functions, file storage, realtime queries, HTTP actions, workpool
- **Auth:** Convex Auth
- **AI models:** OpenAI `gpt-5.6-luna` (Responses API, low reasoning effort, strict JSON schema) for Find my next bag, live in prod at `/next-bag`. TypeSafe System One `jev-1.13.0` (`convex/jev.ts`) picks one verified span per fact field from a product page and shadow-checks the lot classifier. Product pages are read with a plain fetch first; Firecrawl's markdown scrape is the fallback.
- **Started:** 2026-08-29T18:06:09Z
- **Last updated:** 2026-09-19T17:26:21Z

## Log

### 2026-08-29 - 4be892a

Scaffolded with Better-T-Stack: a Turborepo monorepo (bun workspaces) with a TanStack Router + Tailwind web app (`apps/web/`), shared `ui`/`env`/`config` packages, and a Convex backend (`packages/backend/convex/`), linted by ultracite. Template demo so far: a todos table with a list query and create/toggle mutations over realtime `useQuery`/`useMutation`, plus a health-check query.

### 2026-08-29 - working tree

Set up the agent environment: project `AGENTS.md` and `.agents/` docs (Convex guidelines, issue tracker, hackathon build-log skill), pi-mcp-adapter with the Convex MCP server. Global Convex skills were installed and removed in favor of the project-local docs. No deployment or hosting component yet.

### 2026-08-29 - d554214

Toolchain pass: TypeScript 7.0.2 (the native compiler), ultracite 7.10.7 with oxfmt 0.65, all workspace deps refreshed, and the new function-style lint rules adopted across app code. No product behavior change.

### 2026-08-29 - a37561b

Deployed to production on Convex static hosting. Registered the @convex-dev/static-hosting component (owns `/`, app HTTP endpoints reserved under `/api`), added a root `convex.json` so the Convex CLI and MCP server work from the repo root, and pinned the deploy script to the prod deployment. First build live; health-check query verified against prod.

### 2026-08-31 - working tree

Locked the full product shape through the wayfinder map (issues #1–#9): Google OAuth auth, 20 verified US Shopify roasters, sponsor component pins, the launch data model (10 tables, baseline-crawl and 3-strike archive rules, email-ledger notifications), and the notification/feed UX. Wrote the locked build spec, `CONTEXT.md` glossary and ADR-0001. Sponsor env keys set on dev. No product code yet.

### 2026-08-31 - working tree (schema + auth + seed)

Implemented the launch schema: all ten locked tables with locked indexes and the authTables spread (`convex/schema.ts`). Wired Google OAuth (@convex-dev/auth 0.0.95) with HTTP routes; set JWT/JWKS/SITE_URL on dev. Mounted @convex-dev/aggregate and @convex-dev/rate-limiter. Seeded all 20 roasters + crawl sources via an idempotent internal mutation (roasters enter `pending`, flip active on baseline crawl). Removed the scaffold todos module.

### 2026-09-01 - working tree (Convex Auth v2 + verified Google sign-in)

Migrated to Convex Auth v2 (@convex-dev/auth 2.0.0-alpha.1): auth core and oauthGoogle components mounted, the app owns its `users` table outright, `auth.config.ts` uses a customJwt provider. Google sign-in/sign-out in the web header; full round trip verified on dev (consent, callback, session, first users row) through a local Caddy HTTPS domain, with the allowed redirect origin supplied by a SITE_URL env var rather than hardcoded. Closed #8.

### 2026-09-01 - working tree (extraction pipeline live on dev)

Built the crawl/extraction pipeline. Firecrawl component mounted; a 5-minute cron claims due sources and schedules crawler actions. products_json sources fetch Shopify `/products.json` directly with pagination past Shopify's 250-item page cap (took Sey from 250 truncated to its full 887); html sources run a durable Firecrawl crawl with structured extraction. Each crawl commits in one transaction: raw capture, catalog upserts, drop-event diffing (baselines fire none), the 3-strike archive, health, and reschedule; crons sweep stale sources hourly and prune captures daily. Verified on dev: all 20 roasters active, first genuine drop event recorded end to end.

### 2026-09-02 - 12d8107

Hardened the pipeline with a convex-test + vitest suite (54 tests) and two live-found fixes. Proud Mary's 722-product catalog exceeded the per-transaction read limit — crawls had failed silently for a day (the hourly sweep caught it) — so commits now run as batched `applyProductBatch` mutations plus a `finalizeCrawl` step. Shopify Markets served Madcap in AED, flapping 154 spurious price events, so every storefront fetch pins the US market. Added `rebaselineSource` and `purgeRoasterEvents` operator mutations and used them on dev.

### 2026-09-02 - edfcd59

Shipped the watch and feed layer. Watch/unwatch/mute mutations resolve the caller from the session, never a userId argument; follower counts run through a @convex-dev/aggregate `TableAggregate` updated in the same transaction as every watch write. Three feed queries return only alert-worthy events (new, back in stock, price drop): global, per-roaster history, and personalized with a delivery footer. Watch-status chips derive from crawl health with locked copy. New screens: signed-out and signed-in homes, `/feed`, `/roasters`, roaster pages, `/watches`. 15 new tests (69). Verified live on dev: sign-in, browsing, watching.

### 2026-09-02 - 400f9a8

Shipped the alert email layer. Mounted @agentmail/convex; every drop event fans out inside the emitting transaction to unmuted watchers — one notifications-ledger row per (user, event) doubles as the one-email-per-event dedup guard, and the send is enqueued through the component's durable workpool. Emails render the locked template as plain text with an OpenAI tasting-note slot. Per-user AgentMail inboxes: signup schedules provisioning, the header backfills existing users, and alerts send from the user's own inbox. Mounted the AgentMail webhook at `/api/agentmail/webhook`. 9 new tests (78). Pushed to dev; prod awaits.

### 2026-09-03 - d4cf616

Debugged the alert inbox path on dev: @agentmail/convex 0.1.0 built its client API on internal functions, which Convex never exposes to the parent app. Patched the package via bun patchedDependencies: the seven parent-called functions became public actions and the AGENTMAIL_* env vars declared in `defineComponent` (the component reads its own namespaced env; a deployment-level var alone is invisible to it — convex-test doesn't model that boundary, so the suite stayed green until the live push). The run then hit AgentMail 403: the dev key lacks inbox_create (broader key tracked on #13).

### 2026-09-04 - af813f0

First production deploy. Added `scripts/deploy-prod.sh`, an eight-stage wizard for the human-only steps — prod Google OAuth client, sponsor keys, fresh RS256 key pair, SITE_URL, deploy, seeding, AgentMail webhook, sign-in check — with every prod-affecting command behind a confirm gate. Verified after: site 200, unsigned webhook rejected 401, 20 roasters seeded (19 active after baseline crawls, 3,543 products), first real user signed in and received their inbox.

### 2026-09-04 - cdcb679

Fixed the first prod-found bug (#16): every fresh signup fired two concurrent `provisionInbox` actions (scheduled at signup, again at sign-in) and the loser died with an AgentMail 403. Provisioning now serializes through a claim timestamp on the users row — mutations serialize, actions don't — clearing on success, releasing on failure so the next sign-in retries, with a 5-minute TTL retaking claims from crashed actions. Four new tests (82). Deployed to prod the same day.

### 2026-09-04 - 9442b9d

Reframed the pitch to "Letterboxd but for coffee" and shipped the social layer (§14, ADR-0002). Backend: a `logs` table (lot + optional rating + notes) with owner-resolved mutations that refuse edits to anyone else's row; a global recent-logs feed; public profile pages; roaster catalogs page their full lots with archived ones kept loggable. Web: `/activity`, `/profile/$userId`, a lots list with inline log form on roaster pages, header links. 13 new tests (92). Live on dev; not yet deployed to prod.

### 2026-09-09 - 965c862

Applied a two-axis code review of the social layer as one commit: validators imported instead of duplicated (the real "import cycle" was a `v.array` over a bare field object), profile normalizes malformed ids to the no-taster page, lot discovery moved to a `products.search_name` search index, and LogForm/LogCard deletes got busy flags against double clicks. 3 new tests (95).

### 2026-09-09 - ecf4547

Shipped §14.4 roaster notes on lots (the #14 re-scope). Extraction captures what roasters publish on products.json: description (block-aware HTML strip), tags, imageUrl; origin/process/roastLevel parsed from each roaster's observed tag conventions. `roasterNotes` matches only the roaster's own prose ("in the cup we find", "notes of", …) and stores it verbatim, null when nothing matches — descriptors are never invented, OpenAI stays unused unless regex coverage proves poor. Seven optional fields on `products`, written at upsert so the catalog fills on the next crawl with no migration. Lot rows and log cards show descriptors as read-only reference, never prefilled into personal notes. 22 new tests (117); a live Proud Mary crawl filled origin, process and notes verbatim from their page.

### 2026-09-09 - 19402aa

Code review of the §14.4 diff. The two findings that mattered: stale notes never cleared — fixed by folding the seven fields into one optional `lotCopy` object where a present copy is authoritative (every field written, `undefined` clears) and an absent copy leaves the value alone; and word boundaries on the notes lead-ins after "Footnotes of the harvest" proved bare "notes of" would invent a note. Plus LogCard double heading, `<script>`/`<style>` stripping, and a date fix on two earlier entries. 5 new tests (122). Verified against a live Proud Mary crawl.

### 2026-09-09 - working tree (prod deploy: social layer + lot copy)

Deployed the social layer and §14.4 lot copy to prod (`bun run deploy`, owner consent in session). Post-checks: site and `/activity` 200, healthCheck "OK", `searchLots` live with the new lot shape (roasterNotes null until prod crawls fill copy). Sign-in + log-a-lot round trip still to verify in a browser.

### 2026-09-10 - e4036bb

Every lot is now a page (§15, ADR-0003, #18). The owner's first-prod feedback: logging required the detour through the roaster page and nothing named a lot linked anywhere. `lots.get` is a public query keyed by the URL string (malformed ids resolve to null) returning the published copy, roaster, and recent logs capped at 20; new `logs.by_product_and_logged_at` index. Web: `/lots/$lotId` with a Log button and inline edit/delete on your own logs; feed cards gain a Log action; lot names link their page everywhere. 5 new tests (127). Verified against a real Proud Mary lot. Filed #17 and #18.

### 2026-09-10 - df5b36e

Trimmed non-coffee products from extraction (§16, #17). Built `classifyLot` from a sample of all 20 seed feeds: signals in order, first decisive wins — wholesale; titles naming non-lot formats (subscriptions, bundles, k-cups, RTD, bulk) or hard goods (scales, grinders, mugs, tees), whatever the type says; exact non-lot tags; `product_type` per segment; tags and title vocabulary for untyped items; default not-a-lot. Cleanup is part of the crawl: rejected ids reported, `finalizeCrawl` deletes junk still in the catalog (archiving any a taster has logged), capped per crawl. Along the way the wholesale rule turned out to be a substring match hiding 48 of Sweet Bloom's 53 coffees; it now matches type, title and exact tags. 21 new tests (148). On dev one crawl pass took the catalog to 2,553 and deleted 145 junk items; the 283 events fired by newly visible retail coffees were catalog corrections, purged with `purgeRoasterEvents` — on prod, six roasters must be rebaselined right after deploy.

### 2026-09-10 - a3995fe

Reviewed the classifier (§16). First false negative on real data: `cold brew`, `aeropress`, `chemex` sat in the pre-type title rules, so Blossom's whole-bean "Cold Brew Blend" was rejected outright — they only decide untyped items now, and drinkable RTD is caught by its container. Untyped logic became `classifyUntyped`: a weak non-lot tag decides only when no tag says coffee, and ambiguous title words lose to a place or craft word in the same title. Purge fixes: orphaned notifications rows cleared via a shared `deleteDropEvent`, and the purge capped at 200 products per crawl. Regression over 3,805 sampled real items: exactly one verdict flipped. 7 new tests (155). Live on dev, Blossom rebaselined and crawled.

### 2026-09-10 - 23d77a0

Collapsed the per-variant `new` events to one per lot (§5 rule 4, #19). `applyProductBatch` had emitted an event per variant — 14 consecutive Proud Mary cards for one coffee at the top of the feed. A first sighting now emits a single event citing the cheapest size (first minimum wins); a size added to a known lot later keeps its own event; baselines stay silent. One alert email per new lot instead of one per size. Two commit-path tests (157). Live on dev.

### 2026-09-10 - b35dff6

Production two commits ahead: lot pages, the classifier, and the new-event collapse live on `artful-chameleon-402`, both schema changes landing with the deploy (15.7s). The sequencing held: `rebaselineSource` ran for the six affected roasters within a minute, so first post-deploy crawls were silent baselines — verified when the "Cold Brew Blend" entered prod as `current` with zero events fired and the feed carrying only genuine pre-deploy events. Junk purge proceeds on its own at the per-crawl cap.

### 2026-09-11 - c59f1c4

Re-planned against the All Gas criteria. A fit assessment graded the earlier draft and found the app used Firecrawl for crawling and OpenAI for nothing at runtime — the sponsor story was half true. The revised spec keeps the product and adds one grounded OpenAI feature behind gates: Gate 1, existing flows verified on prod; Gate 2, Find my next bag with a real OpenAI call and a demonstrated Firecrawl contribution; Gate 3, saving and watches. Fixed rules: the model chooses existing IDs and copies supplied passages, never writes catalog facts, gets no tools, and every buying label comes from the database.

### 2026-09-12 - a08463d

Shipped Find my next bag (Gate 2). `/next-bag` takes a request in plain words, an optional USD cap and minimum bag size, and up to five of the user's own logs; the page says what goes to OpenAI before the button. Candidates come from sources whose homepage confirmed US/USD in the past hour, taken round-robin across roasters, each priced on one specific in-stock variant. Firecrawl scrapes up to two product pages per request (JSON extraction); the backend keeps a value only when it appears in the page text and is absent from the feed's own copy. One OpenAI Responses call (`gpt-5.6-luna`, strict JSON schema, no tools) returns up to three existing product IDs, each with an evidence ID and a byte-for-byte passage copy; the server rejects unknown IDs, changed quotes, and comparison sentences containing numbers, prices or stock, and rechecks the variant's stock, price and size before showing a buying link. Results cache 24h; per-user (5/hour) and global (30/hour) quotas queue through a workpool at concurrency two. 62 test cases (219).

It took three live dev runs to make the Firecrawl contribution real (recorded in `.agents/docs/recommendations.md`): run one quoted valid catalog lines but page scrapes yielded boilerplate; run two's passages were image captions because link stripping ran before the image filter — but the captions held the useful data, so extraction moved to Firecrawl's JSON format with the verbatim check; run three quoted fact lines the feed does not carry (Onyx variety/elevation/roast, Verve variety/producer), echoed in the model's comparison. A rule to prefer the most specific passage and "Also on the product page" bullets landed between runs.

### 2026-09-12 - working tree (prod deploy: Find my next bag)

Deployed `a08463d` to prod (`bun run deploy`, owner consent, `OPENAI_API_KEY` set on prod beforehand). Carried the recommendation tables, index, workpool mount and `/next-bag` route. Post-checks: `/` and `/next-bag` 200, healthCheck OK, 19 of 20 sources watching. No source carried a US/USD confirmation at deploy time (written by the crawls themselves, all due within 26 minutes), so the page answered "No eligible coffees" until crawls landed. The prod evidence cache starts empty; the first prod run remains to be recorded.

### 2026-09-12 - 0fef273

Fixed the last catalog-quote embarrassment (#21). East Pole's spec table flattened to one line had been quoted with `New Column` corner cells and all, because a stripped table has no sentence boundaries. A line reading as a label run (three or more all-caps tokens, or the literal `New Column`) is now mapped instead of quoted: known coffee headers become the same `Label: value.` facts, values stay verbatim substrings, AMOUNT and unknown headers drop, and shop prose glued to the last value is cut. The East Pole fixture now yields a clean fact line. One new test (220); live on dev; no purge needed (catalog passages rebuild per request).

### 2026-09-12 - a959b09

Replayed the fix against live dev data instead of trusting the fixture, and it caught a gap: East Pole's "Traffic" description flattens the table and the next sentence into one paragraph with no punctuation, so the shop-voice cut (which only knew We/Our) let prose ride into `Tasting notes:`. `cutValue` now also cuts at the no-boundary seam: a clause-starting function word, or a capitalised word directly after a lowercase one, while comma or capitalised neighbours do not cut. Fixture from the live description; suite stays 220; live on dev.

### 2026-09-12 - dev run mh7ahzj41xhj1gwg2twqnsgrfs8e9enw (post-0fef273 verification)

First live run after the fix (owner fired it): the East Pole card quoted the mapped fact line verbatim — both the #21 fix working end to end and the Firecrawl-style evidence shape reaching a card that previously would have quoted the flattened sheet. The model's comparison cited from that line. New finding: an unquoted "Also on the product page" passage was a first-person customer review that leaked past the Firecrawl prompt's instruction to ignore reviews. Filed as an issue.

### 2026-09-12 - 0239eae

A code review of the #21 commits found the seam cut added in a959b09 ran on every mapped value, not just the last one — interior values truncated (`Producer: Smallholder outgrowers in.`, `Tasting notes: This.`), rendered under "Roaster's published words" but no longer verbatim. Prose is only glued to the value that ends a run, so the cut now applies there alone. Also fixed: `MASL` eaten as an unknown header, two mechanisms for one cut merged, and a capitalised-word-followed-by-function-word seam. A replay of the full dev products dump (2,560 rows) now gives clean fact lines for all nine label-run descriptions; six fixtures added including one pinning a known blind spot (221). Not deployed yet.

### 2026-09-12 - prod deploy of 7be5a24 (label-run fix)

Pushed to dev and then prod with `bun run deploy` (owner consent; 15.3s, no schema or env change). Prod carries the whole #21 line: flattened spec tables become `Label: value.` facts. Read-only post-checks: `/` and `/next-bag` 200, healthCheck OK, 19 of 20 sources US/USD-confirmed. The twentieth, Passenger, sat in `products_json` mode with 179 consecutive failures because its apex `/products.json` is a 404 — silently absent from every prod recommendation. Filed as #25 (`ready-for-human`). Prod `recommendationRuns` still empty.

### 2026-09-12 - prod Passenger row flip (owner) and the html-mode market gap (#26)

The owner set Passenger's prod crawl source to html mode in the dashboard (#25); the next tick crawled successfully within six minutes, health back to watching, 27 products, self-baselined. The follow-up exposed a code gap: `confirmShopMarket` only ran in the products_json path, so html-mode sources could never satisfy the recommendation eligibility gate and were silently excluded on both deployments. Filed as #26 with a fix sketch; `setSourceMode` remains the open code half of #25.

### 2026-09-12 - 8388cef

Fixed #26: html-mode crawls never confirmed the shop market, so an html source could not satisfy the eligibility gate and was silently excluded from Find my next bag. The confirmation now runs in `commitExtractedCatalog` against the roaster's `websiteUrl`, stamped with the commit's `fetchedAt`, which `finalizeCrawl` writes as `lastSuccessAt`. Missing Shopify globals or an unreachable homepage fail closed: no market, crawl still succeeds. Tests assert the confirmation with `confirmedAt === lastSuccessAt` and both failure modes (224). Left out deliberately: a "market unconfirmed" warning on the source row — it would fire hourly for any shop that legitimately lacks the globals, and the absent field is already visible in the dashboard.

### 2026-09-15 - c7b18bc

Three result-card bugs from the third live dev run, all on `/next-bag`. **#22:** with no minimum bag size a 2 oz sample showed as `$6 USD / 85 g` — the form now prefills 200 g (editable; cleared means any confirmed size) and the card reads price, size and variant side by side. **#23:** a Blossom customer review ("I've had a tough time…") had appeared under "Roaster's published words"; a `REVIEWER_VOICE` marker (I, I've, my) now applies wherever shop voice does. **#24:** Title Case spec sheets passed as one quotable sentence since #21 only counted all-caps headers — three or more known colon-marked labels now trigger the same mapping. The replay changed 201 of 2,570 stored descriptions and surfaced three more shapes to handle (two-word layout cells, spaced colons, a colon header bounding the last value). Backend 224 → 226, plus 3 web tests. Live on dev; evidence cache purged since it held the review line for 24h. Not yet on prod.

### 2026-09-15 - prod deploy of c7b18bc (next-bag result cards)

Pushed to prod with `bun run deploy` (owner consent; 15.4s, functions plus a web rebuild). Prod serves the 200 g default, reviewer-voice filter and colon-label mapping. Purged `recommendationEvidence`: 0 rows, confirming no prod run yet. Post-checks read-only: `/` and `/next-bag` 200, healthCheck OK, served chunk carries the new helper text. Closed #22, #23, #24.

### 2026-09-15 - first prod recommendation, run ks752hap2q63hkq4b28ymwapa58efhbc

The owner fired the first real request through the signed-in prod UI: "Looking for something floral and of african origin", no logs, 200 g default in place. Status `ready` after 21.4s; model string `gpt-5.6-luna`. Candidate pool: 20 lots across 10 roasters, drawn round-robin from the US/USD-confirmed sources. Two Firecrawl enrichments: La Colombe produced three page passages including a server-labelled fact line (the structured JSON path worked live on prod); the Blossom scrape cached zero passages (the empty-evidence path with its TTL). The model quoted three catalog passages (Stumptown Ethiopia Mordecofe, Blossom decaf Ethiopia, Blossom Ardi Natural), all labelled "A possible similarity" with comparisons that survived the filters. Honest demo notes: a decaf made the shortlist (preference words rank, never filter), and the Firecrawl evidence was offered but not chosen this time — a video take that wants to open a Firecrawl source should pick a run where one is quoted, or show the unquoted passages. This is the evidence the fit assessment said was missing: OpenAI and Firecrawl both ran on prod, in one request, from the public URL.

### 2026-09-15 - 0522e79

Task 3 of the polish handoff: Save, the missing step of the spec §11 demo sequence. A `savedCoffees` table (userId, productId, savedAt, optional fromRunId) with per-user indexes; `save`/`unsave` take the user from the session only and are idempotent; `fromRunId` is kept only when the run belongs to the caller. Saving is private: no email, no watch, and `logs.profile` untouched — pinned by a test. Web: Save/Saved toggle on shortlist cards, the lot page and other people's log cards; `/saved` holds the full paginated list hydrated with lot name, roaster, image and stock; the signed-in home gains a "Want to try" section; the header gains a Saved link. First save shows one toast: "Saved. Only you can see it; no email, no watch." Five test cases (231). Dev first (first schema change since the logs table).

### 2026-09-15 - prod deploy of 0522e79 (Save)

Pushed to dev (`convex dev --once`, 3.3s) and then to prod (`bun run deploy`, owner consent; 16.9s). The `savedCoffees` table and indexes were created empty — no backfill, no env change. Post-checks: `/`, `/next-bag` and `/saved` 200, healthCheck OK, the table listed on prod, the served chunk carries "Want to try". The §11 demo sequence is now complete on the public URL.

### 2026-09-15 - 7d0e305

Task 4 of the polish handoff, repo truthfulness: a judge opening the repo should not find screens promised and never built. `PRODUCT.md` now describes the product as shipped, screen by screen, with a "Not in this release" list pointing at ADR-0004 (why Gate 3 shipped as Save only). The header of this file names the whole product. Closed #14 and #12, whose last open item was directory search: `/roasters` gets a client-side filter over the directory by name, city and state — every term must hit, accent and case insensitive, four unit tests. Deployed to prod (15.0s, web rebuild only).

### 2026-09-15 - extraction audit (handoff Task 1, investigation only)

Before the design pass, a deep look at the scraped data itself. No code changed; output is `.agents/research/extraction-audit.md`, a draft ADR-0005, and issues #27–#35. Method: all 20 seed feeds fetched live and run through the real `parseProductsJson` and `classifyLot`, cross-checked against the dev export (2,570 products, 11,875 variants, 569 drop events), plus paired Firecrawl scrapes on five product pages. Headline findings: Passenger has a normal `www.` Shopify feed — the apex is a headless front, so html mode and 179 prod failures were avoidable (#27); `variants[].grams` is Shopify's shipping weight, wrong on 21% of sized variants, leaving every Blossom bag unrecommendable (#28); origin landed on 3 of 20 roasters while 1,269 lots name their country in the title (#30); `roasterNotes` swallows trailing clauses, keeps emojis, and misses Merit's bullet lines (#29); the classifier's only errors are Passenger's Archival Release lots and Merit's wholesale duplicates (#31); Firecrawl extraction was byte-identical on most fields but drifted on producer and roast level, so the verbatim check needs a per-field shape check (#32); dev drop events cluster in one-hour weekday windows, arguing for a cadence table (#33); "Check now" is designed around one shared crawl with rate limits (#34).

### 2026-09-15 - 17abf56

First fix from the audit, #27. Passenger's `products.json` lives on `www.drinkpassenger.com`; the apex is a headless front that 404s — the cause of the 179 prod failures and the 50-credit html crawl. `fetchFirstFeedPage` now retries page 1 on `www.` after an apex 404, and the answering host fetches later pages and is written back to the roaster row, so a user-submitted headless shop gets the same treatment without an operator. Second finding: the `www.` homepage 301s to the headless apex with no Shopify globals, so the market stayed unconfirmed — `confirmShopMarket` now falls back to Shopify's storefront `/meta.json`, with the homepage globals primary. Operator mutations `setSourceMode` and `purgeProductsByPrefix` added beside `rebaselineSource`. Suite 231 → 242. On dev: row moved, rebaselined, one crawl confirmed the market via meta.json with 261 current lots; the 29 html-era rows purged with their 55 bogus events. Prod needs the same after the deploy, with consent.

### 2026-09-15 - 904bc4b

#28, the audit's most visible defect: `variants[].grams` came straight from Shopify, whose `grams` is the shipping weight, not the bag — East Pole "12 oz." was 397, Sey "125g" was 454, every Blossom bag 0, which the `grams > 0` eligibility rule turned into "Blossom can never be recommended". `parseVariantGrams` now reads the first size token in the variant title or options, with the unit spellings feeds actually use (`12oz`, `2.2 LBS`, `250gms`, `1 KILO`, `2 x 250g bags`), converts oz/lb to grams, and multiplies pack counts; Shopify `grams` is the fallback only when no size is named and it is positive. A replay of all 20 live feeds: 12,648 variants, 6,966 values changed, one shape fixed on review and no wrong ones. 36 new cases (278). One Blossom crawl by hand: all variants carry a size; the other 19 roasters self-heal on their next crawl through `diffVariant`, which patches grams without an event. Not yet on prod.

### 2026-09-15 - b48d067

#29, the three `roasterNotes` defects. **Clause swallow:** the list's final item now starts at the last Oxford conjunction or bare "and", and after that a comma plus a clause word or a capitalised subject ends the list — so "this classic Dark Roast tastes great on its own" drops while "blackberry lemonade, coffee blossom florals, and ripe nectarine" stays whole. **Prose "we taste":** only counts when the clause reads as a list, stops at the sentence, and drops emoji/punctuation tails — fixing eleven stored notes beginning with a bare "d " from a "we tasted" regex leak. **Bullet lines:** a first line of 3–6 short items separated by `•`, `·` or `|` is the notes before any lead-in is tried (three minimum, since "Ethiopia • Guji" is as likely an origin line). Replays over 20 live feeds and the dev export: 86 dev values changed, all 8 losses garbage. 18 new cases (296). Live on dev with Merit and Blossom crawled by hand.

### 2026-09-15 - 4514239

#30, the attributes block on the lot page. Before this commit origin landed on 696 of 2,771 lots (3 of 20 roasters), roast level on 53, while 1,269 lots name their country in the title. `parseLotAttributes` now takes `{ tags, title, blockText, vendor }` with per-field tiers: keyed tags (stored as written, every value — Proud Mary's blend is `Brazil, Honduras` now, not `Brazil`), Counter Culture `key__value` tags, bare tags, the title (one country, not all of them — "Costa Rica El Congo Geisha" is a farm), body label lines and all-caps tables, and for origin only the vendor. Free text must pass a shape check first — a country from a fixed list of 42, a closed process vocabulary, or the anchored roast regex — so "Roast Level: Bright" and `recommended use: Espresso` land nowhere. Result: origin 696 → 2,057, process 696 → 1,252, roast 53 → 351, nothing lost, every change a second value from the roaster's own tags. 11 new cases (307). Live on dev; four roasters crawled by hand and read back matching the replay.

### 2026-09-15 - b6b1638

#31, the classifier's only errors across the audit's 1,620 rejections. Passenger's `Archival Release` lots (frozen back-catalog, sold on Freezer Friday) were unknown to the type rules and fell to the untyped default — `archival` is now a coffee type; `cup of excellence` is a craft phrase, `wet process` a title word. Wholesale tightened: only the word `wholesale` in `vendor` counts (La Colombe puts cafe locations there), and Ruby's custom cafe blends need untyped-plus-bare-Wholesale-tag together, since retail roasters tag every coffee wholesale. `collateral`, `packaging`, `signage` are non-lot types. One rule from the issue did not survive the replay: a lone `hidden` tag would have removed 165 real Intelligentsia coffees, so it is out. Replay over 20 live feeds: lots 2,771 → 2,760 (Passenger +31, Merit −37, Ruby −4, no other roaster moved). 3 new cases (310). Dev: rebaselined all three before hand-crawls — catalog changes, zero drop events written.

### 2026-09-15 - a43adf6

#33, cadence and capture retention. Every source ran the 60-minute default, so detection latency averaged ~32 minutes while dev drop events cluster in one-hour weekday windows (Verve 60 of 62 detections in one Friday 07:00 hour). The seed table now carries a `cadenceMinutes` per roaster: 15 for the drop roasters, 30 for six mid-cadence shops, 60 for the rest — 912 crawls a day instead of 480 against CDN-cached feeds. The cost that scaled was `rawCaptures` (2.9 MB a cycle): a failed extraction is always captured (that is the diagnostic the table exists for), a successful one at most once per roaster per day, read through a new index. `applySeedCadence` brings an existing deployment onto the table and reports what it patched. Tests include the tick claiming a 15-minute source exactly four times per hour. Suite 310 → 316. Dev: patched 13, unchanged 7. The learned `dropWindows` column is deliberately not this week.

### 2026-09-15 - 0908395, db849d1

#34, Check now. Until now a between-crawls look required an operator CLI call, and nothing recorded a crawl in flight, so two in a row would double-crawl and double-emit. Every crawl start goes through one helper, `startCrawl`: it stamps `runningSince`, pushes the due date out, and schedules the action; the tick, the operator `crawlNow` and the new public `requestCheck` all use it, and all three refuse a stamp under ten minutes old. `requestCheck` answers before spending anything — `fresh` under two minutes, `running` if a stamp is live — and only an attempt that would actually crawl touches the limiters (3 per user per 10 minutes, 1 per source per 2 minutes), peeked and started in one transaction. The noon-Friday case: 50 people press on Onyx, one crawl, 49 answered `running` or `limited`, every open page flipping together via the existing source subscription. The chip reads "Checking now" with a pulsing dot; the button counts down retries. New test file covers the full matrix (327). Verified on dev: a `crawlNow` on East Pole completed in under a second and an open browser tab flipped to "last checked just now" without a reload.

### 2026-09-15 - cd18e7b

#35, html-mode hygiene. Passenger's 30 html-mode rows on dev showed three defects: `externalId` carried Firecrawl's URL with a `?Size=` query, so a variant-picker flap minted a new lot and three-struck the old one; `parseHtmlPage` never ran the classifier, so "Foundational Subscription" was a lot; and no copy. The first two are fixed: URLs are keyed bare (origin + pathname, with a split fallback for string URLs), and the classifier runs on the title — only a positive `title` or `wholesale` verdict rejects, because an html shop's whole catalog may be untyped ("Agaro", "Ninga" are the whole catalog). Rejects union across pages and hand to `finalizeCrawl`'s purge, so a page of nothing but rejects is a read shop, not a failure. Bag size falls through the variant-name parser, so "Ninga Washed 250g" gets 250. Not done: per-product page enrichment for `lotCopy` (waits on #32's provenance). Suite 330. Pushed to dev. Not yet on prod.

### 2026-09-15 - prod deploy of c534e96 (extraction fixes, cadence, Check now)

Pushed everything since `7d0e305` (19 commits, #27–#31, #33–#35) to prod with `bun run deploy` (owner consent in session; 16.9s). Two additive schema changes, both optional: `crawlSources.runningSince` and the `rawCaptures` daily-capture index. Then on prod, in order: `applySeedCadence` (`patched: 13, unchanged: 7`), Passenger's row to `www.` and mode back to `products_json`, `rebaselineSource` on Passenger/Merit/Ruby so the classifier and mode changes fire no events, and `checkNow:crawlNow` on Passenger — the new operator tool's first real use: started, 25 seconds later health `watching`, market confirmed via `meta.json`. Read-only post-checks: site and roaster page 200, 319 current Passenger lots with all 35 Archival Releases, 2,147 current lots across the 20 roasters. Two things left as they are: 29 html-era rows three-striking out over the next crawls (`purgeProductsByPrefix` exists if the owner wants them gone sooner), and a cosmetic stale `lastErrorMessage` the chip never reads. Closed #25, #27–#31, #33–#35. Open: #32, #20, #15.

### 2026-09-15 - 64beb2d, 5925aa2

#32 decided: ADR-0005 takes option C with A's schema — one shape verifier gates both the feed and the page path, and the page read fires the first time anyone looks at a lot rather than at first sighting, so Firecrawl credits scale with attention. #15 in `5925aa2`: `/settings/alerts` exists, shows the user's alert inbox address and lets them mute a roaster's watch; the alert email footer links to it. Both pushed to dev with the previous prod deploy still current.

### 2026-09-15 - e5d6524

ADR-0005 items 6 and 7. `products` gains `variety`, `region`, `elevation`, `producer`, `productType`, `pageFacts` and `copyFetchedAt`; `roasterNotes` becomes a list (schema union until the @convex-dev/migrations job runs). `lotFacts.ts` is the new pure module: per-field shapes and `mergedFacts`, which reads feed columns first and `pageFacts` for the gaps; the feed path now pulls variety, region, elevation and producer out of body labels. `pageFacts.request` reads a thin lot's page once through Firecrawl json, checks every value letter-for-letter against the markdown and by field shape (the audit's `roastLevel: "Espresso"` leak), and stores the result; deployment cap 20 reads an hour, re-asked after 24h only if the read found nothing. The recommendation worker skips settled lots and `pagePassages` returns description sentences only, so Find my next bag spends less. The lot page shows "Reading the roaster's page for more…" until the chips land. Verified on dev against an Onyx lot: variety, elevation, producer and four notes ~20s after load. Dev migration: 2,790 rows, 0 strings left. Suite 330 → 356.

### 2026-09-16 - prod deploy of e5d6524, then f8b4218

Deployed `e5d6524` to prod (owner consent; 17.0s), then `migrations:run roasterNotesToList`: success, 2,809 processed in under 3s; a read-back of all rows showed 0 string `roasterNotes` and 1,272 lists. Live check of the on-demand path: `pageFacts:request` on an Onyx lot returned `started`, and ~30s later the row carried the exact facts the page states. With zero strings on both deployments, `f8b4218` tightened `roasterNotes` to `v.array(v.string())` and removed the migration wiring (the dependency stays for the next migration). Second deploy 15.8s, `migrations:*` gone from the function spec, site 200.

### 2026-09-16 - 1b61cea, prod deploy, demo walk

Two leftovers from earlier prod checks. `finalizeCrawl` never cleared `lastErrorMessage` on success — Passenger still read the html-era Firecrawl 429 while health said watching; a success now clears the message and keeps `lastErrorAt` as history. The `/settings/alerts` watch list was headed "Muted roasters"; it is "Watches". Deployed to prod (16.4s, no schema change). The owner then walked the full demo sequence on prod, signed in: roaster page, Check now, a lot page with facts, Find my next bag, Save, watch, a shared log, alert settings. Everything passed. Prod and `main` both at `1b61cea`.

### 2026-09-16 - 7968674, ee8ddf2 - the design pass starts: tokens, then the landing

The long-deferred frontend pass began, landing page first per the owner. One tokens commit (`7968674`) set the spec §8 palette in the shared stylesheet so every screen inherits it: light neutral ground, graphite text, a deep blue action color as `--primary` in both themes, radius tightened. Then `ee8ddf2` rebuilt the signed-out home: two-column layout with the pitch and sign-in CTA on the left and the live global feed on the right as the proof, capped at 8 rows with the directory teaser under it; all data on the page is real — the same queries the signed-in app reads, no invented activity. Header gained a wordmark and a 44px sign-in target on every screen. Gates pass, impeccable detector clean, screenshots at 1440/390 light+dark. Known gap, deliberate: spec §8's "real roaster imagery" needs an image field on the feed queries first, its own backend commit before any visual commit can use it.

### 2026-09-16 - 408a84b, 5fea39f - design reset: the index world

The owner threw out every prior frontend decision and pinned new references: theindex.website (structure, type, the giant cropped footer wordmark), the vanschneider row hover, and Thornton's 1808 Coffea Arabica plate (public domain) as the hero. Backend first (`408a84b`): feed cards now carry `imageUrl`, `origin`, `process`, `roasterCity` and `roasterState` — fields the crawler already stored but never exposed; 357 tests pass. Then the visual commit (`5fea39f`): tokens went to black on white with a single grey, hairline rules and no accent color; Schibsted Grotesk for every label and cell, Source Serif 4 for the one lede sentence, both self-hosted (the previous font was declared in CSS but never loaded — the app had been rendering in the system sans). The signed-out home is one centered column: plate, NOUVEAU wordmark, lede, sign-in block, three lot photos, then event-type tabs above a hairline table of the 50 newest drops collapsed to one row per lot; hovering a row slides the lot photo in from the left over its number. The footer is NOUVEAU.COFFEE at 22vw, cropped and scrolling. The root grid clamps its column so a wide table can no longer push the page past the viewport (it had, by 22px). Gates pass, detector clean, screenshots in `.impeccable/review/`, DESIGN.md rewritten. Known gaps, deliberate: the plate cutout awaits the owner's refinement, inner routes inherit tokens only until each is redesigned, and one live row shows a Peru lot with origin "Kenya" — an extraction question, not a design one.

### 2026-09-17 - working tree (custom domains: nouveau.coffee)

Moved the public app off the raw deployment URLs. The owner bought `nouveau.coffee` through Cloudflare; the site is now `https://nouveau.coffee` with the realtime API at `https://api.nouveau.coffee`, both bound as Convex custom domains (HTTP Actions and Convex API respectively) with a `www` 301 to the apex. Deployment settings override `CONVEX_SITE_URL` and `CONVEX_CLOUD_URL` to the new hosts; `SITE_URL` was set to match; the backend pushed so `auth.config.ts` bakes the new issuer/JWKS, and the frontend rebuilt with `VITE_CONVEX_URL` on the api host. The owner updated the Google OAuth redirect and re-registered the AgentMail webhook at `https://nouveau.coffee/api/agentmail/webhook`. Verified: site 200, `www` → apex 301, JWKS served, webhook 401 on an unsigned POST, and the Google sign-in round trip in the browser.

### 2026-09-18 - eb27c34 - design pass: header, theme switch, roasters

The index vocabulary reached its first inner pages. The header is now caps links with a hairline circle for the theme switch (`header.tsx`, `mode-toggle.tsx`). `/roasters` and `/roasters/$slug` moved to `PageTitle` (h1, tabular count, caps actions on the right baseline), a `SearchField` underline input, full-width hairline tables and `SiteFooter`; the roaster page reuses `DropTable` with `showRoaster={false}` and the lots list in `lots.tsx` carries the caps ARCHIVED tag. The controls those pages share were redone in the same language: `status-chip` is an 8px colored dot with grey text, `watch-button` a WATCH / WATCHING toggle pair, `check-now-button` caps text with the 44px hit area. No query changed; this commit is layout and copy only. `DESIGN.md` records the built result and the handoff's Task 3 now lists what is done and what remains (lot page, cards to rows, signed-in home, next bag, the rest).

### 2026-09-18 - 4f11755 - ADR-0007: one event per variant burst; sizes, deep links, grid filters

A restock of four bag sizes had been four feed cards and four emails per watcher. One crawl of one product is now one burst: `diffVariant` reports each move and `planBurstEvents` emits at most one event per kind, citing a headline size and every moved variant (`crawlSources.ts`, `dropEvents.variantIds`). Variants keep the Shopify variant id, so the lot page's size table deep-links the exact size on the roaster's shop (`lotUrl.ts`, `lots.tsx`). A stock rollup (`anyAvailable`, `minPriceCents`, `weightOptions`) lands on `products` at upsert; the roaster grid dims sold-out lots and filters on stock, bag size, price cap and origin over a bounded index scan (`roasters.ts`, `lotStock.ts`). Twenty-six review follow-ups from the two-axis code review landed as small commits (`2fdc558`..`4f11755`), plus a backend `check-types` script so the root turbo task typechecks both packages. Convex features: indexes, scheduled functions, paginated queries.

### 2026-09-18 - 6c8fb2f - ADR-0008: thin lots get their page read at crawl time, from the shop itself

Half the catalog had no tasting notes to show on the grid or in recommendations, because most roasters keep notes in a metafield the theme renders only on the product page. After each successful crawl, `pageFacts.sweep` schedules one read per thin lot, 25 per roaster per crawl, two seconds apart (`pageFacts.ts`, `ctx.scheduler`). The read fetches the shop's own page with a plain request and reduces it to block text (`extraction.ts`: main element first, chrome and upsell blocks cut, the theme's notes element leading the candidates); Firecrawl's markdown scrape runs only when the shop errors, redirects elsewhere or serves a script shell, under a deployment-wide token bucket of 60 fallbacks a minute (`@convex-dev/rate-limiter`). Jev picks one verified span per field. A lot is read while any of seven facts is missing, at most three times a day apart (`products.pageReads`). A live run on dev raised notes coverage from about 55% to 76% of 3,030 lots in one session and surfaced four defects, all fixed the same day. Suite 480.

### 2026-09-18 - f45d54f - ADR-0009: image alt text joins the page read; prod deploy

Surveyed all 20 roasters for structured page data. Only image alt text pays: Verve keeps its whole spec line there and nowhere in the rendered text. JSON-LD equals the feed body everywhere it exists, and the SEO description named another coffee on two of nineteen pages, so both are rejected (`.agents/docs/adr/0009-*.md`). The page read now keeps labelled `Label: value` alt segments ahead of the page text (`extraction.ts`). Every Jev question names the lot, the second guard after a featured-products block had leaked another blend's notes onto 54 of 55 Sweet Bloom lots; `pageFacts.resetReads` clears a roaster's reads and facts by hand so an extractor fix applies now. Verified on dev: the reset Sweet Bloom lots carry only their own notes, and Verve lots gain notes, roast, process and variety. Deployed `f45d54f` to prod with `bun run deploy` (owner consent; 17.0s), prod's first crawl-time page reads. Suite 485.

### 2026-09-19 - 26b5a6a - the sweep skips sold-out lots; prod backfill done

Prod's first crawl-time sweep exposed a feed quirk: Sey keeps 874 of its 881 lots current but sold out, and with every stamp equal after one crawl the sweep read 2019 archive pages while the seven purchasable lots waited behind roughly nine hours of reads. `pageFacts.sweep` now skips a lot whose stock rollup says sold out; a lot with no rollup yet stays due, and the lot page's on-view ask is unchanged (`pageFacts.ts`, ADR-0008 amendment). Two seed fixes rode along: La Colombe's row had inherited Passenger's `www` host from a paste (`b589d56`), and `seed.applySeedUrls` repoints a deployment's roaster URLs onto the seed table by slug, idempotent (`55e542c`). Deployed to prod (owner consent; 17.5s). Next-morning export: Sey's seven purchasable lots read within the hour, no sold-out Sey lot read since, the whole backfill finished 45 minutes after the deploy (729 reads, no failures), and the hourly sweeps have scheduled nothing since. Merged coverage across 2,760 current lots: notes 65%, process 55%; region, producer and roast level under 20%, almost all of it sold-out lots the sweep no longer reads. Suite 487.
