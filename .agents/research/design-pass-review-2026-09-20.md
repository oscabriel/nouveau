# Design pass review: `59e618f` to `9d595f2`

Written 2026-09-20. A read-only review of the work the work plan (`.agents/docs/work-plan.md`) drove, along two axes: does the code match the ADRs it cites (spec), and does it follow the repo's documented standards plus the Fowler smell baseline (standards). Nothing here changed code.

Scope: 47 commits, 78 non-asset files, +5204/-2593. State at `HEAD`: `bun run check-types` clean, `bun x ultracite check` clean, 549 backend tests pass.

Files read in full: all seven ADRs (`0011` to `0017`), `schema.ts`, `handles.ts`, `slugs.ts`, `users.ts`, `auth.ts`, `constants.ts`, `logs.ts`, `lots.ts`, `feed.ts`, `tiles.ts`, `tasting.ts`, `watches.ts`, `savedCoffees.ts`, `notifications.ts`, `crawlSources.ts` (upsert), `recommendationAgent.ts`, `recommendationWorker.ts`, `recommendations.ts`, `recommendationRules.ts`, `recommendationCatalog.ts`, `recommendationThreads.ts`, and on the web side `table.tsx`, `drop-index.tsx`, `lots.tsx`, `log-form.tsx`, `log-card.tsx`, `recommendation-form.tsx`, `recommendation-results.tsx`, `$user.tsx`, `roaster.$roaster.index.tsx`, `roaster.$roaster.$lot.tsx`, the redirect routes, `header.tsx`, `site-footer.tsx`, `lib/ui.ts`.

## 1. The decisions

The ADRs are in good shape: each has context drawn from the code as it stood, named alternatives, consequences, and a closed open-questions section. The amendments (the `handleRedirects` table, numeric suffix resolution, the wheel cut, `/v1/responses` with `store: false`) are recorded at the right level and each names the evidence that forced it.

Two things worth pushing on at the decision level:

**ADR-0017 makes the Jev why check the only guard on generated text.** The single-call pipeline had a byte-for-byte quote check and a digit filter. The loop drops both and relies on one Noul per card at threshold 0.5, applied after `submitPicks`. That is a defensible trade for the demo, but it makes `checkWhys` load-bearing, and today it is a no-op (finding S1 below).

**ADR-0011's year-suffix rule reassigns a URL.** When a shop re-sells `ethiopia-guji`, the archived lot moves to `ethiopia-guji-2024` and the new lot takes the bare handle. Every alert email, log link and saved link that pointed at the old lot now lands on the new one, silently. The ADR frames this as how a coffee person dates a coffee and never mentions the link-rot it introduces, which is the rot the redirect routes exist to prevent. Either amend the ADR to accept it in words, or reverse the rule so the new lot takes the suffix and old URLs stay stable.

## 2. Spec axis

### 2.1 Defects

**S1. The Jev why check never blanks anything.** `recommendationAgent.ts:checkWhys` builds `selections` with `why: ""` for picks Jev rejects, then returns only `{ blanked, model }`. Nothing patches `run.selections`. `recommendations.ts:summarize` appends "A why sentence was dropped because it did not match the facts." to `message` while the card still renders the unverified sentence from `run.selections`. `recommendation-results.tsx:PickCard` already handles `pick.why === ""`, so the UI is ready and the backend never delivers.

The test "the Jev claim check blanks a why that outruns the facts" (`recommendations.test.ts:995`) asserts `checked.blanked === 1` and the message text, never `selections[0].why === ""`, so it passes against a feature that does nothing. The progress log's live observation ("one claim blanked by Jev") was the note appearing, not the sentence disappearing.

Fix: `checkWhys` returns the blanked `selections`; `summarize` (or a new attempt-checked mutation) writes them; the test asserts on `selections`.

**S2. Jev's bag-size ceiling is dropped on the first search.** `recommendationWorker.ts:run` passes `maxGrams: undefined` to the initial `searchCatalogQuery` even though `bucketBag("small")` produces `{ maxGrams: 250, minGrams: 100 }`. A "small bag" request gets a floor and no ceiling on the results the model reads first.

**S3. Flavour buckets are used as literal substrings.** `filtersFromAnswers` maps Jev's answer to the bucket name (`chocolatey`), and `searchCatalogQuery` passes it to `lotMatchesTerm`, which requires that exact string in the lot's name or passages. The progress log recorded the symptom ("dark roast blend" found zero candidates against a catalog with chocolate-forward blends) as a recall miss for the owner. It is a design bug in the bucket, not tuning: either each bucket carries a synonym list (`chocolatey` matches `chocolate|cocoa|nutty|caramel`) or the flavour filter feeds the lexical ranking only and never gates candidates.

**S4. `lots.get` reintroduces the `.unique()` throw the slug work fixed.** `crawlSources.ts:yieldHandle` renames only an _archived_ collider; two current lots sharing a handle are left alone with a comment calling it a source bug. For WooCommerce and product-page shops the handle is the last URL path segment, so collisions are plausible, and when one happens `lots.get`'s `.unique()` throws for the whole lot page. Suffix current-lot collisions at upsert too, or read with `.first()` and log.

### 2.2 Gaps against the ADRs

- **ADR-0017: "Both steps show in the step list like any tool call."** Jev request structuring and the why check are not tools, so they never appear in the thread. `recommendations.latest` returns `structured` but `recommendation-results.tsx` never renders it. The user sees SEARCH, CHECKED, HANDOFF and no Jev line.
- **ADR-0014: "dedupe by user when more than three rated logs exist."** `tiles.ratedTiles` dedupes unconditionally. Two rated logs from one taster yield one log tile and two drop pads instead of two log tiles.
- **ADR-0016: the try list has no mount.** `/saved` redirects to `/$user` through `OwnProfileRedirect`, and `$user.tsx` renders `profile.watches` but not `profile.saved`. Until the batch 5 `/$user` rebuild there is no page where a user can see or unsave a saved lot. The `/watches` redirect loses mute, unwatch and health the same way (the chips on `/$user` are bare links), though `/settings/alerts` still carries mute.
- **ADR-0011: nothing writes `handleRedirects`.** Expected, since `/settings/account` is batch 5, but batch 7's "redirect verification" item will find no changed-handle path to exercise.
- **Wheel count.** The work plan and ADR-0016 say thirty-seven pickable values; `tasting.ts` has 35 distinct strings because `floral` and `green/vegetative` are both a category and a level-2 term. `tastingNoteValidator` therefore contains two duplicate literals and `TASTING_PICKER` will render each twice unless the picker filters. Correct per the published wheel; the count and the picker need to know.

### 2.3 Scope not in any ADR or batch

- `80479a2` hardcodes `https://artful-chameleon-402.convex.site` into `auth.ts` two lines below a comment that says no personal domain is hardcoded in tracked code, and points `deploy-prod.sh` at `nouveau.coffee`. Fine to ship; record it, or move the origin into env.
- `fc2974b` moved the plate exports from `public/plate/*.png` to `src/assets/coffea-arabica/*.webp`. The work plan and ADR-0012 still say `public/plate/`.

## 3. Standards axis

### 3.1 Documented rules

| Rule | Where | Note |
| --- | --- | --- |
| Convex guidelines: index name lists every field | `schema.ts` `by_user_id_and_thread` on `recommendationRuns` | Indexes `threadId`; should be `by_user_id_and_thread_id`. |
| Convex guidelines: always bounded reads | `handles.ts:claimHandle`, `slugs.ts:claimRoasterSlug` | `.collect()` over `gte(base).lt(base + "\uFFFF")`. For base `a` that is every handle starting with `a`. Add `.take(n)` or narrow to `base` and `base-` prefixes. |
| Convex guidelines: action-to-action only across runtimes | `recommendationAgent.ts:readLotFacts` → `ctx.runAction(internal.recommendationWorker.readLot)` | Both sides run in Node. The seam exists because `recommendationAgent.ts` (which exports `internalQuery`) cannot import Node-only `readPageFacts`. Acceptable; the file comment should say so. |
| Code standards: `as const` for immutable values | `constants.ts:RESERVED_ROUTES` | Mutable `string[]`. `as const` also narrows `isReserved`. |
| Code standards: narrowing over assertions | `recommendationAgent.ts:readLotFacts` (`as unknown as Promise<ReadLotResult>`), tests (`checkWhys(null as never, …)`) | The first should type through the action's `returns` validator. |

### 3.2 Smell baseline (judgement calls)

- **Duplicated Code, clear.** The "first free numeric suffix" algorithm appears three times: `handles.ts:claimHandle`, `slugs.ts:claimRoasterSlug`, `crawlSources.ts:yieldHandle`. Same range scan, same regex, same `while (used.has(n))` loop. ADR-0011 collapsed two slug derivations into one function and the implementation then grew three claimers. The regexes also disagree: `claimHandle` anchors on `^base-(\d+)$`; the other two use `-(\d+)$` unanchored, so `eastpole-north-2` marks `2` as used for base `eastpole`. One `nextFreeSuffix(taken: Set<string>, base: string)` helper closes it.
- **Mysterious Name.** `logs.profile` still takes `args.userId`, which now holds a handle, a retired handle, or a legacy id. `address` would be honest.
- **Speculative Generality, mild.** `MAX_STEPS` is set as `stopWhen` on both the `Agent` and the `streamText` call.
- **Duplicated read.** `tiles.ratedPool` fetches each product to check for a photo; `ratedTiles` fetches the same products again to hydrate. Carry the product through the pool.

### 3.3 Done well

`table.tsx` is the strongest new file: one element per table, `data-image-url` opt-in, fine-pointer gate with a live `matchMedia` listener, focus parity anchored to the row's leading edge, hide on scroll and resize, and it keeps its last frame so a row-to-row move swaps the source without flicker. `logs.profile` enforces the public/owner split in the query with a `kind` discriminant, exactly as ADR-0016 asked. `recommendationThreads.list` authorizes through run ownership and projects the component's message shape down to what its validator promises. The attempt-checked internals (`activeAttempt`) make every tool a no-op after a watchdog expiry, which is what keeps the loop safe to retry. `lots.$lotId.tsx` → `roaster.$roaster.$lot.tsx` is a clean move: only the params and the import path changed.

## 4. Summary

Spec: 4 defects, 5 gaps, 2 scope items. Worst: S1, the Jev why check discards the selections it blanks, so ADR-0017's one guard on generated text does nothing, and its test is named for behaviour it does not assert.

Standards: 5 documented-rule findings, 4 smells. Worst: the suffix-claim algorithm written three times with inconsistent regexes, in a batch whose goal was collapsing duplicated slug logic.

## 5. Suggested order of fixes

1. S1 (why check persists blanked selections, test asserts on `selections`). Before the Monday-morning gate; it is the safety claim the hackathon copy will make.
2. S3 (flavour synonyms or ranking-only), then S2 (`maxGrams` on the first search). Both change what the model sees on step one.
3. Extract `nextFreeSuffix`; fix the unanchored regexes while there.
4. S4 (`lots.get` collision handling).
5. Render `structured` as a Jev step line; the ADR promised it.
6. Doc drift: plate path in the work plan and ADR-0012; the `auth.ts` origin comment; the wheel count.
7. Amend ADR-0011 on the year-suffix URL reassignment, one way or the other.

---

The second pass lives in `design-pass-review-2026-09-20-part-2.md` (tests, unread web files, docs drift, ADR cross-references, codegen sync). The same headings, same scales; read both.
