# Hackathon log

- **Project:** nouveau
- **Event:** Convex All Gas Hackathon
- **What it does:** A coffee memory for home brewers. Log the lots you try, ask Find my next bag for a shortlist of in-stock coffees (OpenAI compares them to your logs using the roaster's own words, fetched with Firecrawl), save the ones you want to try, and watch roasters so AgentMail emails you on new lots, restocks, and price drops.
- **Demo:** _video link to be added at submission (Task 6)_
- **Live app:** https://nouveau.coffee (https://artful-chameleon-402.convex.site)
- **Repo:** https://github.com/oscabriel/nouveau
- **Frontend:** Convex static hosting
- **Convex deployment:** https://api.nouveau.coffee (https://artful-chameleon-402.convex.cloud)
- **Components:** @agentmail/convex, @convex-dev/aggregate, @convex-dev/auth (core + Google OAuth), @convex-dev/rate-limiter, @convex-dev/static-hosting, @convex-dev/workpool, @firecrawl/firecrawl-convex
- **Convex features:** schema, indexes, queries, mutations, actions, crons, scheduled functions, file storage, realtime queries, HTTP actions, workpool, full-text search
- **Auth:** Convex Auth
- **AI models:** OpenAI `gpt-5.6-luna` (Responses API, strict JSON schema) for Find my next bag; TypeSafe System One `jev-1.13.0` verifies extraction spans
- **Started:** 2026-08-29T18:06:09Z
- **Last updated:** 2026-09-19T23:11:23Z

## Log

### 2026-08-29 - a37561b

Scaffolded a Turborepo monorepo (TanStack Router + Tailwind web app, shared packages, Convex backend) and deployed the first build to production on Convex static hosting, health-check verified against prod.

### 2026-08-31 - working tree

Locked the product through the wayfinder map (issues #1–#9): Google OAuth, 20 verified US Shopify roasters, the launch data model with baseline-crawl and 3-strike archive rules, and the notification/feed UX. Wrote the locked build spec, `CONTEXT.md` glossary and ADR-0001.

### 2026-09-01 - working tree

Implemented the launch schema: ten tables with locked indexes and the auth tables spread. Google sign-in through Convex Auth v2 (auth core + oauthGoogle components, the app owns its `users` table) verified end to end on dev, and all 20 roasters seeded as crawl sources.

### 2026-09-01 - working tree (extraction pipeline live)

Built the crawl/extraction pipeline: a 5-minute cron claims due sources and schedules crawler actions; products_json sources fetch Shopify catalogs with pagination past the 250-item page cap, html sources run a durable Firecrawl crawl with structured extraction. Each crawl commits raw capture, catalog upserts, drop-event diffing, the 3-strike archive and rescheduling in one transaction. Verified on dev: all 20 roasters active, first genuine drop event end to end.

### 2026-09-02 - 12d8107

Hardened the pipeline with a convex-test + vitest suite and two live-found fixes: crawls of very large catalogs now commit as batched mutations (Proud Mary's 722 products had exceeded the per-transaction read limit), and every storefront fetch pins the US market after Shopify Markets served Madcap in AED, which had fired 154 spurious price events.

### 2026-09-02 - 400f9a8

Shipped the watch and feed layer plus alert emails. Watch/unwatch mutations resolve the caller from the session, never a userId argument; follower counts update through an aggregate in the same transaction. Three feed queries return only alert-worthy events. Every drop event fans out to unmuted watchers inside the emitting transaction: one notifications-ledger row per (user, event) doubles as the one-email-per-event dedup guard, the send goes through a durable workpool, and each user gets their own AgentMail inbox to receive alerts from.

### 2026-09-04 - af813f0

First production deploy, through `scripts/deploy-prod.sh`, an eight-stage script that gates every prod-affecting command behind a confirm and walks the human-only steps (prod Google OAuth client, sponsor keys, key pair, seeding, webhook). Verified after: 20 roasters seeded, 3,543 products, first real user signed in and received their inbox. Same day, fixed the double-provisioning race where a fresh signup fired two concurrent inbox-provision actions; provisioning now serializes through a claim on the users row.

### 2026-09-04 - 9442b9d

Reframed the pitch to "Letterboxd but for coffee" and shipped the social layer: a `logs` table (lot + optional rating + notes) with owner-resolved mutations that refuse edits to anyone else's row, a global recent-logs feed, public profile pages, and inline log forms on roaster catalogs. Live on dev.

### 2026-09-09 - ecf4547

Shipped roaster notes on lots. Extraction now captures what roasters publish on products.json: description, tags, image, plus origin, process and roast level parsed from each roaster's tag conventions. `roasterNotes` matches only the roaster's own prose ("notes of", "in the cup we find") and stores it verbatim; descriptors are never invented and OpenAI stays unused for catalog facts. Lot rows and log cards show the descriptors as read-only reference.

### 2026-09-10 - e4036bb

Every lot is now a page (ADR-0003). Logging had required the detour through a roaster page and nothing named a lot linked anywhere. `/lots/$lotId` renders the published copy, roaster and recent logs; feed cards and lot names everywhere link their page, with a Log button and inline edit/delete on your own logs.

### 2026-09-10 - df5b36e

Shipped the lot classifier and cut junk out of the catalog. `classifyLot` applies signals in order (wholesale, non-lot formats and hard goods, tags, product_type, title vocabulary) and the first decisive one wins; `finalizeCrawl` purges junk still in the catalog while archiving anything a taster has logged. Tuned against real crawls: the wholesale rule had hidden 48 of Sweet Bloom's 53 coffees, and a replay over 3,805 sampled real items flipped exactly one verdict. Also collapsed per-variant `new` events to one per lot, so a single coffee emits one feed card and one email instead of fourteen.

### 2026-09-11 - c59f1c4

Re-planned against the All Gas criteria. An honest fit assessment found the app used Firecrawl for crawling and OpenAI for nothing at runtime, so the sponsor story was half true. The revised spec keeps the product and adds one grounded OpenAI feature behind gates, under fixed rules: the model chooses existing product ids and copies supplied passages verbatim, never writes catalog facts, gets no tools, and every buying label comes from the database.

### 2026-09-12 - a08463d

Shipped Find my next bag (Gate 2), the OpenAI feature. `/next-bag` takes a request in plain words, an optional USD cap and minimum bag size, and up to five of the user's own logs. Candidates come from roasters whose homepage confirmed US/USD in the past hour, round-robin across roasters. Firecrawl scrapes up to two product pages per request, kept only where the value is absent from the feed. One OpenAI Responses call returns up to three product ids with a verbatim passage each; the server rejects unknown ids, changed quotes, and anything out of stock or off-price before showing a buying link. Results cache 24h and quotas queue through a workpool. Three live dev runs moved page extraction to Firecrawl's JSON format; the third run quoted fact lines the feed does not carry.

### 2026-09-12 - 7be5a24

Quote-quality pass on the evidence shown to the model: spec tables flattened to one line now map to `Label: value.` facts instead of being quoted with table-header corner cells, prose glued onto a value's tail is cut, and first-person customer reviews are filtered out of "Roaster's published words". Every fix was replayed over the live dev catalog (2,560+ stored descriptions) rather than trusted from fixtures. Deployed to prod.

### 2026-09-12 - 8388cef

Prod monitoring caught a silent eligibility gap: html-mode crawls never confirmed the shop market, so those sources could never satisfy the recommendation gate and vanished from Find my next bag. Market confirmation now runs on every crawl against the roaster's homepage, failing closed. Passenger's apex `/products.json` being a 404 (179 consecutive silent prod failures) was found the same way and fixed with a `www.` retry and a storefront `/meta.json` fallback.

### 2026-09-15 - c7b18bc

Three result-card fixes from the third live run: the form defaults to 200 g and the card reads price, size and variant side by side (a 2 oz sample had shown as "$6 USD / 85 g"), reviews stay out of roaster's-words sections, and Title Case spec sheets map like all-caps ones. The same day, the first real prod recommendation ran through the signed-in public UI: a floral/African request, ready in 21.4s, two Firecrawl page enrichments, three quoted passages, all of which survived the filters. OpenAI and Firecrawl both ran on prod in one request.

### 2026-09-15 - 0522e79

Shipped Save, the last step of the demo sequence: a `savedCoffees` table with idempotent `save`/`unsave` that take the user from the session, Save/Saved toggles on shortlist cards, lot pages and other people's logs, and a paginated `/saved` page. Saving is private by design: no email, no watch, no profile surface. The full demo sequence is now complete on the public URL.

### 2026-09-15 - 7d0e305

Repo truthfulness pass: `PRODUCT.md` now describes the product as shipped, screen by screen, with a "Not in this release" list, so a judge opening the repo finds no promised-but-unbuilt screens. `/roasters` gained a client-side filter over the directory by name, city and state.

### 2026-09-15 - c534e96

Extraction audit: all 20 seed feeds ran live through the real parser and classifier against the dev export, producing eight findings and an ADR. The fixes landed as one prod deploy: bag size parsed from variant titles instead of Shopify's shipping-weight field (6,966 of 12,648 variants corrected; Blossom had become unrecommendable at zero grams), roasterNotes trailing-clause losses, lot attributes from tags and titles (origin coverage 696 to 2,057 lots, process 696 to 1,252), the classifier's two real-data error classes, per-roaster crawl cadences of 15/30/60 minutes, and html-mode hygiene (bare-URL lot keys, classification on html titles).

### 2026-09-15 - 0908395

Shipped Check now. A between-crawls look had required an operator CLI call, and nothing recorded a crawl in flight, so overlapping crawls double-emitted. Every crawl start now goes through `startCrawl`, which stamps the source, pushes the due date out and schedules the action; the tick, an operator command, and a new public `requestCheck` all share it, so fifty people pressing Check now on Onyx means one crawl and every open page flips to "Checking now" together. Rate limits: 3 per user per 10 minutes, 1 per source per 2 minutes, and only a real attempt spends one.

### 2026-09-15 - e5d6524

Lot facts from product pages (ADR-0005): `products` gains variety, region, elevation, producer and `pageFacts`, and `roasterNotes` becomes a list (migrated on prod, 2,809 rows in under 3s). A thin lot's page is read once through Firecrawl on first view, every value verified letter-for-letter against the page and by field shape before it is stored, so Firecrawl credits scale with attention. Also shipped `/settings/alerts`, where the alert inbox address and per-roaster mutes live, linked from the alert email footer. The owner then walked the full demo on prod, signed in, and everything passed.

### 2026-09-16 - 5fea39f

Design pass. The owner reset the frontend to an index-inspired identity, built black on white with hairline rules and no accent color: Schibsted Grotesk for labels, Source Serif 4 for the lede, both self-hosted, and Thornton's public-domain 1808 Coffea Arabica plate as the hero. The signed-out home is one centered column ending in a table of the 50 newest drops whose rows slide the lot photo in on hover. Backend first exposed the fields the design needed (`imageUrl`, origin, process, roaster city/state). The header, theme switch, roaster pages and shared controls (status chips, watch and check-now buttons) were redone in the same vocabulary, layout and copy only, no query changes.

### 2026-09-17 - working tree (custom domains)

Moved the public app to `https://nouveau.coffee` with the realtime API at `https://api.nouveau.coffee`, both bound as Convex custom domains, `www` 301ing to the apex. Rebaked the auth issuer, pointed Google OAuth and the AgentMail webhook at the new hosts, and verified sign-in and the webhook round trip in the browser.

### 2026-09-18 - 4f11755

ADR-0007: one event per variant burst. A restock of four bag sizes had been four feed cards and four emails per watcher; one crawl of one product is now one event citing a headline size and every moved variant. Variants keep the Shopify variant id so the lot page's size table deep-links the exact size on the shop. A stock rollup (any available, minimum price, weight options) lands on `products` at upsert, and the roaster grid dims sold-out lots and filters on stock, size, price and origin.

### 2026-09-18 - 6c8fb2f

ADR-0008/0009: crawl-time page reads for thin lots. After each successful crawl, a scheduled sweep reads the product page of every lot missing any of seven facts (25 per roaster, two seconds apart), Jev picks one verified span per field, and Firecrawl's rendered-page scrape is the first choice with the shop's own page as fallback under a token-bucket budget. Only image alt text paid as structured page data; JSON-LD and SEO descriptions are rejected after surveying all 20 roasters, and every Jev question names the lot after a featured-products block leaked another blend's notes onto 54 of 55 Sweet Bloom lots. Tasting-notes coverage went from about 55% to 76% of 3,030 lots. Deployed to prod; the backfill finished with 729 reads and no failures, and the sweep skips sold-out lots after Sey's 874 sold-out lots delayed the purchasable ones by nine hours.

### 2026-09-19 - bb30df1

ADR-0010: the page reader is now two steps. Jev picks the line that locates a fact (colon-less spec blocks and lead-in notes became reachable), and the field's cutter takes the value from the picked line before verification gates it, so producer and region coverage rose on the 19-page end-to-end fixture. The read asks Firecrawl for the rendered page first with a shop-page fallback, and after prod logged fifteen 429s in three minutes, the credit budget holds a single token at nine a minute so any sixty seconds stays at ten requests. Deferred reads reschedule themselves instead of being dropped.
