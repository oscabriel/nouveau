# Handoff: extraction deep dive, then design pass, prod verification, coffee watches

Written 2026-09-15, replacing the demo-polish handoff (Tasks 1 to 4 of that doc shipped in `c7b18bc`, `0522e79`, `7d0e305`; see `hackathon.md` for each). Deadline is **2026-09-22, 12:00 PM PT**.

## Where the product is

Prod (`artful-chameleon-402`) runs `7d0e305`. Every feature in scope is live: the alert core, logs and profiles, lot pages, the classifier, Find my next bag, Save. All four sponsors do runtime work on prod and the first prod recommendation run is recorded. Working tree clean; 231 backend tests and 7 web tests pass. Open issues: #15 (settings stub), #20 (post-hackathon Gate 3 list), #25 (the `setSourceMode` code half).

The owner's stated order was functionality first, then a long design pass. Functionality is done. Before the design pass, the owner wants a deep investigation of the scraped data itself: its shape, how deterministically it lands in the right fields, the crawl schedule, and how a user could trigger a scrape. That is Task 1 and it comes first. Then two verification gaps, the design pass, and one small feature if there's room.

The video, the X/LinkedIn post and the submission itself are the owner's and are not in this doc.

## Rules for the session

- Read `.agents/docs/convex-guidelines.md` before touching `packages/backend/convex/`. Load the `impeccable` skill before touching UI.
- Quality gates after every change: `bun run check`, `bun run test`, `bun run check-types`, `bun x tsc --noEmit -p packages/backend/convex/tsconfig.json`. Run the impeccable detector (`node ~/.agents/skills/impeccable/scripts/detect.mjs --json <files>`) over changed UI files; it should return `[]`.
- Dev deploy: `CONVEX_DEPLOYMENT=dev:cool-giraffe-632 npx convex dev --once` from `packages/backend`. Prod: `bun run deploy` from the root, **only with the owner's explicit consent in the session** (see `convex-deploy-guard` skill).
- Every shipped change gets a dated `hackathon.md` entry in the existing style. Judges read this file.
- Vocabulary per `CONTEXT.md`: lot, roaster, watch, log, roaster notes, save. Never "product" in UI copy.
- Never fabricate a drop, a run, an email or tester feedback.
- Design changes must not change behavior. If a screen needs a new query to look right, that's a separate commit with its own tests.

## Task 1: Extraction deep dive (investigation first, then a plan)

This is an investigation that ends in a written findings doc and a proposed change list, not a rewrite. Write findings to `.agents/research/extraction-audit.md`. Only after the owner reads it does implementation start, and each implementation item becomes its own commit with fixtures from real feeds. The `diagnosing-bugs` and `research` skills fit this task.

### What exists today (read this before the code)

There are **two separate extraction systems** that both read roaster copy, built weeks apart, with different rules:

1. **Crawl-time** (`extraction.ts`, `crawler.ts`, `crawlSources.ts`). products.json is parsed into `ExtractedProduct` with a `lotCopy` (description via `stripHtml`, tags, imageUrl, and `origin`/`process`/`roastLevel` parsed from tag conventions only, plus `roasterNotes` from four regex lead-ins over the description). Written to `products` on every crawl; a present `lotCopy` is authoritative and clears fields the feed no longer carries. `product_type` is read for classification but not stored (§16 deferred it). HTML mode uses a Firecrawl crawl (`HTML_CRAWL_PAGE_LIMIT` 10 pages) with a flat JSON schema (name, price, available, grams, url), yielding one "Default" variant per product, **no `lotCopy` at all**, and an `externalId` of the page URL or `page#name` when the URL is missing. Passenger's 27 prod lots came through this path and have no description, tags, image or notes.
2. **Request-time** (`recommendationWorker.ts`, `recommendationRules.ts`). Find my next bag scrapes up to two product pages with Firecrawl JSON extraction against a richer schema (process, variety, region, elevation, producer, roast level, tasting notes, description sentences), verifies each value verbatim against the page markdown, and stores the result as **passages of prose** in `recommendationEvidence` with a 24h TTL. It also rebuilds `catalogPassages` from `products.description` per request, including the label-run mapping from #21/#24 that turns flattened spec sheets into `Process: Washed. Variety: Heirloom.` lines. None of this is written back to `products`.

The second system already knows how to pull structured facts from a product page that the first system cannot get from the feed (Onyx and Heart keep everything in metafields; §14.4 deferred a page-scrape pass). The obvious question for the audit is whether they should be one system that writes structured fields to `products` at crawl time, with the recommendation path reading fields instead of re-deriving prose.

Schedule today: every source has `cadenceMinutes: 60` (`DEFAULT_CADENCE_MINUTES`), the cron `tick` runs every 5 minutes and claims up to `TICK_BATCH` (20) due sources, `sweepStale` hourly, raw captures pruned after 3 days. The spec's "detection within ~15 minutes" was written against a faster cadence than the one shipped. There is no way for a user or operator to start a crawl on demand; the only operator tools are `rebaselineSource` and `purgeRoasterEvents`, and #25's `setSourceMode` is still unbuilt.

### Questions to answer, with evidence from real data

Use the dev export replay method (previous handoff: `npx convex export --path x.zip` on dev, unzip `products/*`, run functions over the rows with `bun run` from `packages/backend`). Sample every one of the 20 seed feeds, not three.

**Field correctness.** For each of `name`, `description`, `tags`, `imageUrl`, `origin`, `process`, `roastLevel`, `roasterNotes`, `variants[].grams`, `variants[].name`, `variants[].priceCents`, `variants[].available`: what fraction of the 2,570 dev rows have it, and on a hand-checked sample of 10 per roaster, what fraction are _right_? Specifically look for: `origin` holding a region or farm instead of a country (or vice versa); `process` holding compound values ("Washed, Natural" on blends) or roast words; `roastLevel` catching "Lightly sweet"; `roasterNotes` clipping mid-list or swallowing the next sentence (the parked `Tasting notes: Fragrance and aroma.` truncation lives in the request-time path but the same family of bug may exist at crawl time); `grams` missing when the variant name is "12 oz" or "250g" (check how grams are derived: Shopify's `grams` field is often 0 or the shipping weight, not the bag size); "Default Title" variants; prices in non-USD feeds pre-market-confirmation.

**Where facts live per roaster.** For each of the 20: are process/variety/region/elevation/producer/notes in tags, in `body_html` prose, in `body_html` tables, in metafields (invisible to products.json), or on the page only? A 20-row table with one column per fact. This decides whether a page-scrape pass is needed for a few roasters (Onyx, Heart, maybe Sey) or for all.

**Determinism.** Same input, same output? Regex paths are deterministic. Firecrawl JSON extraction is an LLM call and is not: run the enrichment schema twice on the same five pages and diff. If values drift, the verbatim-against-markdown check is what makes the result safe, and the audit should say whether that check is enough to write into a database column (as opposed to a quoted passage). Proposal to evaluate: extraction returns candidates, a deterministic verifier accepts only values that are exact substrings of the page text and match a per-field shape (`process` from a closed vocabulary; `elevation` a number plus unit; `variety` from a known list plus free text flagged as unverified), and only verified values land in typed columns.

**Schema shape.** Should `products` gain typed columns (`variety`, `region`, `elevation`, `producer`, `productType`, `sourceOfFact` per field or per row, `copyFetchedAt`)? Should `roasterNotes` become `string[]` of descriptors rather than one clipped string? Should `lotCopy` record provenance (`feed` vs `page`) so a page-derived fact isn't cleared by the next feed crawl that doesn't carry it? Today an absent field in an authoritative `lotCopy` clears the stored value, which is right for feed facts and wrong for page facts.

**HTML-mode parity.** Passenger is the only html-mode source and its lots are bare. Can html mode use the richer per-product schema (scrape each product URL found on the grid, bounded) so html-mode lots carry copy? Is `externalId = url` stable across Passenger redesigns? What happens to logs on a lot whose externalId changes?

**Non-lot leakage, the other direction.** §16's classifier defaults to "not a lot." Sample what it rejects on each feed and count real coffees lost (false negatives). The Cold Brew Blend case was found by review; there may be more.

**Schedule.** Is 60 minutes right for everyone? Drop-culture roasters (Onyx, Sey, Regalia, Blossom, Proud Mary, Passenger) release at known times and are the ones people watch for; steady-catalog roasters barely change. Evaluate per-roaster cadence (a `cadenceMinutes` column already exists on `crawlSources`, only the default is used), a faster cadence during a roaster's historical drop windows, and whether Firecrawl/Shopify request budgets allow 15 minutes for six roasters. Check the `rawCaptures` storage math if cadence drops.

**User-started scrapes.** Design, don't build yet: a "Check now" on the roaster page (and maybe the watches page) that enqueues a crawl if the source isn't already running and its last success is older than N minutes, rate-limited per user and per source with `@convex-dev/rate-limiter`, showing "checked 40 seconds ago" afterward via the existing status chip. Decide: signed-in only? Does it fire drop events and emails like a scheduled crawl (it should; a check is a check)? What stops 50 users hammering Onyx at noon Friday (per-source cooldown, one shared crawl they all subscribe to)? Also an operator `crawlNow` internal mutation for the CLI, which is the same code path without the quota.

### Deliverables

1. `.agents/research/extraction-audit.md`: the per-field correctness table, the per-roaster fact-location table, the determinism diff, the false-negative count, and a ranked list of concrete defects each with a real fixture.
2. A proposed change list, ordered by demo visibility, each item small enough for one commit with tests: schema additions, verifier design, crawl-time page enrichment scope (which roasters, how many pages per crawl, credit cost), html-mode parity, cadence table, Check now design.
3. An ADR-0005 draft if the answer is "unify the two extraction systems." Don't write it as decided; write it for the owner to decide.
4. Issues filed for each defect found, labelled `ready-for-agent`, with fixtures in the body.

Nothing in this task deploys to prod. Fixes that come out of it follow the normal dev-then-prod path with the same rebaseline discipline §16 established (a classifier or extractor change is a catalog correction, not a drop; `rebaselineSource` before the next crawl on affected roasters).

## Task 2: Close the two prod verification gaps

Cheap, and they decide whether the video can be recorded from prod without surprises. Do them right after Task 1 so any fix has time to settle.

**2a. A fresh signup on prod.** The #16 race fix (inbox provisioning claim) has never been exercised by a new prod account; the log says so. Judges are fresh signups. Have the owner (or a tester) sign in on prod with a Google account that has never used Nouveau. Confirm: no 403 in the prod logs, the users row gets an `agentmailInbox`, the header renders, the home page loads. Record the result in `hackathon.md`. If it fails, this becomes the only task until fixed.

**2b. A real prod alert email.** AgentMail delivery was verified end to end on dev (#13, three `delivered` sends). On prod the webhook is mounted and inboxes provision, but no log entry records a prod alert reaching a real inbox with `deliveryStatus: delivered`. Read `notifications` on prod (`convex data notifications` with the prod deployment, read-only): if any row is `delivered`, note its event, roaster and timestamp in `hackathon.md` as the "genuine earlier alert" the demo will show. If every row is `pending`/`sent` and nothing has ever reached `delivered`, check the Svix webhook secret on prod and the AgentMail dashboard before assuming the code is wrong. If there are no rows at all because no watched roaster has dropped since the owner's watches were created, have the owner watch the drop-culture roasters (Onyx, Sey, Regalia, Blossom, Proud Mary, Passenger) now so a real drop lands this week.

## Task 3: The design pass

Spec §8 of `.agents/research/nouveau-reimagined-product-spec.md` gives the direction: compact lists, readable coffee names, real roaster imagery, light neutral background, graphite text, deep blue action color, dark mode preserving hierarchy, 44px touch targets, reduced motion respected, no decorative dashboards or gratuitous card containers. Mobile gets reachable Log and Save controls; desktop gets a compact navigation column. The current screens are scaffold-era (`max-w-3xl`, default spacing, every card the same weight). Tone per `PRODUCT.md`: plain, honest, specific; status copy tells the truth.

Start by setting tokens once (colors, type scale, spacing, radius) in the shared `@nouveau/ui` package so every screen inherits them, then work screen by screen in this order, which is roughly time-on-camera:

**3a. `/next-bag` form and result cards** (`recommendation-form.tsx`, `recommendation-results.tsx`). The hero. The card must visually separate three things a reader could confuse: the roaster's quoted words (source-linked), OpenAI's comparison sentence (labelled as such), and the price/size/stock line (from the database). That separation is the product's honesty story; make it legible without reading the labels. The form's "what goes to OpenAI" disclosure should read as a calm note, not a warning. The queued/running state has to look alive for 20 seconds.

**3b. Signed-in home** (`routes/index.tsx`). It grew by accretion: unhealthy banner, Want to try, Your roasters, feed, next-bag link. Reshape it into the spec's My coffee page: Want to try and recent History first, Log and Find my next bag as the two primary actions, the drop feed below with its delivery footers, the unhealthy banner as one quiet line. Don't rename routes.

**3c. Lot page** (`routes/lots.$lotId.tsx`). Image, name, roaster and status chip up top; Save and Log as the actions (Watch joins them if Task 5 ships); then description, attributes (origin/process/roast), roaster notes clearly marked as the roaster's; then logs. Archived lots should say so without looking broken.

**3d. Cards** (`feed-card.tsx`, `log-card.tsx`, `saved-coffee-card.tsx`, `lots.tsx`). One card language shared across home, feed, activity, profile, lot page and saved. Stars (`stars.tsx`) need keyboard and screen-reader labels including an unrated choice (spec §8).

**3e. Header and mobile nav** (`header.tsx`). Six links signed in is too many for 390px. Spec: My coffee (home), Discover (roasters), Activity as main destinations; Live feed, Watches, Saved, profile as utilities (a menu or secondary row). Keep all existing routes working.

**3f. Signed-out home.** Persuade duty: the live global feed proves the product works before the sign-in CTA. Directory teaser and one sentence of what Nouveau is.

**3g. Remaining routes** (`/feed`, `/activity`, `/roasters`, `/roasters/$slug`, `/watches`, `/saved`, `/profile/$userId`) inherit the tokens and cards; give each a pass for hierarchy and empty states.

Check every screen at 1440 and 390, light and dark. Attach screenshots to the `hackathon.md` entry or an issue. The spec's claim that logging a known coffee takes under 20 seconds on a phone has never been timed; time it after 3c and 3d and write down the number.

## Task 4: Outside testers

After the design pass so they see what judges see. Two or three people, fresh Google accounts, at least one on a phone. Ask them to: sign in, log a coffee they've had, run Find my next bag, save a result, find a lot page without being told how. Watch for the 20-second wait reading as "broken", for the lot page being undiscoverable, and for anything that needs a developer to fix data behind the screen. Record paraphrased feedback in `hackathon.md` (no names unless they agree), fix what interrupts the tasks, leave the rest as issues.

## Task 5: Coffee watches (only if Tasks 1 to 4 are done)

The demo's "choose an alert" step currently means "watch the roaster," which works but is weaker than watching the lot you just saved. Tight scope:

- `coffeeWatches` table `{ userId, productId, muted }`, indexes `by_user_and_product`, `by_product`.
- `notifyWatchersOfEvent` in `notifications.ts` gathers recipients from roaster watches and from coffee watches on the event's product, dedups by userId, one ledger row per (user, event). The ledger dedup guard already exists.
- `watch`/`unwatch`/`setMuted` mutations, identity from `ctx.auth`; `myWatchedProductIds` query for button state. Show coffee watches on `/watches` under their own heading.
- Watch button on the lot page and on result cards. Save and Watch stay separate; saving never watches.
- Tests: overlapping roaster and coffee watch produce one notification; muted coffee watch with an active roaster watch still delivers; two users can't see each other's coffee watches.
- Update ADR-0004 (coffee watches moved from deferred to shipped) and `PRODUCT.md`.

If the fanout dedup gets fiddly, stop and leave it deferred. The demo works without it.

## Task 6: Small leftovers, in the gaps

- Parked from #24: sentence-shaped notes values lose everything after the first clause seam (`Tasting notes: Fragrance and aroma.`). Visible on cards; a `cutValue` fix in `recommendationRules.ts` with a fixture from the replay. Replay method is in the previous handoff's Task 1 note (dev export, run `catalogPassages` over old and new rules).
- #25 code half: `setSourceMode` internal mutation next to `rebaselineSource` (args `crawlSourceId`, `mode`; resets `consecutiveFailures` and health to `watching`), one test. Fifteen minutes, closes the issue.
- #15 alert settings stub, only if the nav redesign in 3e wants a Settings entry anyway. Then also add the "Alert settings" footer line in `alertBody`.

## Still deferred (do not reopen before the video exists)

Log audience/privacy, `triedAt`, in-app updates independent of email, person follows, add-roastery flow, local scenes, prediction card, OG images. ADR-0004 records why; #20 holds the list.

## References

- Revised spec: `.agents/research/nouveau-reimagined-product-spec.md` (§6 saving and logging, §7 watch behavior, §8 frontend direction, §11 demo sequence).
- Next bag reference: `.agents/docs/recommendations.md`.
- Original locked spec: `.agents/docs/build-spec.md` (§8.2 email template, §8.4 status chips, §14 to §16 still binding).
- ADRs: `.agents/docs/adr/`.
- Issue conventions: `.agents/docs/issue-tracker.md`, `.agents/docs/triage-labels.md`.
