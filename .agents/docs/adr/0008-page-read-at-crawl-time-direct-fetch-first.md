# Thin lots get their page read at crawl time, from the shop itself; Firecrawl is the fallback

Decided 2026-09-18 (owner). Amends the scheduling half of ADR-0005, which chose page enrichment on demand (option C) over enrichment at first sighting (option A) because a Firecrawl scrape costs a credit per lot and most lots are never viewed. Evidence: every roaster's live feed run through the crawl's own lot filter and note extractor (2740 current lots, 1451 with notes, 53%), and one noteless product page fetched per weak roaster.

The feed cannot close the gap. Shopify's products.json carries the description HTML, tags and variants and never a metafield, and for most roasters the tasting notes live in a metafield the theme renders into the product page (Onyx's `tasting-notes` spans, Proud Mary's meta block, Passenger's "Notes of" line, Stumptown's flavor profile block, Sightglass's rich-text metafield, Counter Culture's pipe line). Their feed descriptions are producer stories with no descriptors. Ten of ten pages checked render the notes server-side, so a plain fetch of the page carries the same words Firecrawl's markdown does.

## Decision

- **The read runs at crawl time.** After a successful catalog commit the crawl schedules `pageFacts.sweep` for the roaster: every current lot that is still thin after the feed merge, has no page facts, and was not tried inside the retry window is stamped and gets one scheduled read, at most `PAGE_SWEEP_PER_CRAWL` per crawl, spaced `PAGE_SWEEP_SPACING_MS` apart. The first sweeps of a catalog are a backfill spread over crawls; after that a crawl reads only its new lots. The on-view ask (`pageFacts.request`) stays for a lot a viewer reaches before its sweep.
- **The shop's own page first.** `readPageFacts` fetches the product URL with a plain request and reduces the HTML to block text (`pageTextFromHtml`: chrome dropped, then `stripHtml`). Firecrawl's markdown scrape runs only when the shop errors, times out, serves something other than HTML, or serves a script shell under `MIN_PAGE_TEXT_LENGTH` characters. Credits are spent on the exception, not the rule.
- **The theme's notes element leads the candidates.** With HTML in hand, an element whose class names the notes (`tasting-notes`, `flavor-profile`, `flavors`) is split into one note per child element and prepended to the page text as a labelled line, so those notes head the candidate list instead of trailing the nav lines that fill the cap. Jev still verifies every candidate; the hint changes order, not authority. Classes that say upsell, related or card are another product's block and are skipped.
- **Nothing else moves.** The schema, the shared verifiers, the stamp-and-retry rule and Jev as the picker are as ADR-0005 set them. A page read still writes only `pageFacts`.

## Why this reverses C over A

ADR-0005 rejected A on cost: ~600 credits once and ~100 a week for lots nobody views. With the plain fetch the marginal cost of a read is one HTTP request to the shop and one Jev request, and the sweep cap bounds both. What A buys is coverage on the surfaces that never trigger the on-view ask: the roaster grid's notes column, recommendation candidates, and search. Half the catalog had no notes to show there.

## Consequences

- Expected coverage rises from 53% of lots to around 90%; Heart and East Pole publish no descriptors anywhere, and Verve keeps its notes only in an image alt attribute.
- The one-time backfill is roughly 1300 lots at 25 per crawl per roaster, so it completes within a few crawl cycles for the large catalogs (Sey, Proud Mary) and one cycle for the rest.
- A shop that rate-limits or challenges the crawler's user agent falls back to Firecrawl for every lot, which is the pre-ADR cost; the sweep cap bounds it.
- A theme that marks another product's notes with the same class as its own, without an upsell-style class, can lead the candidates with the wrong coffee's notes. Jev's per-note question asks about "the one coffee sold on this product page", which is the guard.
- Every extractor change remains a catalog correction; a lot read once is not re-read until its facts are cleared or the retry window passes with no facts stored.
