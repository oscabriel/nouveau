---
status: accepted
---

# Find my next bag is an agent you watch work, not a form you submit

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session and is the largest item of the seven records written today. Amends the request path in `.agents/docs/recommendations.md` (Gate 2) and the `/next-bag` direction in the design handoff of 2026-09-20. Makes one explicit exception to the "no cards" rule in `DESIGN.md`.

## Context

Today `/next-bag` is a form: free text (500 characters), a USD cap, a minimum bag size prefilled at 200 g, a picker for up to five of the user's own logs, and a consent checkbox for sending their notes. `recommendations.request` queues `recommendationWorker.run` on a workpool. The worker selects up to 20 candidates by round-robin across US/USD-confirmed roasters crawled in the last hour, orders them lexically by request words, reads up to two product pages with Firecrawl for missing facts, then makes **one** OpenAI Responses call (`gpt-5.6-luna`, strict JSON schema, `store: false`, "You have no tools"). The model picks up to three product ids, copies one supplied passage verbatim each, labels the relation (similar, contrast, explore) and writes one comparison sentence, which a filter blanks if it mentions numbers, prices, stock or outcomes. The server rejects any quote that differs from its source, re-checks stock and price before storing and again on read, and every buying label comes from the database. The client subscribes to the run; the queued and running states are one sentence each, and a real run takes about twenty seconds with nothing on screen but that sentence. Results render as blocks of provenance: name, price and size, relation label, disclaimer, the OpenAI sentence, the quote, its source and time, unquoted page passages, the preference used, the market line, save and shop links.

The pipeline is honest and hard to demo. Testers were expected to read the twenty-second wait as broken (design handoff, tester plan), and the result page reads as evidence, not as a shortlist.

## Decision

**One text box.** The user types what they are looking for in plain language and nothing else. There are no other fields. A price cap, a bag size, an origin, a process, a mood, all come from the sentence or are absent. The consent note about what leaves the app stays as one grey sentence under the box.

**The run is an agent loop with server-owned tools, and the user watches it.** The model gets tools instead of a pre-built candidate list: search the catalog (name, origin, process, roaster notes, price and size limits), read a lot's facts (the stored page facts, and a Firecrawl page read when they are thin, through the existing budget), check a lot's current price and stock, and read the user's own logs when the user has allowed it. Every tool call, its short result, and each decision the model states are written to the run as steps the moment they happen, and the page shows them as they arrive over the Convex subscription. The twenty seconds become visible work.

**The result is a ranked list of simple cards.** Each card is one chosen lot: image, name, roaster, the price and size line in tabular figures from the database, and one or two sentences from the model saying why this lot fits what was asked. Cards are ordered by how well the model judged they align with the request, top first. No relation labels, no disclaimer block, no passage lists. Save and the lot page link stay on the card. This is the one surface in the product where cards are allowed; the rest of `DESIGN.md` stands.

**What does not change.** The server still validates every id the model names against the catalog, checks stock and price from the database before storing and on read, never shows generated text as a catalog fact, and never sends the user's notes without consent. Quotas, the workpool, the watchdog, the one-active-run rule and the retry rule stay. The evidence cache and its hourly retry stay.

## Considered alternatives

- **Keep the single call and only redesign the results page.** Cheapest; the handoff's "three provenance layers without boxes" was this. It leaves the wait empty and the results as a study in citations. The owner wants the activity to feel like asking someone.
- **Stream the model's reasoning text instead of tool steps.** Prose that says "thinking about washed Ethiopians" is not evidence of anything. A tool step ("searched: washed, Ethiopia, under $30; 14 lots") is a fact the app produced and can show in tabular figures.
- **A chat thread.** Follow-up turns would be natural but double the surface (history, threads, per-turn quotas). One request, one run, one list; a new request starts a new run.

## Consequences

- The verbatim-quote guarantee softens. The card's "why" is generated text; the quote was the old design's way of keeping the model honest. The replacement is that every fact on the card (price, size, stock, roaster, name) comes from the database and the model's sentence is labelled as its own. Whether the sentence may cite numbers is open below; today's filter blanks any sentence with a digit.
- Ranking moves to the model. Today the server orders candidates lexically and the model picks three of twenty unordered. Now the model searches, chooses and orders. The lexical score can remain inside the search tool as its result ordering.
- Steps need storage: an array on `recommendationRuns` or a `recommendationSteps` table keyed by run, written by the worker as it goes. The run's `candidates` and `selections` shape changes with the tool loop.
- A tool loop makes several model calls per run instead of one. Cost, latency and the 45-second HTTP timeout need re-measuring on dev; the five-minute watchdog is likely still right. The per-user and global hourly quotas count runs, not calls, and stay.
- The Firecrawl budget (ADR-0010: one token, nine a minute on the Free plan) is shared with the crawler and the sweep. A tool that reads pages on demand can defer; the worker cannot wait for a slot, so a deferred read returns "no page facts" to the model and the hourly retry covers the lot, as ADR-0010 set.
- The form's history picker goes. Reading the user's logs becomes a tool the user enables with one toggle (default off) so consent stays explicit.
- Hackathon copy: `hackathon.md`'s "What it does" line and the OpenAI entry describe the single-call design and need the new one once it ships. Judges read that file.

## Open questions

- **Agent runtime.** Hand-roll the tool loop over the Responses API with `fetch`, as the worker does today, or adopt the Convex Agent component (threads, tool calls and streaming persisted for free, at the cost of a new component and its own tables). Recommendation: the component if it can run inside the existing workpool and write steps the page can subscribe to; otherwise the hand-rolled loop, which is about a hundred lines around what exists.
- **Numbers in the why.** Allow the sentence to say "under your $30" and "washed, as you asked", or keep the digit filter and let the tabular line carry every number. Recommendation: allow words about the request, keep the filter on prices and stock claims, since those are the ones that go stale.
- **How many results.** Three today. A ranked list reads as a list at five; at three it is a podium. Recommendation: up to five, fewer when the catalog has fewer that fit.
- **What a step shows.** Tool name and arguments in caps and tabular figures, plus a one-line result count, or the model's own sentence about why it called the tool. Recommendation: the tool line always, the model's decision line when it states one.
- **Persisting steps after the run.** Keep them on the run so a finished run still shows how it got there, or clear them and show only the list. Recommendation: keep, collapsed under a caps "HOW IT LOOKED" line.
- **Deadline.** The hackathon closes 2026-09-22 at noon Pacific. This is the biggest change of the seven and the one the video is about. Whether it ships before the deadline or after is a scheduling call for the next session, not a design one; the record stands either way.
