---
status: accepted
---

# Every page read leaves a trace; the workbench is a viewer over them and a bounded run loop through the same budget

Decided 2026-09-21 (owner, from the Jev demo comparison and its plan). Implementation landed the same day: `pipelineTrace.ts`, `nerdStuff.ts`, the `pipelineTraces` and `pipelineRuns` tables, the trace draft `readPageFacts` now returns. The page itself (`/nerd-stuff`) follows in the next piece. Builds on ADR-0010 and its two amendments of 2026-09-21; changes nothing they decided.

## Context

The page read (ADR-0010) asks Jev a few hundred questions per page and stores about seven values. Nothing recorded what Jev saw, what it picked second, which candidates the verifier dropped or how long each stage took. A wrong fact on a lot page could only be explained by re-running the read by hand. The demo at `jev-think-test` showed how much of the pipeline's behaviour becomes legible when every candidate and its probability is on screen, and the owner wants that view on nouveau's own reads, on a page a judge or a curious visitor can open.

Two things made "just add a debug page" the wrong shape. The interesting reads are the production ones (the crawl-end sweep, the lot page's ask), not a separate demo path that could drift from them. And any page that starts reads spends the deployment's Firecrawl minute (nine reads, shared with the crawler and the recommendation worker, ADR-0010), so it cannot have its own door to Firecrawl.

## Decision

**Every page read writes one trace.** `readPageFacts` times its page and Jev stages and returns a trace draft beside the facts: per field the picked line, its probability, the runner-up, the cut value and whether the verifier kept it; per vocabulary Choice the option and its distribution's top two; per note candidate and per sentence its Noul and whether it was stored. The draft comes out of the same `picksFromAnswers` call that produces the facts, so the two cannot disagree. The read writes nothing itself. The caller writes the row once, at the read's end, with the outcome only it knows (`read`, `no_key`, `failed`, `deferred`), after the facts store, so a trace never claims a store that did not happen. A deferral that runs again is not an end and leaves no row; a read that gives up after `MAX_READ_DEFERRALS` leaves one `deferred` row with the count.

**Which reads.** The scheduled read (`pageFacts.scrape`: the sweep and the lot page's ask) and the workbench's reads. The recommendation worker's reads are not traced; they sit on the user's wait and the parameter defaults to "no trace" so that path is unchanged.

**What a trace stores, and what it does not.** One line per field, the notes and sentences Jev was asked about, no page text and no option list. Note candidates are capped at 60 by probability. A row stays under a few kilobytes. Traces are pruned after three days by a daily cron; runs after seven. The tail is a window onto recent reads, not an archive.

**The workbench is a viewer plus a bounded loop.** `nerdStuff.start` picks up to ten current lots of one roaster (those still missing a page fact first, then newest), fixes the list on the run document, and schedules `runLot` at index 0. The loop replays the feed pass on the stored product (pure functions, no crawl), looks up the gate's recorded shadow answer rather than asking Jev again, then calls the same `readPageFacts` with `reserve: true` and the same `ReadDeferredError` handling the sweep has. A deferral reschedules the same index at the budget's word; the run counts the lot as `deferred` only when it gives up after `MAX_READ_DEFERRALS`, so `read`, `deferred` and `failed` each count lots and sum to the lots finished. Reads are spaced by `PAGE_SWEEP_SPACING_MS` like the sweep. **A run writes no facts unless asked** (`commit`, default false); with it, the run calls the same `internal.pageFacts.store` the scrape calls.

**Who may do what.** Anyone may read runs and traces; the queries take no identity. Starting needs sign-in, two fixed-window limiters (four runs an hour deployment-wide, two per person) and no other run `queued` or `running`. Only the owner may stop a run. A watchdog fails a run still going after fifteen minutes.

**2026-09-21 (owner, after the route landed). The workbench is the owner's, so the limits loosen.** The route is for the owner to look at the pipeline and show it, not a feature visitors use, so the guards above change in three ways. One limiter, twenty runs an hour deployment-wide; the per-person limiter goes. The Firecrawl bucket inside `readPageFacts` was always the real limit, and twenty runs of ten lots is under an hour of it. `appConfig.workbenchUserId` names the one user who may start runs (set with `internal.nerdStuff.allowWorkbenchUser` by email); while unset, any signed-in user may, which is the dev and test default. And a new run supersedes the one going instead of being refused: `start` marks it `stopped` with message "superseded", cancels its watchdog, and the old loop exits at its next `activeAt` check. The owner does not have to wait on a full roaster to look at another. The loop stays a scheduler chain beside the sweep, not a workpool entry: the `recommendationPool` bounds next-bag runs, and the budget every page read shares is the rate limiter, which this loop already goes through.

## Considered alternatives

- **Trace only the workbench's reads.** Simplest, and it would have made the page a demo of a demo. The production reads are what need explaining.
- **Write the trace inside `readPageFacts`.** One place, but the read does not know the outcome (the scrape's catch branches do) and it would put a mutation on the recommendation worker's path. The draft-out, caller-writes shape keeps the read pure of writes.
- **Store `tastingNotes` as `{ note, p }[]` and the trace as part of the product.** Breaks every reader of `pageFacts` and grows the product document with every read. A separate table with a three-day life keeps the product small and the history disposable.
- **A dry-run mode that reads pages without the budget.** Rejected outright: Firecrawl counts every request against the team's minute whatever nouveau calls it. The run loop gets no side door.

## Consequences

- Each scheduled read now costs one more mutation (the trace insert). The sweep is twenty-five reads a crawl at most; the cost is small and bounded.
- A run of ten lots takes the whole Firecrawl minute; the sweep and the worker defer around it, as they already do around each other. The limiters keep that to four minutes an hour.
- `products` gains nothing. The `pipelineTraces` row references the product and roaster by id; a lot that is deleted leaves its traces to the prune.
- The page (piece 5) is only a viewer: everything it shows exists in the two tables, and `nerdStuff.test.ts` drives the loop end to end with the providers stubbed. A change to the page cannot change what a run does.
- Two CONTEXT.md terms: *trace* and *pipeline run*, plus *workbench* for the page.
