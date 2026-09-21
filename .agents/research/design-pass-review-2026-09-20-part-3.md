# Design pass review, part 3: `a3841e6` to `59bba41`

Written 2026-09-20, the third read-only pass, before the first push to `origin`. Parts one and two covered the design pass through `d6f1e63` and their fixes are logged in the work plan's "review fixes" rows. This pass covers the twenty-two commits after `a3841e6`: the loop's live fixes (the pane, `pickLot`, the word-filter removal, the ceiling rule), the docs catch-up, and the batch 7 design pass of the controls, `/activity` and the lot route, plus the three commits of the eighth session (`/activity` own rows, the account spinner, the sweep). Same two axes, same scales, numbering continued (S7 onward, W3 onward). Nothing here changed code.

State at `HEAD` (`59bba41`): `bun run check-types` clean, `bun x ultracite check` clean, 573 backend tests pass. The redirects and both themes were checked headless on dev this session (work-plan rows dated 2026-09-20, batch 7); every signed-in state remains unseen by anyone but the owner, and the owner has seen only the `/activity` row in dark and one pane run.

Files read in full: `recommendationAgent.ts` (diff), `recommendationRules.ts` (diff), `recommendations.ts` (diff plus `request`, `retry`, `claim`), `recommendationWorker.ts` (`run`), `recommendationCatalog.ts` (diff), `schema.ts` (diff), the test titles of `recommendations.test.ts`; on the web side `log-card.tsx`, `log-form.tsx`, `tasting-picker.tsx`, `stars.tsx`, `save-button.tsx`, `activity-feed.tsx`, `next-bag-sheet.tsx`, `next-bag-run.tsx`, `lib/next-bag-search.ts`, `routes/roaster.$roaster.$lot.tsx`, `routes/next-bag.tsx`, `routes/activity.tsx`, `routes/settings.account.tsx`, the diffs of `$user.tsx`, `index.tsx`, `__root.tsx`, `latest-tiles.tsx`, `saved-coffee-card.tsx`; `packages/ui/src/components/sheet.tsx`; the ADR-0017 amendments, the `DESIGN.md` entries for the new controls, the `hackathon.md` diff, `CONTEXT.md`'s Save and Try list terms.

Spec sources: ADR-0011, ADR-0014, ADR-0016, ADR-0017 with its five 2026-09-20 amendments, `DESIGN.md`, `CONTEXT.md`, and the batch 7 checkboxes in `.agents/docs/work-plan.md`. There is no issue for this range; the ADRs and the work plan are the spec.

## 1. The decisions

Five ADR-0017 amendments landed in this range and each is recorded in the ADR with its reason and its date. The code matches them: `pickLot` appends in call order, `finish` marks ready on whatever is stored, the search tool carries only `query` and the three numeric fields, `appliedFilters` drops a value at its ceiling, and a settled run stops reading the thread. Two things at the decision level:

**ADR-0016 named the section "try list" and the page still says "Want to try".** `CONTEXT.md` line 47: "_Avoid_: Want to try (the old section title)". `$user.tsx:149` renders the section h2 as "Want to try", and `log-form.tsx:73` toasts "Logged. Removed from Want to try." `save-button.tsx:66` says "Remove from your try list" in the same app. The vocabulary was decided; the two strings were not moved. See W3.

**ADR-0017 says the pane is ephemeral and the thread is kept; the worker comment still calls the thread the HOW IT LOOKED record.** `recommendationWorker.ts:139` "the thread is the run's HOW IT LOOKED record". The owner cut HOW IT LOOKED from the pane on 2026-09-20 (ADR-0017, last amendment). The thread is still the record, the label is gone. One comment.

## 2. Spec axis

### 2.1 Defects

**W3. Two "Want to try" strings survive the CONTEXT.md term.** `$user.tsx:149` (the h2) and `log-form.tsx:73` (the toast). CONTEXT.md lists the phrase under _Avoid_ for the Try list term. The toast is the worse of the two: a person who just clicked SAVE on a lot page (which says "Save", "Saved" and "Remove from your try list") is then told it was removed from "Want to try", a name they have never seen unless they have opened their own profile. Fix: h2 "Try list", toast "Logged. Removed from your try list." Check `DESIGN.md`'s profile entry names the section the same way.

**W4. The lot page blocks on the viewer query.** `roaster.$roaster.$lot.tsx:284`: `if (page === undefined || me === undefined) return <Loader />`. `getCurrentUser` only decides `isMine` on log rows. Signed out it resolves to `null` fast, but on a cold load the page waits for two round trips before showing a lot that needs one. The account page had the mirror of this bug (`18a62d6`, the spinner that never ended); here it ends, it just costs a render. Fix: gate on `page` alone; `isMine` already tolerates `me === undefined` through `me?.id`.

**W5. `isMine` on the lot page is a search inside a search.** `roaster.$roaster.$lot.tsx:306`: `page.logs.some((log) => log.logId === logId && log.user.id === me?.id)`, called per row from inside `page.logs.map`. The row already holds `log.user.id`. `activity-feed.tsx:38` does it in one comparison. Fix: `isMine={log.user.id === me?.id}`, delete the helper.

### 2.2 Gaps against the ADRs and DESIGN.md

- **`DESIGN.md` Log form says SAVE LOG; the edit path says UPDATE LOG.** `log-form.tsx:191`. Not wrong, not recorded. One clause in the entry, or one label.
- **`DESIGN.md` Log row says "the picks joined by middle dots".** True for tasting notes (`log-card.tsx:120`). The lot page's ROASTER NOTES also join by middle dot (`roaster.$roaster.$lot.tsx:220`) but the same notes reach `LogForm` as `roasterNotes` joined by ", " (`roaster.$roaster.$lot.tsx:361`), and `log.lot.roasterNotes` on a row arrives already joined by the backend. Three joiners for one field on one page. Pick the middle dot everywhere on the web side; the backend string can stay as data.
- **`hackathon.md` has no batch 7 entry.** The header and eight entries cover `bb30df1` to `5d0dbcb`; the controls, `/activity`, the lot route and the sweep (`fd29a60` to `59bba41`) are not there. The handoff already queues it; recording it here so the review is complete.
- **The pane's `SaveButton` grew.** Part two's carried-over note stands: the card's `SaveButton` lost `size="sm"` with the redesign and is 44px tall in an 88px card. `DESIGN.md` says "one size at every mount", so this is by decision; nobody has looked at a card with it live since the pane run predates `2d07559`.
- **ADR-0017: "each card is a fixed component over validated fields".** True. `PickCard`'s `img alt={candidate.name}` repeats the `h3` text for a screen reader; `alt=""` is the usual answer when the name sits beside the image. Minor.

### 2.3 Scope not in any ADR or batch

- **`/settings/alerts` keeps the scaffold shell.** Declared token-only in `DESIGN.md`'s not-canonized paragraph, so in scope for nothing. The sweep confirmed both themes render it; the centered `container` layout is the only rebuilt-era page a signed-out visitor can reach that does not use the inner-page shell.
- **The `/drops` and `/` filter strip scrolls sideways at 390 with nothing to show it does.** `overflow-x-auto`, 408px of tabs in a 335px box, "Price drop" cut to "Price dr". Works by touch; looks clipped. A fade at the right edge or a wrap is a design call for the owner. Carried over from the sweep row.
- **The profile title's count and its subline repeat the number.** `$user.tsx`: `PageTitle count={logs.length}` and "1 log" on the next line. Either is enough.

## 3. Standards axis

### 3.1 Documented rules

| Rule | Where | Note |
| --- | --- | --- |
| Code standards: "Always `await` promises in async functions"; the repo's own habit is `void` on fire-and-forget | `log-card.tsx:150` `deleteLog();`, `log-form.tsx:187` `save();` | Both are async and called bare from `onClick`. The same files' neighbours (`next-bag-sheet.tsx`, `next-bag-run.tsx`, the lot route) write `void submit()`, `void retryRun()`, `void ask()`. Not flagged by Ultracite; the inconsistency is the finding. |
| Code standards: "Use semantic HTML and ARIA attributes" | `tasting-picker.tsx:58,73` `disabled={full && !picked}` | Disabled buttons leave the tab order, so a keyboard user at four picks cannot reach a fifth note to hear it is unavailable. `aria-disabled` keeps the button reachable and announces the state; the click handler already refuses (`full` check in `toggle`). Judgement call: the doc comment promised `disabled` and the code now delivers it, so this is a choice, not a slip. |
| Code standards: no magic strings for a domain concept | `next-bag-run.tsx:70` `“${query}”` | Typographic quotes in a template literal, the only place in the app that draws them. `DESIGN.md` does not say which quotes the UI uses. Fine either way; decide once. |
| AGENTS.md prose rules (rule 19, straight quotes) | same | Applies to repo prose, not UI strings; noting the overlap only. |

### 3.2 Smell baseline (all judgement calls)

- **Duplicated Code.** `tasting-picker.tsx`: `noteClass(picked, !full || picked)` and `disabled={full && !picked}` compute the same predicate twice per button, once inverted. Compute `const locked = full && !picked` once per note and pass it to both. Same shape on the category button and the note button (two copies of an eleven-line JSX block that differ only in the value). One `NoteButton` component would do.
- **Duplicated Code.** The dot toggle (`label-caps inline-flex min-h-11 items-center gap-2 ...` plus the `size-2 rounded-full bg-current` span with `opacity-100 / opacity-30`) is written out in `save-button.tsx:71`, `log-form.tsx:136` (RATE IT) and `next-bag-sheet.tsx:122` (Include my logs), and the watch control before them. Four copies of the WATCH / WATCHING shape. `DESIGN.md` calls it one control; the code has no component for it. A `DotToggle` in `apps/web/src/components` would carry the class strings once.
- **Duplicated Code.** `drops.tsx:FilterTabs` and `drop-index.tsx:FilterTabs`, carried over from part two. Still two.
- **Mysterious Name.** `recommendationAgent.ts:SearchFilters` and `recommendationRules.ts:SearchFilters` are two exported interfaces with one name and different shapes (the tool's three numbers; the validator's three numbers plus `preferences`). Both are imported into the same module graph. Rename the tool's to `ToolFilters` or reuse `BudgetFilters`, which is the shape it is.
- **Speculative Generality.** `structuredFilters` and `recommendationRuns.structured` exist so older dev runs validate (ADR-0017, amendment two). Nothing writes or reads them. Carried over; the day dev is wiped they can go, and prod has never had a run.
- **Repeated Switches.** `MAX_STEPS` is `stopWhen` on both the `Agent` (`recommendationAgent.ts:401`) and the `streamText` call (`recommendationWorker.ts:170`). Skipped by choice last time; still two.
- **Data Clumps.** `pickLot`'s tool text "Pick N of 5 is on the list." (`recommendationAgent.ts:339`) reaches only the model, and ADR-0017's last amendment says "of 5" read wrong on a run that stopped at three. Drop the "of 5"; the prompt already states the cap.

### 3.3 Comments that no longer match

- `recommendationWorker.ts:139` "the thread is the run's HOW IT LOOKED record" (see section 1).
- `log-card.tsx:26` the doc comment's line wrap broke in `bb81f9b` (one 96-column line). Reflow.
- `recommendationAgent.ts:3` the header comment gained a run-on line in `cc0afcd` ("...the per-pick pickLot handoff. The loop is OpenAI only (ADR-0017, amendment of 2026-09-20). The run-document lifecycle"). Reflow.

### 3.4 Tests

The `pickLot` and `finish` tests cover the append order, the repeat refusal, the availability refusal as text, the empty list as a valid result and the empty summary fallback. `appliedFilters` has a test. `preferenceTokens` expanding a direction word has a test. Nothing drives `recommendationWorker.run` past the model call, as before, so `finish`-after-step-cap (a run that hits `MAX_STEPS` mid-list ships its picks) is asserted by reading only. The web side has no tests and the repo has not asked for them.

## 4. Summary

Spec: 3 defects (W3, W4, W5), 5 gaps, 3 scope notes. The worst is W3: the app names the same list three ways and one of them is the name `CONTEXT.md` retired.

Standards: 4 documented-rule findings, 7 smells, 3 stale comments. The worst is the four hand-written copies of the dot toggle; `DESIGN.md` treats it as one control and the code does not.

## 5. Suggested order of fixes

1. W3 (two strings). Two minutes, and it is user-visible.
2. W4 and W5 together in the lot route (drop the `me` gate, inline `isMine`).
3. `DotToggle` component; `save-button.tsx`, `log-form.tsx`, `next-bag-sheet.tsx` and the watch control mount it. `DESIGN.md`'s Save toggle entry names the file.
4. `tasting-picker.tsx`: one `NoteButton`, one `locked` predicate; decide `disabled` versus `aria-disabled` and write the answer in the doc comment.
5. Rename the tool-side `SearchFilters`; drop "of 5" from the `pickLot` text; the three comments.
6. The joiner for roaster notes on the lot page.
7. `hackathon.md` batch 7 entry, six lines or under, grouped commits.

---

Parts one and two are `design-pass-review-2026-09-20.md` and `-part-2.md`; the same headings and scales apply.
