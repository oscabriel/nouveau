# Nouveau — Locked Build Spec

Synthesized from the wayfinder map ([#1](https://github.com/oscabriel/nouveau/issues/1)) and its closed tickets (#2–#7). Every decision here is settled; open-during-build items are listed in §13. Language per `CONTEXT.md` (Lot, Variant, Drop event, Watch, Watch status, Crawl source, Baseline crawl, Archived lot, Local scene, Submission, Degraded alert, Taste profile, Log, Rating, Notes, Roaster notes, Profile, Activity feed).

**Deadline: Sept 22, 2026, 12:00 PM PT.** Framing rule that governs every tradeoff below: build a real product usable by real people first; the demo video is written last, from the working product, and fakes nothing.

**Amendment 2026-09-04 (§14, ADR-0002):** the pitch is now "Letterboxd but for coffee" — logs, ratings, public profiles and one activity feed join the drop-alert core. §14 is binding like the rest; the reframe adds scope, it does not reopen the locked sections.

---

## 1. Core loop

Sign up → follow roasters → get alerted when a followed roaster drops something.

At launch, matching is follow-based: everything from roasters you follow, filtered to alert-worthy Drop events (`new`, `back-in-stock`, `price_drop` — downward only). Taste profile matching is v1.1 (§13).

## 2. Launch scope

**In:** Bet 1 (personalized crawls + user-added roasters), Bet 4 (drop-rhythm prediction card), Bet 2 (OG images — user explicitly wants it; design is open, §13), and the social layer (§14, amendment 2026-09-04).

**Out for this window:** Bets 3 (MCP/bot), 5, 6, 7. Bet 6 (watch a specific lot) is the first post-hackathon feature. Roaster claimed-listing page (schema fields survive so the market story survives). Theatrical pipeline-inspector page — replaced by the per-user watch-status panel. Digest ships only if the pipeline is stable by end of Week 2 (§13).

## 3. Reliability bar

1. **Detection ≤ ~15 minutes** from change to Drop event.
2. **Watch status is visible** — watching / stale / crawl-failed, derived from the Crawl source's health. Silence is never mistaken for "nothing new."
3. **Degraded alerts**: on extraction failure, store the raw page (`rawCaptures`) and still alert with degraded data — worse data beats no alert. In practice this applies to non-Shopify user-submitted sources; all 20 seed roasters are Shopify (`/products.json`).
4. **One email per user per Drop event**, enforced by the notifications ledger (§5).

## 4. Auth shape

- **`@convex-dev/auth` v1, pinned `0.0.95`** with `@auth/core@0.41.1`. "Auth v2" does not exist as a shippable release (reboot branch only).
- **Google OAuth is the only method.** Drop alerts live or die on reaching a real inbox; Google hands us a verified email with no email provider, no duplicate-account risk, and the least code. Password can slot in later.
- Gotchas carried from #2: `authTables` spread into the schema; `auth.config.ts` is the #1 silent-failure footgun; **two Google OAuth apps needed (dev + prod)**; consent screen shows `*.convex.site` unless a custom domain is attached.
- `users` table: `authTables` spread only, no custom fields at launch.

## 5. Data model (locked in #5)

Ten tables. High-churn crawl ops are split from the roaster profile per the churn guideline.

| Table | Purpose / key fields | Indexes |
| --- | --- | --- |
| `roasters` | `source` (curated / user-submitted), `submittedByUserId`, `status` (active / pending / rejected), city/state location fields, `claimed`/`claimedByUserId` kept for the market story, domain/slug for duplicate check | `by_slug`, `by_status_and_state` |
| `crawlSources` | `mode` (products_json / html), `cadenceMinutes`, `nextCrawlDueAt`, `health` (watching / stale / crawl_failed), `lastCheckedAt`/`lastSuccessAt`/`lastErrorAt` + message, `consecutiveFailures` | `by_next_crawl_due_at` (scheduler queue), `by_health` (stale sweep) |
| `products` (Lots) | `roasterId`, `externalId` (Shopify product id), `handle`, `name`, `status` (current / archived), `firstSeenAt`/`lastSeenAt` | `by_roaster_and_external_id` (dedup) |
| `productVariants` | `priceCents`, `grams`, `available`. Drop events cite the Variant that moved | — |
| `dropEvents` | `type` (new / back_in_stock / price_drop / sold_out / price_rise), `detectedAt`, `aiSummary`/`aiTags`, old/new price | `by_roaster_and_detected_at` (feed), `by_product` (prediction history) |
| `watches` | userId + roasterId | both directions (fanout + follower counts); counts via `@convex-dev/aggregate`, updated in the same mutation as every watch write |
| `notifications` | **Email ledger only**: userId, dropEventId, AgentMail `outboundId`, delivery status, sentAt. Doubles as the one-email-per-event dedup guard. The live feed is never stored per-user — a reactive query over `dropEvents` joined through watches | — |
| `localScenes` | userId, label, `filter` = `{ kind: "city" \| "state", value: string }`, createdAt | — |
| `rawCaptures` | roasterId, capturedAt, `storageId` (file storage — products.json bodies can exceed doc limits), `extractionOk` | — |
| `users` | `authTables` spread from `@convex-dev/auth` | — |

**Behavioral rules locked with the schema:**

1. **Baseline crawl**: a source's first successful crawl populates the lot catalog and fires **no** Drop events; alerts start from crawl #2. `pending → active` is data-driven (baseline captured), never a human review gate.
2. **Archive rule**: a Lot absent from **3 consecutive successful crawls** flips to `archived` (keeps firstSeenAt/lastSeenAt). Archived Lots can't fire back-in-stock.
3. **Watch status derives from `crawlSources.health`** — zero per-watch health storage. Staleness threshold: no successful crawl within **2× the roaster's cadence, minimum 1 hour** (build-time constant).
4. **Event semantics**: `new` / `back_in_stock` / `price_drop` (downward only) notify. `sold_out` and `price_rise` are stored silently for stats and never notify or appear in feeds until stats surfaces exist.
5. **tasteProfile omitted** at launch; arrives in v1.1 as an optional field + staged vector index.

## 6. Extraction pipeline

**ADR-0001: Shopify `/products.json` is the primary extraction target** (`docs/adr/0001-shopify-products-json-as-primary-extraction.md`). All 20 seed roasters expose it with name, price, grams, per-variant availability. HTML grid parsing (Firecrawl structured extraction) is the fallback for non-Shopify submissions and badge/copy detail.

- Firecrawl runs in **webhook mode in prod** (`httpPrefix: "/firecrawl/"`, `FIRECRAWL_WEBHOOK_SECRET`); `mode: "poll"` or the bundled mock server for local dev. `onComplete` is where orchestration belongs — carry ids via `context`, guard `status`, check `unstored` for oversized pages.
- Stock-status semantics vary by roaster (variant-level `available`, grid badges, preorders) — normalize at extraction, cite the Variant on events.
- Product titles embed vintage years, so sold-out archive Lots linger in listings — the 3-strike archive rule is the cut-off.
- Some feeds mix wholesale-only SKUs — filter at extraction.

## 7. Coverage flows (locked in #6)

### 7.1 Paste a roastery URL (Submission)

1. **Normalize**: extract the registrable domain. Roaster with that domain exists → short-circuit: create the Watch, tell the user "we already watch this one." No duplicate rows, no merge logic.
2. **Probe**: fetch `/products.json`. Coffee products returned → Shopify, proceed. Otherwise → one attempt in HTML mode with Firecrawl structured extraction.
3. **Baseline**: first successful crawl populates the catalog, fires no events; `pending → active` flips automatically. **No review queue.** Human action exists only as `rejected`, applied reactively to junk.
4. **Failure**: both probe modes fail → visible failed state — "we couldn't read this shop yet" + retry button. Failed Submissions stay out of the directory.
5. **Quota**: **5 active submitted roasters per user, 3 submissions per day**, enforced with the rate-limiter component. Keys: `user:{id}:submissions:day` + a lifetime-ish active count query.
6. The submitter's Watch is created as soon as baseline lands — watchable in under a minute.

### 7.2 Local scene

- `localScenes.filter = { kind: "city" | "state", value }`, **resolved live at read time** against roasters' city/state — correct-by-construction as the directory grows. Zip + radius deferred to v1.1 (`lat`/`lng`/`radiusKm` join the filter shape then).
- Scene page = roasters (reusing directory follow-button components) + their recent Drop events (one `dropEvents` query over the scene's roasterIds): "your local scene: 6 roasters, here's what dropped this week."
- Scenes are **private to their owner** at launch. Shareable cards are Bet 2's job.

## 8. Notification & feed UX (locked in #7)

### 8.1 Feed

- **Contents**: alert-worthy events only (`new`, `back_in_stock`, `price_drop`).
- **Two scopes**: signed-out home shows the **global live feed** (recent drops across all roasters, real-time Convex subscription, no account — the cold-start proof that watching is happening). Signed-in home becomes "your roasters" with a link to the global feed.
- **Delivery footer** on personalized-feed cards only: "Emailed you · pending → sent → delivered ✓" from the notifications ledger, live. Global feed cards stay clean.
- **Unhealthy banner**: one quiet line above the personalized feed when any watched roaster is not healthy, linking to the watches page. No per-item noise.

### 8.2 Instant alert email

One event per email. Template locked:

> **Subject:** New at Onyx: Ethiopia Mullugeta Muntasha — $35
>
> Onyx just dropped **Ethiopia Mullugeta Muntasha Natural**.
>
> _[OpenAI tasting-note summary, ~200 char cap]_
>
> 250g · $35 · **See the lot** (links to the roaster's own product page — Nouveau is the alert layer, the shop is where the action is) · Roaster page
>
> You're watching Onyx. Mute this roaster · Alert settings

- Mute ships (a watch toggle); full alert settings is a stub.
- Back-in-stock / price-drop variants reuse the skeleton: "Back at Onyx: …", "Price drop at Onyx: $35 → $28".

### 8.3 Email identity

**Per-user AgentMail inbox created at signup**, used as from/reply address for that user's alerts. Every alert thread lives in the user's own inbox from day one, so reply-to-snooze / reply-to-adjust-profile (v1.1 taste-profile work) slots in with zero migration.

### 8.4 Watch status chips

- ● Watching — last checked 4 min ago
- ● Stale — last success 2h ago, still checking
- ● Crawl failed — the shop stopped responding; we'll keep trying

Shown on the watches page and anywhere a roaster appears.

### 8.5 Bet 4 prediction card

Roaster-page card, **only when 3+ drops reveal a rhythm**:

> **Drop rhythm detected.** Onyx releases new lots on Fridays around noon — 4 of their last 5 drops landed between 12:00 and 1:15 PM CT. Next window: this Friday, ~12:15 PM. We'll watch it for you.

No rhythm, no card. Following the roaster means the prediction is armed.

## 9. Component choices (verified in #4)

| Component | Version | Notes |
| --- | --- | --- |
| `@firecrawl/firecrawl-convex` | **0.1.1 (pinned)** | webhook mode prod / poll + mock server dev; `@firecrawl/firecrawl-convex/test` for convex-test |
| `@agentmail/convex` | **0.1.0 (pinned)** | `sendMessage` from mutations (durable, returns `OutboundId`); `agentmail.status()` reactive; inbound via Svix webhook → `onMessageReceived`. No "reply-to inboxes" concept — per-message `replyTo` headers |
| `@convex-dev/auth` | **0.0.95 (pinned)** + `@auth/core@0.41.1` | Google OAuth only |
| `@convex-dev/aggregate` | current | watch/follower counts |
| rate-limiter component | current | submission quotas |
| OpenAI (direct) | — | tasting-note summaries now; embeddings in v1.1. **AI Gateway `/v1/embeddings` is unsupported (400)** — call OpenAI directly behind a small seam so the gateway can slot in later |

Env (set on dev `cool-giraffe-632` 2026-08-31): `FIRECRAWL_API_KEY`, `OPENAI_API_KEY`, `AGENTMAIL_API_KEY`. Pending: `FIRECRAWL_WEBHOOK_SECRET` + `AGENTMAIL_WEBHOOK_SECRET` when webhooks are wired. Firecrawl uses typed component env in `defineApp`; AgentMail reads plain deployment env vars.

## 10. Seed list (verified in #3)

20 US specialty roasters, **all Shopify with live `/products.json`** (verified 2026-08-30). Mix: 6 drop-culture (Onyx, Sey, Regalia, Blossom, Proud Mary, Passenger), 11 steady-catalog, 5 recognizable anchors. Regional spread across the US. Full table in the #3 resolution report.

⚠️ Untested: plain-crawler bot protection on the headless Shopify sites (Stumptown, Intelligentsia, Counter Culture, La Colombe) — **probe before promising structured extraction at scale.**

## 11. Screen inventory (locked in #7)

1. **Home** — signed-out: global live feed + directory teaser + sign-in CTA; signed-in: your feed + delivery footers + unhealthy banner.
2. **Directory** — browse/search roasters, follow buttons, "Add a roastery" entry.
3. **Add-roastery flow** — URL input → probe → baseline → watching; honest failure state with retry; quota messaging shown **before** limits are hit (plain numbers).
4. **Watches page** — status chips, last-checked times, mute/unmute.
5. **Roaster page** — Lots grid, drop history, prediction card, follow button, status chip.
6. **Local scenes** — creation (label + city/state), scene page (roasters grid + recent drops), scenes list on home/profile.
7. **Sign-in** — Google OAuth only.
8. **Settings** — alert address (from Google), mute list; deliberately minimal.

Feed cards link "See the lot" to the roaster's own product page; roaster-page links come second.

## 12. Build order

1. **Schema + seed data first** (Week 1): all ten tables, auth wiring, the 20-roaster seed list with baseline crawls.
2. Extraction pipeline: Firecrawl webhook orchestration, baseline rule, 3-strike archive, Drop event emission.
3. Watch + feed layer: watches, aggregate counts, global + personalized feeds, watch-status chips.
4. Alerts: AgentMail inboxes at signup, email ledger, locked template, mute.
5. Coverage flows: submission flow + quotas, local scenes.
6. Social layer (§14): logs + ratings, public profile, activity feed; roaster notes on lots (re-scopes #14).
7. Bet 4 prediction card; Bet 2 OG images.
8. Demo video last — written from the working product.

## 13. Open during build (fog carried from the map)

- **OG image design (Bet 2)**: template, PNG generation approach, which surfaces get cards. In scope; design settles during build.
- **Degraded-alert content**: exactly what an extraction-failure alert contains (likely limited to non-Shopify user-submitted sources per ADR-0001).
- **Crawl scheduling specifics**: per-roaster cadence defaults, Crons component vs native crons, user-source quota policy. Extraction itself is settled (ADR-0001).
- **Digest design**: conditional on pipeline stability by end of Week 2; per-user inboxes mean digest threads can live in each user's inbox.
- **Stats surfaces** for silently-stored sold-out / price-rise data.
- **Taste profile + matching (v1.1)**: fields, structured vs vector matching, explanation copy; embeddings direct-to-OpenAI behind a seam.
- **Activity feed placement**: home tab vs its own route; whether signed-in home merges the drop feed and the activity feed.
- **Profile addressing**: URL keyed by the user row id for now; pretty handles/slugs, collision policy and rename flow deferred.
- **Log editing**: author edit/delete of own logs assumed yes; retention of edited/deleted logs undecided.
- **Demo arc**: written last, from the working product.

## 14. Amendment 2026-09-04: the social layer (ADR-0002)

Reframe: "Letterboxd but for coffee." The alert core (§1, §5–§8) is unchanged; these additions give the user something that is theirs between drops. Language per `CONTEXT.md`: Log, Rating, Notes, Roaster notes, Profile, Activity feed.

### 14.1 Log

- A log records that the user tried a Lot: the `products` row, optional Rating (1–5 stars, half steps), optional personal Notes (plain text, ~1000 char cap), and the logged-at date.
- A log cites the Lot, not a Variant: the coffee is the object, the bag size isn't.
- Lots are durable (never deleted, only archived), so logs of archived lots keep resolving; an archived lot remains loggable.
- Logs are public in this window; a privacy toggle is deferred.
- Authors can edit or delete their own logs; nobody else's.

### 14.2 Profile

- One public page per user: their logs newest-first with ratings and notes, plus the roasters they watch.
- Addressing: keyed by the user row id for now; handles deferred (§13).

### 14.3 Activity feed

- One public feed of recent logs across all users, newest first, a reactive query — the same realtime Convex pattern as the drop feed (§8.1).
- Distinct from the drop feed; the drop feed is unchanged. Placement is open (§13).

### 14.4 Roaster notes on lots (re-scopes #14)

- Extraction stores what the roaster publishes — `description` (HTML stripped), `tags`, `imageUrl`, and parsed `origin`/`process`/`roastLevel` from tag conventions — on `products`. Products upsert every crawl, so new optional fields fill on the next cycle; no migration.
- `roasterNotes` is extracted only from the roaster's own text: regex over description prose first ("in the cup we find X", "notes of X", "flavors of X"), null when nothing matches. OpenAI becomes at most a strict extractor over descriptors literally present, and only if regex coverage is poor. **The AI never invents tasting notes.**
- Product-page metafield roasters (Onyx, Heart) get a later Firecrawl page-scrape pass; not this window.

### 14.5 Out of scope this window

User-follows (watching a roaster stays the only relationship), comments, likes, per-user social feeds, log privacy, DMs, moderation tooling beyond the existing submission rejection.

## 15. Amendment 2026-09-10: every lot is a page (ADR-0003)

- Each lot gets one public page at `/lots/$lotId`, keyed by the `products` row id (profile-addressing precedent; pretty handles deferred, §13).
- The page shows the lot's published copy (§14.4: name, image, description, origin/process/roast level, roaster notes), its roaster, and the lot's recent logs with ratings and tasters, newest first, capped.
- Logging lives on the lot page. Every surface naming a lot links there: feed cards gain a Log action, log cards link the lot name to the lot page (the roaster's shop link stays as "See at {roaster}"), and roaster-page lot rows link through.
- Archived lots resolve fully; old links never rot (§14.1 carries over).

## 16. Amendment 2026-09-10: a lot is roasted coffee (#17)

Observed on prod the day lot pages shipped: the feed and the Lots lists carried scales, tea box sets, filters, packaging and merch, because the only extraction filter was the wholesale rule. Everything with a price in `/products.json` became a lot and got a page.

- **Boundary.** A lot is one roasted coffee. Whole bean, ground, instant and steeped bags all count. Not a lot: brewing equipment and accessories, merch and apparel, tea and other consumables, gift cards, subscriptions and memberships, bundles, samplers and gift sets (several coffees or none), capsules and pods (a format duplicate of the bagged lot), canned/RTD/cold brew, wholesale and internal SKUs, third-party dropship items (`Shopify Collective`, white-label).
- **Signals, in order, first decisive wins** (sampled 2026-09-10 across the 20 seed feeds, `packages/backend/convex/extraction.ts` `classifyLot`):
  1. Wholesale (existing rule) → not a lot.
  2. Title says it isn't a single roasted coffee, whatever the type says: subscription, bundle, sampler, gift set/box, k-cup/capsule/pod, latte/RTD/concentrate, a drinkable container (stubbies, nitro, keg, canned, "4 Cans", "12oz Can"), bulk, add-on, hard-goods nouns (scale, grinder, kettle, mug, tee, tote…). Counter Culture files gift subscriptions under `Coffee`; Proud Mary files a Comandante grinder under `coffee-archive`. Not here: `cold brew` and brewer brands (AeroPress, Chemex), because Blossom's "Cold Brew Blend" is a whole-bean coffee typed `Coffee` (12 oz to 5 lb bags) and "Aeropress Championship Blend" is a coffee; those words only decide on untyped items (step 6).
  3. A tag whose value exactly names a non-lot (`Coffee Type: Subscription Only`, `Coffee Type: Bundle`, `recharge`, `Shopify Collective`, `white-label`, `Equipment`, `Merch`…) → not a lot. Exact match on the tag value, because Stumptown's real coffees carry `Filter: Subscription Eligible`.
  4. `product_type`, evaluated per comma-separated segment (Stumptown: `Coffee/Africa,…,Gifts` on a real blend). A segment naming equipment, merch, tea, gifts, subscriptions, RTD, supplies… is non-lot; a segment naming coffee, beans, blend, single origin, espresso, decaf, gesha, offerings, instant is a lot. Any lot segment wins over a gift segment; a `Coffee Grinder` segment is a grinder. Coava's whole-bean type is `Brewed Coffee`; PT's sold-out coffees sit under `Past Offerings Collection`. Both are lots.
  5. Untyped or unknown type: tags with a coffee vocabulary (`coffee`, `Coffee Type:`, `origin:`/`From:`/`Country:`, `Process:`, `Roast:`, a bare process, a bare producing country, `Instant Craft Coffee`) → lot. A weak non-lot tag (bare `subscription`, `recharge`, `tea`, `gift`…) → not a lot, but only when no tag says coffee: `tea` next to `Ethiopia` is a tasting note.
  6. Untyped, untagged: a title word that is never coffee (tea, matcha, syrup, a book, a brewer brand, cold brew) → not a lot, even next to a place ("Kenya Black Tea" is tea). An ambiguous word (honey, cup, chocolate) → not a lot unless a place or craft word sits in the same title ("Las Lajas Black Honey", "Cup of Excellence #4" are coffee; "Bird And The Bees Honey" is a jar). Then a title with coffee vocabulary (blend, espresso, decaf, instant, roast, a variety, a process, a producing country or famous region) → lot.
  7. Otherwise **not a lot**. An untyped, untagged "Dog Days" from a shop that types nothing is lost; the seed roasters all type their coffees, and a shop whose every item is untyped is a submission-flow problem (§7.1), not a classifier one.
- **Sold-out archives stay.** Proud Mary's 596 `coffee-archive` items and PT's `Past Offerings Collection` are real coffees at zero stock. They remain lots; a restock there is exactly the drop we want.
- **Cleanup is part of the crawl.** A products.json crawl reports the ids it rejected alongside the ids it saw. `finalizeCrawl` deletes a rejected product that is still in the catalog (with its variants, its drop events and their notification ledger rows) instead of waiting three strikes to archive it, because it never was a lot. Exception: a rejected product someone has logged is archived, not deleted (§14.1: logs never lose their lot). This also means a tightened rule set cleans prod on the next crawl, no operator step. The purge is capped at `PRUNE_BATCH` (200) products per crawl so one rule change on a Sey-sized catalog cannot blow the transaction; the feed names the same rejects next crawl, which takes the rest. Rejects are only reported for items still in the feed, so a non-lot that already dropped out and was archived by the 3-strike rule stays as an archived row; `purgeRoasterEvents`/`rebaselineSource` remain the operator tools for that.
- **Deferred.** Storing `product_type` on the lot for retroactive reclassification; a per-roaster allow/deny override; HTML-mode sources (no `product_type`, prompt already asks for coffee products).
