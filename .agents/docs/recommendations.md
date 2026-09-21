# Find my next bag

The design record is ADR-0017 (`adr/0017-find-my-next-bag-is-an-agent-you-watch-work.md`) and its amendments. This document is the operator's view of what runs today. The single-call design that shipped first (2026-09-12 to 2026-09-20) is summarised at the end for the history it left in the schema and the tests.

## What the user sees

FIND MY NEXT BAG opens a pane from the right on whatever page the person is on (`?bag=true` on the current route; `/next-bag` redirects to `/?bag=true`). The pane holds one text box, an INCLUDE MY LOGS toggle (default off) and a FIND action. Under the box, the run renders in order: the request as typed, a status line, the tool calls as one line each while the loop works (`SEARCH "words", under $20, 250 g, 20 lots`; `CHECKED in stock, $18`; `PAGE READ New page details.`; `YOUR LOGS 6 logs`), and up to five cards as the model hands them over. A card is a fixed component over validated fields from the run document: rank, photo, lot name linking its Nouveau page, roaster, price and grams from the database, the model's why, then Save and Buy (the roaster's product page). When the run settles the step lines go and the model's closing sentence takes the status line. A settled shortlist stays in the pane for one hour (`SHORTLIST_TTL_MS`), then the pane opens blank.

Cards render from `recommendations.latest` (`picks`), where the server re-checks stock and price on read and joins the image. The step lines come from the run's thread through `useUIMessages({ stream: true })` on `recommendationThreads.list`, which authorizes through run ownership. `pickLot` calls produce no step line; the card is the line.

## The run

`recommendations.request` validates ownership, records the request text and the consent flag, consumes quotas and enqueues `recommendationWorker.run` on the `recommendationPool` workpool (parallelism two). The worker claims the run, creates a fresh agent thread (`@convex-dev/agent`, one per run, never reused, thread id on the run document), and calls `agent.streamText` with the request text as the prompt and `saveStreamDeltas: true`. The model is `gpt-5.6-luna` over the Responses API at reasoning effort `low`, with `store: false` so the request and the user's logs do not persist OpenAI-side. Both ride as provider options on the stream call because the component's `callSettings` merge drops them.

The tools are `createTool` wrappers over internal functions the worker owns:

- `searchCatalog(query, maxPriceCents?, minGrams?, maxGrams?)`. `selectCandidates` under the budget and size constraints, ranked by how many query words each lot's name and passages carry (`preferenceScore`; a flavour direction word expands to roaster synonyms through `FLAVOUR_SYNONYMS`). Words rank and never exclude. A numeric value at its ceiling ($500, 50 g, 5000 g) means no limit and is dropped; the result carries `applied`, the filters that ran. Each search records its candidates on the run (`recordCandidates`, at most `MAX_RUN_CANDIDATES` = 40 per run).
- `readLotFacts(productId)`. Hops to `recommendationWorker.readLot` (an action, because `pageFacts.ts` is Node-only and `recommendationAgent.ts` exports queries). If every page fact is known, or the run has used its two reads (`MAX_ENRICHMENTS`), or the shared page budget is out, it returns the stored passages with a note saying so. Otherwise it reads the page through the ADR-0010 reader, stores the verified facts and the passages, and returns them.
- `checkAvailability(productId)`. Stock and price of the candidate's variant now.
- `readMyLogs()`. Present only when the toggle was on; the owner's twenty most recent logs, derived from the run's owner, never from an argument.
- `pickLot(productId, why)`. The handoff, one call per card in rank order. Validation per call: the id must be one of this run's candidates, the why at most 480 characters, at most five picks, stock and price re-checked. An accepted pick appends to `selections` at once so the card lands live. An unavailable lot comes back as a refusal the model can act on, not an error.

The loop stops at `MAX_STEPS` = 16 or when the model stops calling tools. The worker tail then reads the run; if it is still `running`, `recommendations.finish` marks it `ready` with whatever `pickLot` stored (an empty list is "nothing fit") and the model's closing text as the summary. The five-minute watchdog (`RUN_TIMEOUT_MS`) fails a run that never settles; a failed run allows one manual retry (`MAX_ATTEMPTS` = 2), which consumes quota again.

User-facing refusals (`Wait for your current shortlist`, quota exhaustion) are `ConvexError`s so the pane can show the reason. Plain `Error`s are redacted. Provider errors are swallowed before the workpool can log private inputs.

## Source and price rules

Unchanged from the first design. The candidate scan starts from eligible crawl sources, not products: up to 40 watching sources with a confirmed US/USD crawl in the past hour, up to 16 current lots per roaster from that crawl, drawn round-robin until 20 qualify or 160 lots have been inspected. Each candidate uses one specific available variant with a positive price and a confirmed size inside the constraints; products with more than 16 variants are skipped. Shipping and tax are excluded. HTML-mode sources are eligible once their crawl confirms the market.

Market confirmation reads `Shopify.country` and `Shopify.currency.active` from the shop's homepage on every crawl, following redirects but requiring `https` on the same registrable domain, failing closed. Variant and size observations carry timestamps; a size retained from an older feed is not freshly confirmed.

Page reads follow ADR-0010: Firecrawl's rendered page first, the shop's own page as fallback, under the token bucket shared with the crawler and the sweep. Passages enter the shared `recommendationEvidence` cache with URL and observation time; successful reads are reused for 24 hours, empty or failed ones reserve the cache for one hour.

Before a pick is stored, and again when `latest` is read, the backend checks the exact variant's stock, price and freshness. A changed lot keeps its card with `canBuy: false` and a grey line.

## Limits and configuration

- Model: `gpt-5.6-luna`, Responses API, effort `low`, `store: false`, output cap 4,000 tokens including reasoning. The run stores the model string the API returns.
- Backend secret: `OPENAI_API_KEY`. Missing configuration fails only recommendations.
- Request text: 500 characters. Why: 480 characters. Picks: five. Steps: 16. Candidates per run: 40. Page reads per run: two.
- Requests: five per user per hour, 30 globally per hour. Retries count. Page reads: 60 globally per hour (`recommendationPages`).
- Workpool parallelism two. One active run per user. Five-minute watchdog, cancelled when the run settles. Shortlist visible for one hour.

Keep provider errors, prompts and personal notes out of operational logs. Request snapshots stay private in `recommendationRuns`; shared page prose lives in `recommendationEvidence`; the thread lives in the agent component's tables and is read only through `recommendationThreads.list`.

## Verification recorded

`packages/backend/convex/recommendations.test.ts` (64 tests as of 2026-09-20) covers authorization, consent as the absence of `readMyLogs`, input limits, source eligibility and rotation, the search tool's ranking and its ceilings, `pickLot` validation and the live append, `finish`, the shortlist TTL, provider failure, retry, watchdog cancellation and stale-result suppression, with the loop's model calls mocked. No mock is runtime evidence.

Live on dev, signed in, 2026-09-20:

- The first OpenAI-only run ("light roast Guatemalan coffee") reached one pick in four searches and showed two prompt failures: `MAX_SAFE_INTEGER` for the numeric filters and a flavour word used as a hard filter. Both fixed (ceilings, then no word filters at all).
- The first pane run ("give me a lot from africa with blackberry or raspberry like notes"): one search, three availability checks, three `pickLot` calls, cards arriving one by one, closing sentence as the summary, about fifteen seconds end to end. The model filled the ceilings on a request that named no budget; a value at the ceiling now means no limit.

Not yet seen live: the pane in light theme, Retry, a consent-on run, a page read.

## History: the single-call design (2026-09-11 to 2026-09-20)

Gate 2 of the revised product spec (`../research/nouveau-reimagined-product-spec.md`) shipped `/next-bag` as a form (request text, optional USD cap, minimum bag size prefilled at 200 g, up to five of the user's logs behind a checkbox) and one Responses call with a strict JSON schema and no tools. The model chose up to three product ids and copied one supplied passage each verbatim; the server rejected unknown ids, changed quotes and anything out of stock or off-price, and `filterReason` dropped any comparison sentence with digits, currency or outcome language. Firecrawl scraped up to two product pages per request with a JSON extraction against a fixed schema, each value verified letter for letter against the page markdown before it could join a `Label: value.` passage. Three live dev runs (2026-09-11 and 09-12) drove that verification: the first two quoted only catalog text because the scraped passages were boilerplate, tables or image captions turned into `!Alt text` by link stripping; the third was the first where Firecrawl changed the result (Onyx and Verve fact lines absent from the Shopify feed). The first prod recommendation ran 2026-09-15 in 21.4 seconds.

ADR-0017 replaced this with the loop above. Jev request structuring and a Jev why check shipped with the loop and were removed the same day (OpenAI only). What the first design left behind: `recommendationRuns.structured` and `structuredFilters` (optional, unwritten, kept so older runs validate), `recommendationEvidence` and its TTLs, the candidate scan, and the purge command `bun x convex run internal.recommendations.purgeEvidence '{}'` for when passage rules tighten.

Local commands:

```sh
bun run check-types
bun x ultracite check
cd packages/backend && bunx vitest run
```
