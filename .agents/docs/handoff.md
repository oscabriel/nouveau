# Handoff: demo-visible polish before the All Gas submission

Written 2026-09-15 from a full read of the spec docs, `hackathon.md`, all 26 GitHub issues and the code at `8388cef`. Deadline is **2026-09-22, 12:00 PM PT**. Working tree is clean; `bun run check` and 224/224 backend tests pass.

## Where the product is

Prod (`artful-chameleon-402`) runs `8388cef` and the loop works end to end: crawl 20 roasters, fire drop events, email watchers, log and rate lots, public profiles, activity feed, lot pages, and Find my next bag (real OpenAI + Firecrawl). Gates 1 and 2 of `.agents/research/nouveau-reimagined-product-spec.md` are closed. Gate 3 (#20) has no code yet. Gate 4 artifacts (video, post, testers, submission) are all unstarted.

The judged artifacts are the video, the public URL and the post. Every task below is chosen because it changes what a judge sees on screen or in the repo. Do them in order; each one is independently shippable.

## Rules for the session

- Read `.agents/docs/convex-guidelines.md` before touching `packages/backend/convex/`.
- Quality gates after every change: `bun run check`, `bun run test`, `bun run check-types`, `bun x tsc --noEmit -p packages/backend/convex/tsconfig.json`.
- Dev deploy: `CONVEX_DEPLOYMENT=dev:cool-giraffe-632 npx convex dev --once` from `packages/backend`. Prod: `bun run deploy` from the root, **only with the owner's explicit consent in the session** (see `convex-deploy-guard` skill).
- Every shipped change gets a dated `hackathon.md` entry in the existing style (what, why, evidence, Convex features used). Judges read this file.
- Vocabulary per `CONTEXT.md`: lot, roaster, watch, log, roaster notes. Never "product" in UI copy.
- Never fabricate a drop, a run, or tester feedback. A prior alert is labelled as earlier.

## Task 1: Next bag result quality (#22, #23, #24) — DONE 2026-09-15

Shipped in `c7b18bc`, on prod, issues closed. Replaying the dev `products` export showed 201 of 2,570 descriptions used colon-labelled sheets, so #24 was much wider than three rows. Parked for the owner's planned scraped-data cleanup revisit: sentence-shaped notes values are still cut at the first clause seam (`Tasting notes: Fragrance and aroma.`). Replay method, if needed again: `npx convex export --path x.zip` on dev, `UNZIP_DISABLE_ZIPBOMB_DETECTION=TRUE unzip x.zip 'products/*'`, run `catalogPassages` over `description` from old and new copies of `recommendationRules.ts` with `bun run` from `packages/backend` so `convex/values` resolves.

## Task 2: Record the first prod recommendation — DONE 2026-09-15

Run `ks752hap2q63hkq4b28ymwapa58efhbc`, recorded in `hackathon.md`: `gpt-5.6-luna`, 20 candidates over 10 roasters, one Firecrawl fact line in the pool (La Colombe) but the model quoted three catalog passages. For the video, either pick a run where a Firecrawl line is quoted or show the unquoted "Also on the product page" bullets.

## Task 3: Save (Want to try)

The revised spec's demo sequence (§11) is: log → Find my next bag → **save one** → choose an alert → see a genuine alert → share a log. Save is the one step that doesn't exist. Build only Save; skip the rest of #20 (see "Deliberately not this week").

- `schema.ts`: `savedCoffees` table `{ userId, productId, savedAt, fromRunId?: v.id("recommendationRuns") }` with indexes `by_user_and_saved_at` and `by_user_and_product`.
- New `convex/savedCoffees.ts`: `save` / `unsave` mutations (identity from `ctx.auth`, never from args), `mySavedProductIds` query, `listMine` paginated query hydrated with lot name, roaster, image, current availability from variants. Bounded reads, `returns` validators.
- Web: Save/Saved toggle on `recommendation-results.tsx` cards (pass the run id), on `/lots/$lotId` next to "Log this lot", and on `log-card.tsx` wherever someone else's log names a lot. A "Want to try" section on the signed-in home (`routes/index.tsx`) above "Your roasters", capped to a handful with a link to the full list if you build a route; a section is enough.
- Copy: "Save" / "Saved". Saving is private, does not email, does not watch. Say so once in helper text on the first save if cheap; otherwise leave it.
- Tests: two users can't see each other's saves; save then unsave; save from a run records `fromRunId`.
- Public profiles do not show saved coffees (spec §6).

## Task 4: Repo truthfulness

A judge opening the repo should not find promised screens that don't exist.

- `PRODUCT.md`: rewrite to match the revised spec. Drop Add-roastery, Local scenes, Settings, prediction card and OG images from the screen inventory; add Lot page, Activity, Profile, Find my next bag. Keep it short.
- `hackathon.md` header: "What it does" should name the whole product (remember coffees you tried, choose your next bag with OpenAI, watch roasters for drops). Add a **Demo** line (fill the link in Task 6). Bump "Last updated".
- Close #14 (resolved by the §14.4 re-scope; regex coverage is good). Re-triage #12: lots grid and header are done; directory search may not be, check `routes/roasters.index.tsx` and either do it (client-side filter over `listActive`, 30 minutes) or note it as deferred and close.
- Optional: `.agents/docs/adr/0004-hackathon-scope-cut.md`, one paragraph recording that Gate 3 shipped as Save only and why (see below). Cheap, and it explains the gap between #20 and the code.

## Task 5: Real testers

Get two or three people to sign in on prod, log a coffee, run Find my next bag, save a result. Watch or ask, note what broke or confused them, fix anything that interrupts those tasks, record the feedback (paraphrased, no names unless they agree) in `hackathon.md`. The spec's acceptance bar is "without a developer repairing data behind the screen." Nobody outside the owner has exercised prod yet.

## Task 6: Submission artifacts

- **Video**, under 3 minutes, recorded from prod, mostly clicking. Sequence from spec §11: a real logged coffee → open Find my next bag → request, open an explanation, open its Firecrawl source → Save → show a genuine earlier alert with its event and timestamp (label it as earlier) → log a coffee, open the public profile → public URL and one line per sponsor's job.
- **Post** on X or LinkedIn with the live URL, tagging @convex, @OpenAI, @firecrawl, @agentmail. Record the post URL in `hackathon.md`.
- Confirm Luma registration and eligibility with the owner.
- Confirm signed-out browsing and self-service Google sign-in work on prod in a fresh browser profile.
- Submit repo, live URL and video at https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit before noon PT Monday.

## Deliberately not this week

- Rest of #20: coffee-specific watches, log `triedAt` date, log audience/privacy, in-app updates independent of email, My coffee nav rename. Privacy in particular is all-or-nothing across every public query and none of it appears on screen in a 2:40 video. A clearly labelled "logs are public" beats a half-finished privacy model.
- Add-roastery submission flow, local scenes, prediction card, OG images, settings page (#15), `setSourceMode` (#25 code half). Prod Passenger is already fixed by hand.
- Any pipeline rewrite or module reorganisation.

If coffee watches turn out to be quick after Task 3 lands, the demo can still say "save it, then watch the roaster", which already works. Don't let it displace Tasks 4 to 6.

## Useful references

- Revised spec: `.agents/research/nouveau-reimagined-product-spec.md` (§5 next bag rules, §6 saving rules, §9 gates, §11 demo sequence).
- Next bag reference: `.agents/docs/recommendations.md`.
- Locked original spec: `.agents/docs/build-spec.md` (§14 to §16 are still binding for logs, lot pages, classifier).
- Issue tracker conventions: `.agents/docs/issue-tracker.md`, `.agents/docs/triage-labels.md`.
