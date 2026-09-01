# Nouveau — Locked Build Spec

Synthesized from the wayfinder map ([#1](https://github.com/oscabriel/nouveau/issues/1)) and its closed tickets (#2–#7). Every decision here is settled; open-during-build items are listed in §13. Language per `CONTEXT.md` (Lot, Variant, Drop event, Watch, Watch status, Crawl source, Baseline crawl, Archived lot, Local scene, Submission, Degraded alert, Taste profile).

**Deadline: Sept 22, 2026, 12:00 PM PT.** Framing rule that governs every tradeoff below: build a real product usable by real people first; the demo video is written last, from the working product, and fakes nothing.

---

## 1. Core loop

Sign up → follow roasters → get alerted when a followed roaster drops something.

At launch, matching is follow-based: everything from roasters you follow, filtered to alert-worthy Drop events (`new`, `back-in-stock`, `price_drop` — downward only). Taste profile matching is v1.1 (§13).

## 2. Launch scope

**In:** Bet 1 (personalized crawls + user-added roasters), Bet 4 (drop-rhythm prediction card), Bet 2 (OG images — user explicitly wants it; design is open, §13).

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
6. Bet 4 prediction card; Bet 2 OG images.
7. Demo video last — written from the working product.

## 13. Open during build (fog carried from the map)

- **OG image design (Bet 2)**: template, PNG generation approach, which surfaces get cards. In scope; design settles during build.
- **Degraded-alert content**: exactly what an extraction-failure alert contains (likely limited to non-Shopify user-submitted sources per ADR-0001).
- **Crawl scheduling specifics**: per-roaster cadence defaults, Crons component vs native crons, user-source quota policy. Extraction itself is settled (ADR-0001).
- **Digest design**: conditional on pipeline stability by end of Week 2; per-user inboxes mean digest threads can live in each user's inbox.
- **Stats surfaces** for silently-stored sold-out / price-rise data.
- **Taste profile + matching (v1.1)**: fields, structured vs vector matching, explanation copy; embeddings direct-to-OpenAI behind a seam.
- **Demo arc**: written last, from the working product.
