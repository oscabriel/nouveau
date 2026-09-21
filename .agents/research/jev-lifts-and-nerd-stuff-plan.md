# Jev lifts and the /nerd-stuff page: implementation plan

Written 2026-09-21 from the analysis in `/tmp/nouveau-handoff/jev-demo-comparison-and-nerd-stuff.md` and a read of the code as it stands at `375effc`. Ephemeral. Not meant for commit. Supersedes nothing; the ADR that comes out of this work is the durable record.

The demo lives at `~/Developer/projects/jev-think-test` (`06d16a6`). Its README describes its pipeline; `src/facts.ts` and `src/fact-catalog.ts` carry the vocabulary Choices this plan borrows from, and `src/client.tsx` (1,713 lines) is the UI to port.

## What this plan covers

Six pieces, in the order they should land. The first three change production extraction and stand on their own. The fourth and fifth are the page. The sixth is optional.

1. Keep Jev's probability distribution and store a confidence per page fact.
2. Vocabulary Choices for closed facts, stored as canonical fields beside the verbatim picks.
3. Per-note Nouls over an over-proposed candidate list.
4. Traces and runs: `pipelineTraces`, `pipelineRuns`, the `nerdStuff` module.
5. The `/nerd-stuff` route, ported from the demo and restyled to DESIGN.md.
6. A labeled evaluation set (~40 lots) and a script that scores both pipelines.

## Decisions this plan assumes

The handoff left five decisions open. This plan takes the proposed answer for each. If the owner picks differently, the affected section says what changes.

| Decision | Assumed answer | Section affected |
| --- | --- | --- |
| Real writes or dry run | Real page reads through the real Firecrawl budget. Committing facts to `products.pageFacts` sits behind a `commit` flag on the run, default false. | 4 |
| Who starts a run | Anyone can view. Starting needs sign-in plus a deployment-wide limiter. | 4 |
| Traces for production sweep reads too | Yes. `readPageFacts` always writes a trace; the page tails them. Pruned after three days. | 4 |
| Labeled eval | Build it, but last. | 6 |
| Order | Lifts 1 to 3 as their own commits and PR before the page. | all |

One thing the owner has to hear before the first live run: the Firecrawl budget is `FIRECRAWL_READS_PER_MINUTE = 9` (`pageFacts.ts:61`), a deployment-wide token bucket shared with the crawl-end sweep and the recommendation worker. A `/nerd-stuff` run of ten lots takes the whole minute's budget. The run loop must go through `readPageWithinBudget` and honor `ReadDeferredError` like everything else does. It gets no side door.

## Ground rules for every piece

- Read `.agents/docs/convex-guidelines.md` before touching `convex/`. New functions use the object form with `args` and `returns` validators. Public functions that read user state call the auth helper the rest of the codebase uses (see `recommendations.ts` for the pattern).
- Backend commit with tests first, then the UI that reads it. One change per commit.
- `bun run check-types`, `bun x ultracite fix` then `bun x ultracite check` at the root; `cd packages/backend && bunx vitest run` (573 tests today).
- `packages/backend/convex/_generated/api.d.ts` is tracked. Commit it with any module added.
- The `convex dev` watcher pushes every saved backend file to dev (cool-giraffe-632). Schema changes land on dev the moment the file saves. Run the `convex-deploy-guard` skill before any `npx convex` command.
- DESIGN.md gets its entry in the commit that adds the component. The ADR amendment lands in the commit that changes the behavior it records.
- Ultracite traps: no `Object.hasOwn`, no `Array#toSorted`, no `new Array(n)` in the backend; `unicorn/no-negated-condition` fires on `a !== null ? x : y`; JSX apostrophes need `&apos;`.

## Piece 1: probabilities and per-fact confidence

### Why

`jevChoice` in `packages/backend/convex/jev.ts:80` returns `{ choice, confidence? }` and drops the `probabilities` map Jev sends with every Choice. `lotClassifierShadow.ts:99` already reads `probabilities` for its own narrowing, so the shape is known and proven. Everything downstream (`picksFromAnswers` in `pageFacts.ts:272`, the stored `pageFacts`) keeps only the string. The page cannot show a probability bar or a runner-up without this, and production loses a signal it already paid for.

### Changes

`jev.ts`

- `jevChoice` returns `{ choice, confidence?, probabilities? }`. Narrow `probabilities` to `Record<string, number>` only if every value is a number and every key is in `allowed`. Anything else leaves the field off. Do not throw.
- Add `runnerUp(probabilities, choice): { option: string; probability: number } | null`: the highest-probability option other than the chosen one. Pure, exported, tested.
- `lotClassifierShadow.ts` can keep its own narrowing for now. Switching it to the shared one is a follow-up, not this commit.

`lotFacts.ts`

- New validator `pageFactConfidenceValidator = v.object({ elevation, process, producer, region, roastLevel, variety: v.optional(v.number()) each })`. Tasting notes get their own shape in piece 3, so leave `tastingNotes` out here.
- `pageFactsValidator` gains nothing. Confidence lives in a sibling field so `mergedFacts` and every existing reader stay untouched.

`schema.ts`, `products`

- Add `pageFactConfidence: v.optional(pageFactConfidenceValidator)`. A comment names the source: the probability Jev gave the picked line, before the cut and the verifier. It is Jev's certainty that the line is the right line, not that the value is right.

`pageFacts.ts`

- `picksFromAnswers` returns `{ facts, confidence, sentences }`. For each `CHOICE_FIELDS` entry, when `chosen.probabilities` has the chosen line, `confidence[field] = probabilities[chosen.choice]`; else fall back to `chosen.confidence` when present; else leave unset. Keep confidence for a field only when the verifier kept the field (compare against the keys in `pageFactsFromPicks(picks)`), so a stored confidence always has a stored fact beside it.
- `PageRead` gains `confidence: PageFactConfidence`.
- `store` mutation takes `confidence` and merges it like `facts`: `pageFactConfidence: { ...product.pageFactConfidence, ...args.confidence }`. Only patch it when the facts patch also happens.
- `scrape` passes it through. The other caller is `recommendationWorker.ts:81` (`readLot`); check whether it stores facts, and if so pass the confidence the same way. Otherwise it ignores the new field.

### Tests

- `jev.test.ts` (new, or extend wherever `jevChoice` is tested today): probabilities kept when well-formed, dropped when a key is outside `allowed`, dropped when a value is not a number; `runnerUp` with two options, with one option, with an empty map.
- `pageFacts.test.ts`: a recorded answer with probabilities yields a confidence for every kept field and none for a field the verifier dropped. `probePages.json` records `confidence` per page already; check whether it has per-field values or one number, and add a fixture with a `probabilities` map if it does not.

### Not in scope

No UI reads `pageFactConfidence` yet. The lot page could show it later; that is a separate design decision.

## Piece 2: vocabulary Choices for closed facts

### Why

ADR-0010 chose "Jev locates the line, code cuts the value, the verifier decides," and stored verbatim strings. That was right for the open-ended fields (producer, region, variety). For the closed ones the demo's approach is better: ask Jev a Choice over a fixed vocabulary, get the enum with a distribution, and store it as a canonical field. The two are not in conflict. The verbatim pick stays the display value; the canonical field is what filters, search and the recommendation prompt can rely on. ADR-0010 named this the "later phase." This is it.

### Vocabulary

Borrow from the demo's `CHOICE_FACTS` in `src/facts.ts:74`, trimmed to the four fields that matter for nouveau's product and that the feed regex does not already answer well:

- `originCountry`: the demo's `ORIGIN_COUNTRIES` list plus `other_country`, `blend`, `not_stated`. The question text tells Jev a region that implies one country counts (Yirgacheffe, Huila, Nyeri, Antigua).
- `processFamily`: `washed`, `natural`, `honey`, `anaerobic_or_experimental`, `wet_hulled`, `mixed`, `other`, `not_stated`.
- `roastLevelBand`: `light`, `medium_light`, `medium`, `medium_dark`, `dark`, `not_stated`.
- `altitudeBand`: `below_1000`, `from_1000_to_1400`, `from_1400_to_1800`, `from_1800_to_2200`, `above_2200`, `not_stated`. The question says to convert feet.

Skip `form`, `decaf`, `lot_type` and `variety` as Choices. `classifyLot` already handles the first three on the feed side, and variety's long tail makes a fixed list lose more than it gains; the verbatim pick plus `verifyVariety` is the better tool there.

Put the vocabulary in a new file `packages/backend/convex/factVocabulary.ts`, pure data, no Convex imports, so a client can import the labels later. Each entry has `id`, the question text with `%COFFEE%`, and a `criteria` map from option key to its one-line description. Export the option key lists as `as const` arrays so the validators below are literal unions.

### Changes

`lotFacts.ts`

- `canonicalFactsValidator = v.object({ altitudeBand, originCountry, processFamily, roastLevelBand: v.optional(v.union(...literals)) each })`. `not_stated` is never stored; it means leave the field unset.
- `canonicalFactConfidenceValidator`, same keys, `v.optional(v.number())`.

`schema.ts`, `products`

- `canonicalFacts: v.optional(canonicalFactsValidator)` and `canonicalFactConfidence: v.optional(canonicalFactConfidenceValidator)`.

`pageFacts.ts`

- `pageJevQuestions` adds one Choice per vocabulary entry to the same request, keyed `canon_<id>`. The state is unchanged (`pageJevState`). The questions name the coffee like every other question does. The demo's `READ_HINT` about `item.title` and tags does not apply; nouveau's state is the page text with the coffee's name as its first line.
- `picksFromAnswers` narrows each with `jevChoice(answers[key], optionKeys)` and returns `canonical` and `canonicalConfidence` alongside the rest. Drop `not_stated`.
- `store` merges both new maps like `pageFacts`.
- `PageRead` grows the two fields.

`lotFacts.ts`, `mergedFacts`

- Do not change what `mergedFacts` returns yet. The lot page and the cards show the verbatim value. Add a separate `canonicalOf(product)` accessor for callers that want the enum. Wiring it into `/drops` filters (batch 8's filter item wants origin and process filters) is a natural follow-up and should be mentioned in the ADR, not built here.

`recommendationAgent.ts`

- The `factsPassage` (or whatever builds the evidence line, `lotFacts.ts:260`) may append the canonical process family and origin country when they exist and the verbatim field is missing. Small, optional, and it must not import anything Node-only.

### Tests

- `factVocabulary.test.ts`: every criteria map ends in `not_stated`; no duplicate keys; every key matches `/^[a-z0-9_]+$/`.
- `pageFacts.test.ts`: the question set for a fixture page has the four `canon_` keys; a recorded answer with `not_stated` leaves the field unset; a recorded answer with `washed` at 0.83 stores `processFamily: "washed"` and `canonicalFactConfidence.processFamily: 0.83`; a choice outside the vocabulary is dropped, not defaulted.

### ADR

Amend ADR-0010 in this commit: the "later phase" paragraph becomes a dated amendment saying the vocabulary Choices ride in the same request, which four fields, and that the verbatim pick remains the display value.

## Piece 3: per-note Nouls over an over-proposed list

### Why

Today `pageJevQuestions` asks one Noul per note-shaped line ("Is this line a list of tasting notes of X?"), then `cutNotes` splits the approved line and `verifyNotes` gates the pieces (`extraction.ts:2069`, `lotFacts.ts:123`). The unit Jev judges is the line, so a line that mixes a real note with a roast word gets one verdict for both. The demo splits first, over-proposes from a ~250-word flavor vocabulary scanned over the description, and asks one Noul per note. The per-note question is more precise, and since Jev prices a batch as one request, the extra questions are close to free (the probe sent 233 questions for one page; `pageFacts.ts:222` records that).

### Changes

`lotFacts.ts` or a new `flavorVocabulary.ts`

- A flavor word list. Start from the demo's (find it in `src/propose.ts`; it is the 250-word list) and cross-check against the nine families in `tasting.ts` so the two vocabularies agree on spelling. Export `FLAVOR_TERMS: readonly string[]` and `scanFlavorTerms(text: string): string[]` that returns distinct matches in page order, whole-word, case-insensitive, capped at 24.

`extraction.ts`

- `pageElements` gains `noteCandidates: string[]`: every note-shaped line split by `splitNotes`, plus `scanFlavorTerms` over the page head, deduplicated case-insensitively, each candidate passed through `verifyNotes` first so Jev is never asked about something the verifier would drop anyway. Keep `noteLines` for one release so the trace can show both; remove it in the cleanup commit.

`pageFacts.ts`

- `NOTE_QUESTION` replaces `NOTE_LINE_QUESTION`: `Is "%NOTE%" one of the flavor or aroma notes the roaster attributes to %COFFEE%, rather than a note of another coffee the shop sells, a roast level, a certification, or brewing guidance?` One Noul per candidate, keyed `note_<index>`.
- `picksFromAnswers` collects candidates with `jevNoul >= YES` (0.5, unchanged) into `picks.tastingNotes`, already split, so `pageFactsFromPicks` no longer needs `cutNotes` on that path. Keep the result capped at `MAX_NOTES` (8), highest probability first, then page order for ties.
- Record per-note probability in a new `tastingNoteConfidence: v.optional(v.array(v.number()))` on `pageFactConfidence`, index-aligned with `pageFacts.tastingNotes`. Alternative: store `tastingNotes` as `{ note, p }[]`. That breaks `mergedFacts` and every reader; the aligned array does not. Take the aligned array and note the tradeoff in the ADR.

### Tests

- `scanFlavorTerms` on the Sweet Bloom fixture finds the notes and does not find words inside other words ("cherry" inside "cherry-picked" is a judgment call; decide and test it).
- `pageFacts.test.ts`: a fixture where the note line reads "Medium roast. Notes of cherry, cocoa" yields Nouls for `cherry` and `cocoa` and none for `medium roast`; the recorded answers store two notes with two confidences.
- `extraction.test.ts`: `pageElements(...).noteCandidates` is deduplicated and verifier-clean.

### ADR

Second amendment to ADR-0010 in the same commit series: the note unit moves from the line to the note.

## Piece 4: traces, runs, and the nerdStuff module

### Shape

Two tables. One is written by every page read in production. The other is the demo run the page drives.

`pipelineTraces`

```ts
pipelineTraces: defineTable({
	productId: v.id("products"),
	roasterId: v.id("roasters"),
	runId: v.optional(v.id("pipelineRuns")), // set when a /nerd-stuff run asked
	url: v.string(),
	name: v.string(),
	startedAt: v.number(),
	finishedAt: v.optional(v.number()),
	outcome: v.union(
		v.literal("read"),
		v.literal("deferred"),
		v.literal("failed"),
		v.literal("no_key")
	),
	// Stage timings in ms; a stage that did not run is absent.
	stages: v.object({
		page: v.optional(v.number()),
		jev: v.optional(v.number()),
	}),
	source: v.optional(v.union(v.literal("firecrawl"), v.literal("plain"))),
	pageChars: v.optional(v.number()),
	deferrals: v.optional(v.number()),
	model: v.optional(v.string()),
	questionCount: v.optional(v.number()),
	optionCount: v.optional(v.number()),
	// Per field: the picked line, its probability, the runner-up, the cut value, whether the verifier kept it.
	picks: v.array(
		v.object({
			field: v.string(),
			line: v.optional(v.string()),
			probability: v.optional(v.number()),
			runnerUp: v.optional(
				v.object({ option: v.string(), probability: v.number() })
			),
			cut: v.optional(v.string()),
			kept: v.boolean(),
		})
	),
	canonical: v.array(
		v.object({
			field: v.string(),
			choice: v.string(),
			probability: v.optional(v.number()),
			runnerUp: v.optional(
				v.object({ option: v.string(), probability: v.number() })
			),
		})
	),
	notes: v.array(
		v.object({ note: v.string(), probability: v.number(), kept: v.boolean() })
	),
	sentences: v.array(
		v.object({
			sentence: v.string(),
			probability: v.number(),
			kept: v.boolean(),
		})
	),
	error: v.optional(v.string()),
})
	.index("by_started_at", ["startedAt"])
	.index("by_run_id_and_started_at", ["runId", "startedAt"])
	.index("by_product_id_and_started_at", ["productId", "startedAt"]);
```

Do not store the page text or the whole option list. `picks[].line` is one line per field, `notes` and `sentences` are already short. A trace should stay under a few KB. If a page produces more than 60 note candidates, keep the top 60 by probability.

`pipelineRuns`

```ts
pipelineRuns: defineTable({
	userId: v.id("users"),
	roasterId: v.id("roasters"),
	status: v.union(
		v.literal("queued"),
		v.literal("running"),
		v.literal("done"),
		v.literal("stopped"),
		v.literal("failed")
	),
	commit: v.boolean(), // write facts to products? default false
	createdAt: v.number(),
	updatedAt: v.number(),
	total: v.number(), // lots picked for this run, <= 10
	index: v.number(), // 0-based position of the lot in flight
	currentProductId: v.optional(v.id("products")),
	currentStage: v.optional(
		v.union(
			v.literal("feed"),
			v.literal("gate"),
			v.literal("page"),
			v.literal("jev"),
			v.literal("cut"),
			v.literal("store")
		)
	),
	stageStartedAt: v.optional(v.number()),
	// Totals across the run, for the stat strip.
	jevRequests: v.number(),
	jevQuestions: v.number(),
	jevMs: v.number(),
	pageMs: v.number(),
	read: v.number(),
	deferred: v.number(),
	failed: v.number(),
	message: v.optional(v.string()),
	expireId: v.optional(v.id("_scheduled_functions")),
})
	.index("by_user_id_and_created_at", ["userId", "createdAt"])
	.index("by_created_at", ["createdAt"])
	.index("by_status", ["status"]);
```

### Tracing inside `readPageFacts`

`readPageFacts` in `pageFacts.ts:650` is shared by `scrape` and the recommendation worker. Adding a trace here means production sweep reads get traced for free, which is decision 3. The cleanest way without changing the production callers' signatures:

- Add an optional `onTrace?: (trace: TraceDraft) => Promise<void>` to `BudgetOptions`, or better, a sixth parameter `trace?: TraceSink`. A `TraceSink` is `{ runId?: Id<"pipelineRuns">; productId: Id<"products">; roasterId: Id<"roasters"> }`. When present, `readPageFacts` times the page read and the Jev call, builds the trace row from the same `answers`, `elements` and picks it already has, and calls `ctx.runMutation(internal.nerdStuff.recordTrace, ...)` once at the end (or on the caught error). One mutation per read; `scrape` already does one or two.
- `scrape` passes a sink always (it has `productId`; it needs `roasterId`, which `scheduleRead` can put in its args). The recommendation worker passes none for now; its reads are on the user's critical path.
- `picksFromAnswers` becomes the one place that knows the per-field probability, the runner-up and the kept flag. Have it return a `TraceDraft` alongside `facts` so the trace and the stored facts come from the same computation and cannot disagree.

`recordTrace` is an `internalMutation` in `nerdStuff.ts`. It inserts the row and, when `runId` is set, patches the run's totals.

### The run loop

`nerdStuff.ts`

- `start` (public mutation): args `{ roasterId, commit?: boolean }`. Requires a signed-in user. Limiter: `nerdStuffGlobal` fixed window, 4 runs per hour deployment-wide, `throws: true`; and `nerdStuffUser`, 2 per hour. Refuse if any run is `queued` or `running` (the `by_status` index). Pick up to 10 current lots of the roaster with a shop URL, preferring lots with `hasMissingPageFacts` true, then the rest by `firstSeenAt` descending. Insert the run, schedule `runLot` at index 0 with `runAfter(0)`, and set an `expireId` watchdog at 15 minutes that marks the run `failed` with message "timed out". Return the run id.
- `stop` (public mutation): the run's owner only. Set `status: "stopped"`. The loop checks status before each lot and exits.
- `runLot` (internalAction, `{ runId, index, attempt }`): read the run; exit if not `running` or if `index` moved. Patch `currentStage: "feed"` and record the feed pass output for the trace draft (`classifyLot` verdict and rule name, `parseLotAttributes`, `extractRoasterNotes` against the stored product; these are pure functions in `extraction.ts`, so call them on the stored product fields). Patch `currentStage: "gate"` and read the existing `lotClassifierShadow` row for the product if one exists (do not ask Jev again; the gate answer is the recorded one, or "not shadowed" when the regex classified it without the `default` path). Patch `currentStage: "page"` and call `readPageFacts(ctx, url, "", name, { reserve: true }, sink)`. On `ReadDeferredError`, patch `currentStage: "page"`, `message: "waiting for the Firecrawl budget"`, count `deferred`, and reschedule `runLot` at `error.retryAfter` with the same index and `reserved` carried through, up to `MAX_READ_DEFERRALS`. On success, when `commit` is true call `internal.pageFacts.store` with the read's facts and confidences; otherwise skip. Advance: `index + 1`, `runAfter(2000, runLot)` (the same `PAGE_SWEEP_SPACING_MS` the sweep uses). When `index + 1 === total`, patch `status: "done"` and cancel the watchdog.
- `run` (public query, `{ runId }`): the run doc. Anyone may read.
- `latestRun` (public query): the newest run by `by_created_at`, so the page opens on whatever ran last.
- `traces` (public query, `{ runId }`): traces for the run by `by_run_id_and_started_at`, ascending. Bounded at 10 by construction.
- `recentTraces` (public query, `{ limit }`): the last `limit` (cap 50) traces by `by_started_at` descending, for the "live crawls" tail. Join the product name and roaster slug so the row can link to the lot page.
- `prune` (internalMutation, cron daily): delete traces older than three days in batches of 200 using `by_started_at`, and runs older than seven days. Register in `crons.ts`.

Everything the trace shows must exist with or without the page. That is the test: `runLot` with a mocked `readPageFacts` fills the run and trace tables correctly, and the page is only a viewer.

### Auth

Viewing is public, so the queries take no identity. `start` and `stop` use the same identity helper `recommendations.start` uses. `stop` compares `run.userId` to the caller. There is no admin role in the schema today; if the owner wants only themselves to start runs, gate `start` on an `appConfig` key holding the allowed user id rather than inventing a role.

### Tests

`nerdStuff.test.ts` with `convex-test`:

- `start` refuses signed out; refuses when a run is active; picks at most 10 lots; prefers lots with missing facts.
- `runLot` advances the index, writes one trace per lot, marks `done`, cancels the watchdog. Mock `readPageFacts` through the module boundary the existing `pageFacts.test.ts` uses.
- A deferred read reschedules with the same index and increments `deferred`.
- `stop` mid-run halts before the next lot.
- `commit: false` leaves `products.pageFacts` unchanged; `commit: true` merges.
- `prune` removes only old rows.

### ADR

New `.agents/docs/adr/0018-pipeline-traces-and-the-nerd-stuff-workbench.md`. Context: no audit log of page reads exists; the demo showed the value of seeing every candidate. Decision: every production page read writes a trace; the workbench is a viewer over traces plus a bounded run loop through the same budget; no facts are written unless asked. Consequences: three-day retention; trace rows under a few KB; the recommendation worker stays untraced. CONTEXT.md gets two terms, `trace` (one page read's evidence and verdicts) and `pipeline run` (a sequence of traced reads a person started from the workbench). Run the `domain-modeling` skill for the wording.

## Piece 5: the /nerd-stuff route

### Source

The demo's `src/client.tsx`. The components worth porting, with what they become:

| Demo | nouveau | Notes |
| --- | --- | --- |
| `App`, `shopFromHash` | `routes/nerd-stuff.tsx` | Route reads `?run=<id>` or falls back to `latestRun`. |
| `RoasterPicker` | `components/nerd/roaster-picker.tsx` | `useQuery(api.roasters.list)` or whatever the directory uses. A `<select>` styled like the settings controls, plus the COMMIT toggle as a `DotToggle`. |
| `StatStrip`, `Stat`, `Label` | `components/nerd/stat-strip.tsx` | Questions, requests, Jev ms, ms per question, page ms, read/deferred/failed. Inverted ink-on-ground like `button-primary`. `tnum`. |
| `LiveRow`, `StageTrack` | `components/nerd/live-row.tsx` | Six stage cells: FEED, GATE, PAGE, JEV, CUT, STORE. The active cell pulses with the same grey dot the lot page uses for "reading". A deferral shows "waiting for the Firecrawl budget" in the PAGE cell. |
| `ItemRow`, `StageBar`, `StageTimes` | `components/nerd/trace-row.tsx` | One row per trace: name, outcome word, headline facts as plain text, page ms and Jev ms. Links to `/roaster/$roaster/$lot`. |
| `ItemSections`, `runnerUp`, `choiceNote`, `noulNote` | `components/nerd/trace-detail.tsx` | Grouped by mechanism: feed regex, gate, line picks, vocabulary Choices, notes, sentences, merged result. Each pick shows the line, a probability bar, the runner-up in grey, the cut value, and KEPT or DROPPED. |
| `Bars`, `AllItems`, `tally` | skip for v1 | Roaster-wide tallies are nice; do them after the deadline if at all. |
| `Chat`, `ToolRow`, `messageText` | skip | The demo's chat agent is not being ported. |
| `useTicker` | `lib/use-ticker.ts` | Local `setInterval` for elapsed time on the active stage; only runs while the run is `running`. |
| `Chip` | none | Chips are against DESIGN.md. Facts render as text in a hairline `dl`, like the lot page. |

Estimate 700 to 900 lines of TSX after the cuts.

### Data

Three subscriptions: `api.nerdStuff.run` (or `latestRun`), `api.nerdStuff.traces` for the run, `api.nerdStuff.recentTraces` for the live tail. `useMutation` for `start` and `stop`. No SSE, no polling; the run doc patches at every stage boundary and Convex pushes it.

### Style

Follow DESIGN.md as it reads today. In particular:

- No accent hue. The demo's "jev" tone becomes the inverted strip only.
- Probability bars are ink on a hairline track, square corners, 2px tall. Pending is a dashed hairline that drifts (port `bar-pending` but grey, respecting `prefers-reduced-motion`). Rejected candidates are grey with a strikethrough.
- Labels are `.label-caps`. Numbers are `.tnum`. The page title is `PageTitle` in Garamond like every inner page, "Nerd stuff", with the run's roaster as the count slot.
- Rows enter without animation. The demo's `row-enter` is a fade and slide; DESIGN.md has no motion vocabulary beyond the reading dot. Leave it out.
- Both themes, 1440 and 390. At 390 the detail stacks below the list.

Run the `impeccable` skill for the restyle pass once the components exist and render real traces.

### Route

No nav link, no footer link, no sitemap entry. The route is `nerd-stuff.tsx`, reachable by URL only. Add a short `direction-contract` comment at the top of the file, like `index.tsx` has, saying the page is a viewer over production traces and a bounded run loop, and that it is unlisted on purpose.

### DESIGN.md

One entry under Components: "Workbench (`/nerd-stuff`)": the stat strip, the stage track, the trace row, the trace detail, and the two rules above (no chips, no accent).

### Verification

Headless on dev with the `browse` skill (`localhost:3004/nerd-stuff`). Wait five to seven seconds after open for the queries. Screenshot both themes at 1440 and 390. Google OAuth keeps headless signed out, so the owner starts the run from their browser and pastes a screenshot into `/tmp/herdr-clipboard-images-*/`; read it with the `read` tool. Watch the Firecrawl component's dashboard for the minute after the first run to see the budget drain and refill.

## Piece 6: the labeled set and the eval

Optional. Do it after everything above if there is appetite.

- Take the 19 pages in `packages/backend/convex/fixtures/probePages.json` and add about 20 more from Sey and two roasters not yet in the fixtures. Save the reduced text the way the existing fixtures do.
- A `labels.json` beside it, hand-filled: for each page, the expected `process`, `roastLevel`, `region`, `producer`, `variety`, `elevation`, `originCountry`, `processFamily`, `altitudeBand`, and the tasting notes as a set. Null where the page does not say. This is the only honest way to answer "which is more accurate"; expect it to take a couple of hours of reading pages.
- `scripts/eval-page-facts.ts`: runs `pageElements`, `pageJevQuestions` and `askJev` against each page with the real key, scores exact match per field and Jaccard on notes, prints a table. Run it from the repo root with `bun`, never from a Convex function. It spends Jev requests, about 40, and no Firecrawl budget since the text is already on disk.
- Running the demo's pipeline over the same text needs a small adapter that feeds `text` into its `propose` and `facts` modules. Its repo is right there; do it in a scratch file inside the demo, not in nouveau.
- Record the two score tables in a research doc, then decide whether any threshold (`YES = 0.5`) or question wording should move. Any change to a threshold goes through a fixture and a test, not a hunch.

## Order of commits

1. `backend: jevChoice keeps probabilities, runnerUp, tests`
2. `backend: pageFactConfidence per stored page fact`
3. `backend: factVocabulary and the four canonical Choices in the page read` plus the ADR-0010 amendment
4. `backend: per-note Nouls over split and scanned candidates` plus the second amendment
5. `backend: pipelineTraces written by every page read`
6. `backend: pipelineRuns and the nerdStuff run loop, prune cron` plus ADR-0018 and CONTEXT.md
7. `web: /nerd-stuff route, stat strip and stage track`
8. `web: trace rows and trace detail`
9. `docs: DESIGN.md workbench entry, work-plan row, hackathon.md entry`

Each of 1 to 6 runs the full backend suite before commit. Commits 1 and 2 are the pre-deadline target. If the day runs out after 2, the handoff should say so and the rest waits.

## Traps specific to this work

- `readPageFacts` is on the recommendation worker's path. Any new parameter must default to "no trace" so that path stays as fast as it is.
- `picksFromAnswers` is pure today. Keep it pure; return the trace draft, do not write from inside it.
- The `pipelineTraces` insert happens inside an action via `runMutation`. The action can still throw after it. Write the trace last, after the facts store, so a trace never claims a store that did not happen; or write it with `outcome: "failed"` in the catch.
- `not_stated` must never reach the database. A test should try to store it and fail.
- The demo's `READ_HINT` mentions fields nouveau's state does not have. Do not copy question text verbatim; rewrite every question against `pageJevState`'s actual shape (`Coffee: <name>` then the page head).
- Schema pushes go to dev on save. Adding two tables and four optional product fields is additive and safe; still, announce it.
- `crons.ts` exists; add the prune job there with an `internal.nerdStuff.prune` reference rather than creating a second crons file.
