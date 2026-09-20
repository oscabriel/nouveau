# Implementation order for the design pass

The work plan for the next sessions. Every batch below is decided in the ADRs (`adr/0011` through `adr/0017`, as amended by the 2026-09-20 grill, commit `59e618f`); nothing here re-decides anything. Sessions work from this doc: pick the next unblocked task, do the work, tick its box, and add a line to the progress log at the bottom. If a task reveals a decision that was not recorded, stop and record it in an ADR first.

The hackathon closes **2026-09-22 at noon Pacific**. The next-bag loop carries a deadline rule (ADR-0017): it ships only if it works on dev by Monday morning; otherwise the one-box page and cards ship on the current single-call pipeline and the loop lands after.

## Ground rules

- Backend changes are separate commits with tests before the UI that uses them (the design-pass rule). A new query field is a backend commit, never a drive-by inside a design change.
- Read `.agents/docs/convex-guidelines.md` before backend work and `.agents/docs/code-standards.md` before calling a batch done.
- Design changes never change behavior. Where a task does both, split the commits.
- Nothing pushed to `origin` yet; `main` sits at `59e618f`.

## Batch 0: foundations (no dependencies, start two sessions here)

Everything later is unblocked by this batch; it runs in parallel.

- [x] **Install `@convex-dev/agent`** (ADR-0017). Add the package and `app.use(agent, ...)` to `packages/backend/convex/convex.config.ts`, run `npx convex dev` once so `components.agent` generates. No code uses it yet. (`d55296d`)
- [ ] **Plate assets** (ADR-0012). The owner supplies the fresh hero export in `apps/web/public/`. Agent work: downscaled footer export of the branch, serving-size exports of the six details (they are 113 to 486 pixels on their long side), cream-fringe fix riding along in every cut. The 33.8 MB and 10.7 MB source-resolution files stay untracked. Agent half done (`e38eb91`), `apps/web/public/plate/`; only the hero export remains.
- [x] **Caveat, self-hosted** (ADR-0012). Download the font, add it to the web app per `DESIGN.md`'s font rule, and register it in the type scale as the caption face. (`02e02bf`, `@fontsource-variable/caveat`, registered as `font-caveat`)

## Batch 1: addressing (ADR-0011)

The foundation everything routes on. Backend first, routes after. No page changes yet.

- [x] **User handles, backend.** `users` gains `handle` (unique, indexed, checked against the reserved list) and `oldHandles` (array). Derivation from the Google display name at first sign-in with a numeric suffix on collision. `logs.profile` looks up by handle. Tests. (`8839eca`; old-handle storage amended to a `handleRedirects` table, recorded in ADR-0011, because an array index gives the lookup no path)
- [x] **Lot addressing, backend.** Index `products` on `(roasterId, handle)`. `lots.get` takes `(roaster slug, handle)`. At upsert, a duplicate handle gets the archived lot's last-seen year appended (`ethiopia-guji-2024`), detected through the new index, no scans. Every drop, catalog, saved and recommendation query returns the roaster slug and the handle with each row. Tests. (`e68479b`; `lots.addressById` added for the old-id redirect)
- [x] **Slug hygiene, backend.** Submission enforces slug uniqueness and reserved names; `seed.ts`'s `slugOf` and `submissions.ts`'s `normalizeShopUrl` collapse into one function. This closes the `eastpole` duplicate-slug throw. (`6d8dc96`; suffix resolution recorded in ADR-0011)
- [ ] **Route tree.** New routes: `/roaster/$roaster`, `/roaster/$roaster/$lot`, `/drops`, `/settings` (+ existing `/settings/alerts`, new `/settings/appearance`, `/settings/account`), `/$user`, `/about`. Old paths (`/roasters/$slug`, `/lots/$lotId`, `/feed`, `/profile/$userId`, `/watches`, `/saved`) become real routes that redirect on mount and stay forever. Every `Link` that passed `lotId` passes the pair instead.
- [ ] **`notifications.ts` writes the new paths** (lot links, mute link to `/settings/alerts`). Verify against a sent email template on dev. Backend half in (`8cb5475`); the dev email-template check waits for the route tree + a real SITE_URL.

## Batch 2: record and queries (ADRs-0014, 0016)

Backend commits the new surfaces' data before any UI mounts it.

- [ ] **SCA wheel enum.** One module, shared by backend and web, holding the tasting-note vocabulary as a TypeScript enum with a Convex validator. Decide the cut of the wheel here (top-level categories, or top two levels; the full wheel is about a hundred leaves). `logs` gains the descriptor array, capped at four picks. Tests.
- [ ] **Rated-tiles query.** Most recent rated logs joined to lot image, name, roaster slug and handle; pad with recent drops; dedupe by user when more than three exist; Shuffle draws from the most recent fifty with photos. Tests.
- [ ] **`logs.profile` splits.** Public branch: logs only, never watches or the try list, enforced in the query. Owner branch adds watches (with health, mute) and the try list (with unsave, stock at last check). Tests.
- [ ] **Log removes save.** Logging a lot that is on the try list removes the save, with the undo toast still able to restore it. Tests.
- [ ] **Roaster notes beside personal notes.** The lot page and profile queries return `roasterNotes` beside the log's picks where the UI needs both.

## Batch 3: shared table primitives (ADR-0015)

Built once, used by every table. Do before rebuilding any page that contains a table.

- [ ] **Arrow cell.** The short right arrow replaces the circle on `DropTable`, joins the roasters directory and the lot catalog, links to the lot page everywhere.
- [ ] **Floating hover image.** One element per table, about 280 pixels wide at 3:2, above-right of the pointer, clamped to the viewport, `pointer-events: none`, fine pointer only, keyboard-focus parity anchored to the row's leading edge. The in-cell slide and the fading row number go. Rows carry an image URL; the directory shows nothing.
- [ ] **One link-class constant.** `navLinkClass` (header), `footerLink` (site-footer) and `capsLink` (roasters.index) collapse into one shared definition.

## Batch 4: chrome (ADRs-0012, 0013)

Depends on batch 1 (route names) and batch 0 (font, plate exports).

- [ ] **Header.** Left: NOUVEAU, ROASTERS, DROPS. Right: ACTIVITY plus LOGIN signed out, ACTIVITY plus the handle signed in. The handle carries the dropdown: SETTINGS, and the LIGHT / DARK pair. One nav; below `md` the right group wraps instead of mounting twice. Sign out moves to `/settings/account`.
- [ ] **Theme: system or inverted.** One switch flipping between the words LIGHT and DARK, default side from the OS, computed over `next-themes`' system value with a `matchMedia` listener. Mounted in `/settings/appearance` and the header dropdown, one stored state. Signed out: system, no control. The stored `light`/`dark` values are discarded on first load.
- [ ] **Footer.** Every route ends in it. Mirrored left links, BACK TO THE TOP center, ABOUT and GITHUB right, no user links. Below the links: the plate's parts with Caveat captions linking to Stamen, Gynoecium, Drupe (both berry images), Seed and Aril, and the large branch linking to Coffea arabica. Alt text on every image, not `aria-hidden`.
- [ ] **`/about`.** New route; copy from the hackathon log's "What it does" line and `PRODUCT.md`'s tone section.

## Batch 5: the pages

Depends on batches 1-4. Roughly independent per bullet once batches 2 and 3 land; take them in any order after the header exists.

- [ ] **Landing, one page both states** (ADR-0014). Hero (pre-rotated, leaves left, larger), NOUVEAU title, serif lede, primary slot = SIGN IN or FIND MY NEXT BAG by auth state, tiles (rated logs with black stars, pad, dedupe, Shuffle with underline instead of the dot), the drop table without Process and with MM.DD. The signed-in scaffold home is deleted.
- [ ] **Roasters directory.** Your-status column (WATCH / WATCHING), no crawl-health column, no Status column at all signed out, arrow at row end.
- [ ] **Roaster page.** Catalog rows end in the arrow; the inline log form and its tinted second row go; logging moves to the lot page. Health stays on the status line.
- [ ] **`/drops`.** `DropTable` rows with the landing's filter tabs, per event with co-dropping variants grouped, event price with its strike on price drops, "from" minimum otherwise, no variant list, no Log action. Signed-in "Your roasters" tab with `feed.personalizedFeed` and delivery lines (pending, sent, delivered) under the rows.
- [ ] **`/$user`.** Public view: logs with rating, review, structured notes, when. Owner view adds logs' edit and delete, watches with health and mute, the try list, the FIND MY NEXT BAG button, and the unhealthy-watch banner as one grey sentence. Watches and the try list never render for another viewer.
- [ ] **`/settings/account`.** Handle edit (previous handle kept as redirect), name, sign out. `/settings/alerts` is unchanged. `/settings/appearance` is the theme mount from batch 4.
- [ ] **Lot page.** Save, log, rate, REVIEW text, the four-pick tasting-notes picker beside the roaster's notes, edit and delete own logs.

## Batch 6: the next-bag loop (ADR-0017)

The biggest item. Dependent on nothing else in this plan except batch 0, but gated by the Monday-morning rule. Start it early, in parallel with batches 1-5, and cut over only when the dev re-measurement passes.

- [ ] **Jev request structuring.** After submit, one parallel batch of Choice / Noul judgments turning the free text into typed filters (budget, bag size, origin, process, flavour direction) that the search tool takes as typed args. Reuses `askJev` and the pinned `jev-1.13.0`.
- [ ] **Agent definition and tools.** `new Agent(components.agent, ...)`, model `openai.chat("gpt-5.6-luna")`. Tools as `createTool` wrappers over the internal queries the worker owns: search catalog, read lot facts (with the deferred Firecrawl read through the existing budget), check price and stock, read my logs (present only when the consent toggle is on).
- [ ] **`submitPicks`.** The terminal tool; its execute validates ids against the catalog, re-checks stock and price, writes the validated result to the run document, and returns an error for the model to fix on failure. Nothing parsed from free text.
- [ ] **Worker rewiring.** `recommendationWorker.run` stays the workpool entry: create the thread, call `agent.streamText` with `saveStreamDeltas: true`, `stopWhen: stepCountIs(n)`. Fresh thread per run, thread id stored on the run document. Quotas, watchdog, one-active-run and retry unchanged. The lexical score stays inside the search tool as its result ordering.
- [ ] **Page.** One text box, the consent toggle (default off) and its grey sentence. Subscribes to the run document and the thread (`useUIMessages`, `stream: true`): steps as tool-call parts, queued and running states, then up to five simple cards ranked by the model's fit with the why from the validated result (Jev-checked), then HOW IT LOOKED, collapsed. Thread queries authorize through run ownership.
- [ ] **Dev re-measurement.** Cost, latency, the 45-second HTTP timeout, the five-minute watchdog. This is the gate for the Monday-morning call.

## Batch 7: finishing

- [ ] **`DESIGN.md` amendments.** Drop table loses Process and the year; header entry reflects the new right side and loses ModeToggle; the type scale gains Caveat; the no-cards rule gains its one exception; the Directory, Lot catalog and Index table entries follow ADR-0015; the marquee entry becomes the plate.
- [ ] **`hackathon.md`** updated once the loop ships (the "What it does" line and the OpenAI entry describe the single-call design today).
- [ ] **Redirect verification.** Old paths resolve; sent alert emails' links land; `/$user` for a changed handle lands on the old-handle redirect.
- [ ] **Both themes reviewed on every rebuilt page**, the standing rule of the design pass.

## Progress log

| Date | Batch | What landed |
| --- | --- | --- |
| 2026-09-20 | - | All seven ADRs recorded (`f78ba65`) and every open question settled in the grill (`59e618f`). Nothing implemented. |
| 2026-09-20 | 0 | Agent component mounted (`d55296d`), Caveat self-hosted (`02e02bf`), plate serving exports defringed into `public/plate/` (`e38eb91`). Owner still owes the pre-rotated hero. |
| 2026-09-20 | 1 | User handles backend (`8839eca`): handle derivation at sign-in, RESERVED_ROUTES, `logs.profile` resolving handle/redirect/legacy id. ADR-0011 amended for the `handleRedirects` table. |
| 2026-09-20 | 1 | Lot addressing backend (`e68479b`): `(roasterId, handle)` index, `lots.get` by pair, year-append on duplicate archived handles, handle + roaster slug on feed/log/saved/candidate rows. |
| 2026-09-20 | 1 | Slug hygiene backend (`6d8dc96`): shared `slugifyDomain`, submission-time slug claim with numeric suffix, reserved names enforced. ADR-0011 amendment recorded. All three batch-1 backend items are in. |
| 2026-09-20 | 1 | Alert email paths (`8cb5475`): lot → `/roaster/$slug/$handle`, roaster → `/roaster/$slug`, mute → `/settings/alerts`. Dev template verification still open. |
