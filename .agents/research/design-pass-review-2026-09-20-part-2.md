# Design pass review, part 2: `9d595f2` to `d6f1e63`, plus what part one did not read

Written 2026-09-20, the second read-only pass. Part one (`design-pass-review-2026-09-20.md`) covered the backend and the web files it lists; this pass covers the test files, the web files part one skipped, the batch 5 commits that landed after part one was written (`f8b5ec6` to `d6f1e63`, twenty commits, `+1657/-784`), the docs, the plate assets, the older ADRs, and codegen. Same two axes, same scales, same numbering continued (S5 onward). Nothing here changed code.

State at `HEAD` (`d6f1e63`): `bun run check-types` clean, `bun x ultracite check` clean, 560 backend tests pass (549 in part one; `users.test.ts` added eleven). `npx convex codegen --typecheck disable` against the dev deployment left `_generated/` unchanged, so `api.d.ts` is in sync. Codegen prints "Uploading functions to Convex..." during its component dry-run; it did not change what runs on dev.

Files read in full: `users.test.ts`, `tiles.test.ts`, `recommendationThreads.test.ts`, the new sections of `logs.test.ts`, `lots.test.ts`, `crawlSources.test.ts`, `roasters.test.ts`, `submissions.test.ts`, `recommendations.test.ts` lines 355 to 1060, the diffs of `notifications.test.ts`, `pageFacts.test.ts`, `crawler.test.ts`, `savedCoffees.test.ts`, `feed.test.ts`; `users.ts` (the batch 5 diff), `handles.ts`, `feed.ts` (diff); on the web side `routes/index.tsx`, `__root.tsx`, `$user.tsx`, `drops.tsx`, `settings.account.tsx`, `settings.appearance.tsx`, `watches.tsx`, `saved.tsx`, `activity.tsx`, `header.tsx`, `latest-tiles.tsx`, `tasting-picker.tsx`, `theme-provider.tsx`, `theme-switch.tsx`, `stars.tsx`, `save-button.tsx`, `saved-coffee-card.tsx`, `own-profile-redirect.tsx`, `site-footer.tsx` (the plate half), `lib/theme.ts`, `lib/drops.ts` (diff), `drop-index.tsx` (diff), `log-form.tsx` (diff), `log-card.tsx` (diff), `roasters.index.tsx` (diff), `tasting.ts`, both `package.json` diffs.

## 1. The decisions

Batch 5 landed one amendment (ADR-0012: the header label is the first name, sign out joins the dropdown, `ensureMyHandle` backfills legacy rows) and it is recorded where it should be. Two things at the decision level:

**ADR-0011 promises a retired handle keeps resolving, and nothing reserves it.** The redirect table is the mechanism; the promise also needs the retired handle kept out of the pool new users and other users draw from. Neither claimer does that (S5 below). The ADR text does not say whether a retired handle is reserved for its old owner forever, for a period, or not at all. It needs one sentence.

**ADR-0014's dot went, ADR-0013's dot stayed.** ADR-0014 removed the 8 pixel dot from LATEST / SHUFFLE in favour of an underline. `theme-switch.tsx` still describes itself as "in the LATEST / SHUFFLE vocabulary: the active side is ink with a filled dot" and renders the dot. The two pairs of caps toggles now mark the active word two different ways. Either is fine; pick one.

## 2. Spec axis

### 2.1 Defects

**S5. A retired handle can be taken by anyone, and taking it deletes the old owner's redirect.** `handles.ts:claimHandle` (first sign-in) and `users.ts:updateMe` (settings) both check `users.by_handle` only. `handleRedirects` is never consulted when a handle is handed out. Two paths:

- A new Google user named "Ada Lovelace" signs up after Ada moved to `ada-2`. `claimHandle` sees `ada-lovelace` free and gives it to the newcomer. `logs.profile` resolves current handles before redirects, so every link to `/ada-lovelace` now lands on a stranger. Ada's redirect row stays in the table, dead.
- User B calls `updateMe({ handle: "ada-lovelace" })`. `taken` is null, so B gets it, and the "reclaimed" branch deletes Ada's redirect row without checking `reclaimed.userId === userId`.

ADR-0011: "the previous handle is kept as a redirect ... so no shared `/$user` link rots." The test "a taken handle is rejected" (`users.test.ts`) covers a current handle only; nothing covers a retired one. Fix: both claimers query `handleRedirects` as well as `users`; `updateMe` allows the reclaim only when the redirect row belongs to the caller; two tests (a stranger's `updateMe` and a stranger's `createUser` against a retired handle).

**S6. The undo toast never appears for a save made with the Save button.** `logs.createLog` returns `removedSaveFromRunId: Id | null`. It is `null` when no save was removed and also `null` when the removed save had no `fromRunId`, which is every save made from a lot page, a log card or the try list. `log-form.tsx` branches on that one value: `null` shows "Logged." with no mention of the removal and no undo. Only a save that came from a Find my next bag run gets the promised toast.

ADR-0016: "Logging a saved lot removes it from the try list, with a toast that says so and an undo." The test "logging a saved lot removes it from the try list" (`logs.test.ts:173`) asserts `removedSaveFromRunId` is `null` after removing a manual save, so it pins the conflation. Fix: return `removedSave: { fromRunId: Id | null } | null`; the form branches on the outer null; the test asserts the outer object is present.

**W1. The `/drops` tab strip disappears on the Your roasters tab.** `drops.tsx:FeedComponent` renders `GlobalDrops` (which owns the `role="tablist"` strip) for every filter except `your`, and `YourDrops` alone for `your`. Once a signed-in user clicks Your roasters there is no tab to click back; the only way out is a reload or leaving the page. Signing out while on the tab leaves `mine` skipped and the body on `Loader` forever. Fix: lift the tab strip out of `GlobalDrops` so both bodies sit under it; reset `filter` to `all` when `isAuthenticated` turns false.

**W2. The picker renders two "floral" chips and two "green/vegetative" chips.** `tasting.ts:WHEEL` lists the category name as its own level-2 wedge for those two categories (correct per the published wheel, as part one noted), and `tasting-picker.tsx` renders the category chip and then every note chip without filtering the self-named one. Two identical buttons, same label, same `aria-pressed`, toggling the same value. `tastingNoteValidator` also carries the two literals twice, which is harmless. Fix: in `TASTING_PICKER`, drop notes equal to their category, or render the category chip only when the wheel does not already list it.

### 2.2 Gaps against the ADRs

- **Tests that pin a divergence from the ADR.** Part one flagged that `tiles.ratedTiles` dedupes by user unconditionally where ADR-0014 says "when more than three rated logs exist". The test "one taster cannot fill all three tiles" (`tiles.test.ts`) inserts exactly three rated logs from two tasters and asserts two tiles, so a fix to match the ADR fails the test. The same for S4: "a handle collision with a current lot is left alone" (`crawlSources.test.ts`) asserts the two-current-lots state that makes `lots.get` throw. Both tests should move with the fix, and the review of any fix should check they did.
- **The consent guarantee has no test.** `buildAgent(ctx, includeNotes)` adds `CONSENT_TOOLS` only when the toggle is on; that is the one gate between a user's logs and the model, and nothing asserts `buildAgent(..., false).tools` lacks `myLogs`. The `myLogsQuery` test says "the consent flag is the only gate" in a comment and tests the query, not the gate. One unit test on the tool map closes it.
- **S2 and S3 have no test coverage path.** No test drives `recommendationWorker.run` past the model call, so the dropped `maxGrams` on the first search and the literal-substring flavour filter can only be caught by reading. "Jev's answers map onto typed filters" tests `filtersFromAnswers` alone. A test that calls `searchCatalogQuery` with `flavour: "chocolatey"` against a lot described "chocolate and caramel" would fail today and is the right shape for the S3 fix.
- **`users.test.ts` carries a stale comment.** "The handle change itself lands with /settings/account (batch 5); here the redirect row and the new handle stand in for it." `updateMe` landed in `2ce1e7a`; the test should call it.
- **ADR-0016, "the profile rows ... show the latest rating."** `$user.tsx` renders every log as its own `LogCard`; two logs for one lot show two rows with two ratings. ADR-0002 allows many logs per lot, and the ADR-0016 sentence reads as one row per lot with the latest rating. Either the profile groups by lot or the ADR sentence means "each row shows its own rating", which is what the landing tiles do. Worth one line in the ADR.
- **ADR-0015, "no Status column at all signed out."** Done: `roasters.index.tsx` gates both the `th` and the `td` on `canWatch`. Recorded so the next reader does not re-check it.
- **ADR-0016 gap from part one, the try list has no mount.** Closed by `8c3f5d2`: `$user.tsx` renders `profile.saved` through `SavedCoffeeCard` with its `SaveButton` toggle, and `WatchRow` carries mute and unwatch. The `/watches` and `/saved` redirects now land somewhere that has the controls.

### 2.3 Scope not in any ADR or batch

- **`/activity` is untouched.** ADR-0016 says it "stays the community feed" and no batch rebuilds it. It still runs the scaffold layout (`container mx-auto max-w-3xl`, `text-2xl font-semibold`, an em dash in its copy). `DESIGN.md` line 206 lists it among routes whose "composition is not yet part of this system". Every rebuilt page links to it (the header, the profile's not-found copy). Fine to ship; record it as the one un-redesigned public page or add it to batch 7.
- **Scaffold-era controls mount inside rebuilt pages.** `SaveButton` (`rounded-md border`, `text-emerald-500` icon), `SavedCoffeeCard` (`rounded-md` thumbnail), `LogCard`'s tasting-note chips and `TastingNotesPicker` (`rounded-full`), `Stars` (amber fill outside the tiles). `DESIGN.md`: "The only round shapes are dots" and no accent colour. They now sit on `/$user` and the lot page. No ADR chose to keep them; none chose to change them.
- **`settings.account.tsx` hardcodes `nouveau.coffee/`** as the handle prefix. Same theme as part one's `auth.ts` origin: fine to ship, but it lies on any other host, and `window.location.host` is one line.
- **`handleRedirects` grows one row per handle change with no cap.** A user can churn handles and accumulate rows; each is one indexed read, so the cost is storage, not latency. Not a defect; a note for the day rate limits come up.

## 3. Standards axis

### 3.1 Documented rules

| Rule | Where | Note |
| --- | --- | --- |
| Code standards: narrowing over assertions | `drops.tsx` (`row as PersonalizedRow`, `filter as DropType`) | `underRow` is typed on `DropRow` and cast back per row. Type `DropTable` generically over its row, or pass `underRow` already bound to `PersonalizedRow[]`. |
| Code standards: no magic numbers | `drops.tsx:DeliveryRow` `colSpan={10}` | The table has nine columns after Process left (seven on a roaster page, where Roaster and City go). Over-spanning is harmless in HTML and wrong the day a column is added. Derive it or export a column count from `drop-index.tsx`. |
| Convex guidelines: authorization checks the stored row | `users.ts:updateMe` "reclaimed" branch | Deletes a `handleRedirects` row by handle without comparing `reclaimed.userId` to the caller. S5. |
| Design pass rule: design changes never change behaviour | `f8f83d4` | Also changes `formatDropDate` from `YYYY.MM.DD` to `MM.DD`. ADR-0014 decided it, so the behaviour is intended; the commit mixes it with the `/drops` rebuild. Minor. |

### 3.2 Smell baseline (judgement calls)

- **Duplicated Code.** The LIGHT / DARK pair (`[{ name: "Light", target: "light" }, { name: "Dark", target: "dark" }] as const`) is defined in `header.tsx:HandleMenu` and again in `theme-switch.tsx:ThemeSwitch`, with `useThemeControls` already the shared seam between them. Export `THEME_SIDES` from `theme-switch.tsx`.
- **Mysterious Name.** `settings.account.tsx:signOutConfirmed` confirms nothing; it calls `signOut` and toasts.
- **Speculative Generality, mild.** `DropTable`'s `onlyTypes` is a filter over rows the caller already holds; `drops.tsx` computes `shown` for the empty-state check and then hands `DropTable` the unfiltered `feed` plus `onlyTypes` so it filters again. Pass `shown`.
- **Inconsistent hover.** `site-footer.tsx:PlateDetail` fades its image on hover (`group-hover:opacity-80`); `DrupePair` sets `className="group"` on both anchors and gives neither image the fade.
- **Eager footer images.** The footer mounts on every route and its seven images have no `loading="lazy"`; the branch is 1200 by 1200 (187 KB) rendered at 176 to 256 pixels. Halving the export or lazy-loading it is a one-line change either way.

### 3.3 Done well

`users.ts:updateMe` gets the hard part right: it validates the handle with the same `isValidHandle` and `isReserved` the derivation uses, writes the redirect for the previous handle only when no row exists (so one row per retired handle), skips the whole handle branch when the value is unchanged, and trims and caps the name. The tests around it are specific ("reclaiming a retired handle removes its redirect row", "a legacy row takes its first handle with no redirect row") and assert on the table, not the return value. `$user.tsx` adopts the canonical handle into the URL with `replace: true`, so a retired-handle or legacy-id link resolves and then the address bar shows the current handle; the public/owner split is a `kind` discriminant the component narrows on, and `OwnerRecord` is unreachable for a public profile by type, not by prop. `theme-provider.tsx:ThemeSync` applies the relation in a layout effect so an inverted dark-OS visitor never sees the light page flash, and re-applies on the `prefers-color-scheme` change event. `roasters.index.tsx` hides the Status column's header and cells together on one boolean. `tiles.test.ts` is the best-shaped new test file: fixtures insert logs and drop events directly with controlled `loggedAt`, and the shuffle test checks stability per seed and vocabulary across seeds without asserting an order it cannot know.

## 4. Docs, assets, records, codegen

**Docs commits since `59e618f`.** `DESIGN.md`, `CONTEXT.md`, `hackathon.md` and `PRODUCT.md` have no diff. `CONTEXT.md` already carried Handle, Try list and the new Profile address before implementation, and matches what shipped. `DESIGN.md` drift is batch 7's open item; two lines to add to that list that it does not name: line 127 "The default theme is light" (ADR-0013 made it system) and line 198 "the filled ink block is for sign-in only" (ADR-0014 shares the block with Find my next bag, and `/settings/account`'s Save uses it too). `hackathon.md` still describes the single-call design ("Responses API, strict JSON schema"), batch 7 as planned. `.agents/docs/recommendations.md` (Gate 2) still documents the byte-for-byte quote check and `filterReason`, both of which ADR-0017 removed; ADR-0017 says it amends that doc and the doc has no note pointing back.

**Plate assets.** `fc2974b` moved the exports to `apps/web/src/assets/coffea-arabica/*.webp`, seven files, all tracked, all referenced by `site-footer.tsx` (part one saw no references because the footer landed after). Sizes: branch 1200x1200 at 187 KB, stamens 540x540 at 21 KB, the five details 5 to 15 KB each at 113 to 291 pixels on the long side, so the "serving-size exports" item is done. `public/plate/` no longer exists; the work plan's batch 0 bullet and ADR-0012 still name it. The hero `public/coffea-arabica.png` is the 2026-09-16 file (568 KB, 580x900), so the pre-rotated export is still the owner's, as the work plan says.

**Older ADRs.** ADR-0002, 0003 and 0004 carry no frontmatter status and no amended-by or extended-by note pointing at 0011 or 0016; a reader of ADR-0003 still learns that lots live at `/lots/$lotId`. ADR-0008 and 0010 have their own amendment sections and are not cited by ADR-0017, so the handoff's guess that 0017 amends them does not hold; no action there.

**Codegen.** `npx convex codegen --typecheck disable` from `packages/backend` (dev deployment per `.env.local`) produced no diff under `convex/_generated/`. In sync.

**Live checks (work plan batch 1 and 7).** Left as owner tasks: the email-template link check needs a real `SITE_URL`, the `/next-bag` page read needs a signed-in run, and the hover image needs a pointer.

## 5. Summary

Spec: 4 new defects (S5, S6, W1, W2), 7 gaps, 4 scope items. Worst: S5, the retired-handle promise of ADR-0011 has no enforcement, and the one path that touches another user's redirect row does so without an ownership check. Then S6, the undo the ADR promises fires only for run-cited saves, which are the minority.

Standards: 4 documented-rule findings, 5 smells. Nothing here is worse than "minor".

Tests: the pattern part one named in S1 (a test named for behaviour it does not assert) has two cousins here: a test whose assertion pins a conflated return value (S6) and two tests whose assertions pin a divergence from the ADR (tiles dedupe, current-lot collision). The consent gate has no test at all.

## 6. Suggested order of fixes

Part one's list stands. Slot these in:

1. S5 (both claimers consult `handleRedirects`; `updateMe` checks the redirect's owner; two tests). Alongside part one's item 1; it is the other safety claim on a URL.
2. W1 (`/drops` tabs outlive the Your roasters tab). Visible in the first minute of a signed-in demo.
3. S6 (`createLog` returns the removed save as an object; the form branches on it; the test asserts the object).
4. W2 (the picker filters self-named notes).
5. The consent-gate unit test on `buildAgent(..., false)`.
6. Move the two ADR-divergent tests with the fixes for tiles dedupe and S4.
7. Docs: `recommendations.md` gets a pointer to ADR-0017; ADR-0002/0003/0004 get amended-by lines; `DESIGN.md`'s batch 7 list gains the theme default and the filled-block rule; the work plan and ADR-0012 name `src/assets/coffea-arabica/`.
8. The scaffold-era controls (`SaveButton`, chips, stars) and `/activity`: decide in an ADR or a batch 7 bullet, one way or the other.

---

Part one is `design-pass-review-2026-09-20.md`; the same headings and scales apply. Read both.
