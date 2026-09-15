# Find my next bag

Gate 2 implementation for the [revised product spec](../research/nouveau-reimagined-product-spec.md). Live in prod (`a08463d`) with a genuine OpenAI result on dev that quotes Firecrawl-fetched page facts (see Verification recorded). Prod sources gain eligibility as their first post-deploy crawls confirm the US/USD market.

## Request path

`/next-bag` opens from the signed-in home page. A user enters preferences, optional USD budget and minimum bag size, and up to five logs from their own paginated history. Notes require a separate checkbox. The backend does not add the account email, authentication identifier, or unselected history to the OpenAI request.

`recommendations.request` validates ownership, records the explicit input, consumes quotas and queues `recommendationWorker.run` through Workpool. The caller subscribes to their latest request. Requests move through queued, running, ready and failed. A ready result may contain no matches. Only failed requests permit one manual retry, which consumes quota again. Repeated submissions with the same key return the original request.

The model chooses existing coffee IDs, evidence IDs, a preference ID, a comparison label, and one comparison sentence. It must copy a complete supplied passage. The server rejects unknown IDs, duplicate coffees, changed quotes, extra fields and malformed output. The comparison sentence passes through `filterReason`: anything with digits, currency, stock, shipping, price or outcome language ("you will", "definitely") is dropped and the result shows only the label and quote. The UI labels the surviving sentence as OpenAI's comparison and never shows generated text as a catalog fact.

User-facing failures (`Wait for your current shortlist`, `Choose logs from your own history`, quota exhaustion) are thrown as `ConvexError`, so the form can show the real reason. Plain `Error` messages are redacted in production.

## Source and price rules

The candidate scan starts from eligible crawl sources, not from products. It reads up to 40 watching sources, keeps those with a confirmed US/USD crawl in the past hour, and takes up to 16 current lots per roaster from that crawl. Within a roaster, lots that mention words from the request (process, origin, descriptors) sort first; this ranks and never excludes, because a request can ask for a change of direction. Candidates are then drawn round-robin across roasters until 20 qualify or 160 lots have been inspected. A large catalog crawled a minute ago cannot fill the pool by itself. This is still a bounded sample, not a search of every coffee. Each result uses one specific available variant with a positive price and confirmed size. Products with more than 16 variants are skipped. Shipping and tax are excluded.

Recommendations require a successful Shopify crawl within the previous hour. That crawl must confirm `Shopify.country` as US and `Shopify.currency.active` as USD from the shop's homepage using the same localization cookie as the feed. The homepage fetch follows redirects (most apex domains 301 to `www`) but the landing page must be `https` on the same registrable domain; the stored `market.url` is the page that carried the confirmation. A missing confirmation excludes that source from recommendations without failing the existing crawl or alert flow.

The crawler records variant observation and size-observation timestamps. It still retains old catalog sizes when a feed omits them, but recommendations cannot treat those sizes as freshly confirmed. Existing rows become eligible after a new confirmed crawl, not through a fabricated backfill. HTML-mode sources are not eligible for price-constrained recommendations in this increment.

Firecrawl fetches up to two supported product pages per request, including retries. It targets the candidates whose name and catalog text best match the request words, so a fetched passage has a real chance of appearing in the result; among equals it picks the thinnest evidence. Only short public coffee passages enter the shared evidence cache, with their URL and observation time.

The scrape asks for two formats at once: the page markdown and Firecrawl's JSON extraction against a fixed schema (process, variety, region, elevation, producer, roast level, tasting notes, and up to five description sentences), with a prompt scoped to this one coffee. The extractor only selects text; it cannot add any. The backend normalizes every returned value to letters and digits and drops it unless it appears in the page markdown, is absent from the feed's full text for that lot (name, description, notes, origin, process, roast level, tags), and contains no price, URL, markup or instruction words. Surviving facts join under server-written labels into one passage (`Process: Washed. Variety: Heirloom. Tasting notes: Jasmine, Toffee.`); a roast level alone is not enough. Surviving sentences follow verbatim, minus first-person shop copy ("we source"). Up to three passages per page.

When extraction returns nothing usable, a regex fallback reads the markdown by paragraph. It strips headings, emphasis and links, removes image syntax outright (the first live run kept image captions as prose because link stripping ran first), rejects tables, inline HTML, fewer than five words and shop voice, and requires a coffee word. It can still admit label lines and general coffee text, which is why it is the fallback. Catalog passages use the same readability rules and do not split sentences after units such as "12 oz." or "2 lb.".

After tightening these filters, run `bun x convex run internal.recommendations.purgeEvidence '{}'` on the target deployment so cached passages from the old rules are not served for the rest of their TTL. Successful enrichments are reused for 24 hours; empty or failed ones reserve the cache for one hour. A Firecrawl failure can leave the OpenAI comparison working from catalog evidence, with that limitation visible. A changed source URL or non-200 page cannot supply evidence.

Before committing results, and again when reading them, the backend checks the exact variant's stock, price, size, source health and freshness. The client refreshes the time argument every 30 seconds. A stale result retains its source quotation but loses the buying invitation.

## Limits and configuration

- Model: `gpt-5.6-luna` at reasoning effort `low`, through the Responses API with strict JSON Schema, `store: false`, and no tools. The run stores the model string the API returns, so evidence records the exact snapshot behind the alias.
- Backend secret: optional `OPENAI_API_KEY`. Missing configuration fails only recommendations.
- Model output cap: 4,000 tokens, which includes reasoning tokens. Request text: 500 characters. Source evidence: up to three catalog passages and three Firecrawl passages per candidate, each at most 350 characters. Comparison sentence: 240 characters.
- Requests: five per user per hour, 30 globally per hour. Retries count toward both limits.
- Workpool concurrency: two. One active request per user. Five-minute request watchdog, cancelled when the run settles. OpenAI HTTP timeout: 45 seconds, without automatic retries.
- Firecrawl: 60 enrichment jobs globally per hour, 30-second scrape timeout. The installed component can retry each job three times after its first attempt, so this is not a 60-HTTP-attempt cap. JSON extraction spends Firecrawl credits, not OpenAI tokens.

Keep provider errors, prompts and personal notes out of operational logs. Request snapshots remain private in `recommendationRuns`; shared source prose lives in `recommendationEvidence`.

## Verification recorded

The owner manually verified Gate 1's existing dev and production flows. Local baseline verification passed all 157 existing tests, formatting/linting, frontend typechecks and the separate backend TypeScript check.

Gate 2 adds 57 tests in `packages/backend/convex/recommendations.test.ts`. They cover authorization, consent, input limits, source eligibility, roaster rotation and preference ranking, market confirmation through redirects, output validation including the reason filter, provider failures, retries, empty-cache expiry, watchdog cancellation, stale-result suppression, and the actual Workpool scheduling path with mocked external responses. All 214 tests pass. No mock result is runtime integration evidence.

The first live dev run (2026-09-11, `gpt-5.6-luna`, request "south american, natural process", $50 cap, 300 g minimum) returned 20 candidates from 11 roasters and three valid selections from three roasters, each with a verbatim catalog quote and a comparison sentence that passed the fact filter. Both Firecrawl scrapes succeeded but their passages were shop boilerplate, a markdown table and a heading with its `##` marker, so the model quoted catalog text instead. The passage filters above were tightened in response and the cache purged.

The second live dev run ("A washed Ethiopian coffee, floral and tea-like") again quoted only catalog text. Inspection of the stored run showed Firecrawl had supplied six passages, all poor: Verve's were image captions that link stripping had turned into `!Verve Coffee Roasters - Chelchele - Producer Image`, and Onyx's were general coffee-education paragraphs plus `Ground Agtron: #137 Roast Level: Ultra Light`. The captions actually carried the useful data (`Process: Washed - Variety: Heirloom - Tasting Notes: Jasmine, Toffee, Lemon Custard`), which regexes over markdown cannot pull out reliably. That is why the extraction moved to Firecrawl's JSON format with verbatim verification, described above. Mocked tests cover the structured path, its fallback and the caption bug.

The third live dev run (2026-09-12, same request, `gpt-5.6-luna`, 20 candidates from 13 roasters, two scrapes) is the first where Firecrawl changed the result. Both scrapes produced verified fact lines absent from the Shopify feed. Onyx: `Variety: Landrace. Elevation: 1900 MASL. Roast level: Ultra Light. Tasting notes: Apricot, Barley Tea, Bergamot, Caramel.` Verve: `Variety: Heirloom. Elevation: 1900-2100 Meters. Producer: Smallholder outgrowers in the Chelchele kebele. Roast level: Light roast. Tasting notes: Jasmine, Toffee, Lemon Custard.` plus two verbatim description sentences. The model quoted both fact lines, and its Onyx comparison named "Barley Tea" and "Bergamot" as echoing the tea-like, floral request. The third card (East Pole, a contrast) quoted catalog text. The run before it, with the same page evidence but the earlier prompt, quoted catalog prose for all three; the prompt now asks for the most specific passage and explains what `source: firecrawl` means, and the card lists unquoted page passages under "Also on the product page", so a scrape reaches the screen even when the model prefers the catalog.

A code review after the first implementation found and fixed two defects before any deployment: the homepage market check used `redirect: "error"`, which failed for the four of eight sampled seeded roasters whose apex domain 301s to `www`; and the candidate scan read the 160 newest products globally, which grouped by roaster in crawl order because a crawl stamps every lot with one `lastSeenAt`.

The form and results components were checked in local Chromium at desktop and mobile widths, including dark mode, empty-input validation, request payloads and draft retention after a failed submission. That preview used labeled fixtures and mocked client hooks. It did not verify deployed authentication or a live recommendation. The UI review ran inline because no sub-agent tool was available. The design detector returned no findings.

## Close Gate 2

1. Approve a development push to `dev:cool-giraffe-632`. Set `OPENAI_API_KEY` there through the normal secret-management path, without printing its value. Leave production unchanged.
2. Let normal successful crawls populate market and variant confirmations. Check that real supported sources qualify. Do not mark uncertain legacy observations as confirmed to fill the shortlist.
3. Done 2026-09-12: cache purged, bounded paid test run through the signed-in UI with no personal notes, two Firecrawl fact lines quoted, model and observation times recorded above.
4. Done: private result access verified with a second account on dev; the mounted page verified in the real app shell.
5. Done 2026-09-12: `hackathon.md` updated and `a08463d` deployed to prod with `OPENAI_API_KEY` set there. Gate 2 complete. A first prod recommendation should be recorded once prod sources carry market confirmations.

Local commands:

```sh
bun run check
bun run test
bun run check-types
bun x tsc --noEmit -p packages/backend/convex/tsconfig.json
```

Saving, coffee watches, dated/private logs and independent in-app updates belong to Gate 3. This increment does not change existing log visibility or email choices.
