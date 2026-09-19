# Thin lots get their page read at crawl time, from the shop itself; Firecrawl is the fallback

Decided 2026-09-18 (owner). Amends the scheduling half of ADR-0005, which chose page enrichment on demand (option C) over enrichment at first sighting (option A) because a Firecrawl scrape costs a credit per lot and most lots are never viewed. Evidence: every roaster's live feed run through the crawl's own lot filter and note extractor (2740 current lots, 1451 with notes, 53%), and one noteless product page fetched per weak roaster.

The feed cannot close the gap. Shopify's products.json carries the description HTML, tags and variants and never a metafield, and for most roasters the tasting notes live in a metafield the theme renders into the product page (Onyx's `tasting-notes` spans, Proud Mary's meta block, Passenger's "Notes of" line, Stumptown's flavor profile block, Sightglass's rich-text metafield, Counter Culture's pipe line). Their feed descriptions are producer stories with no descriptors. Ten of ten pages checked render the notes server-side, so a plain fetch of the page carries the same words Firecrawl's markdown does.

## Decision

- **The read runs at crawl time.** After a successful catalog commit the crawl schedules `pageFacts.sweep` for the roaster: every current lot that is still thin after the feed merge, has no page facts, and was not tried inside the retry window is stamped and gets one scheduled read, at most `PAGE_SWEEP_PER_CRAWL` per crawl, spaced `PAGE_SWEEP_SPACING_MS` apart. The first sweeps of a catalog are a backfill spread over crawls; after that a crawl reads only its new lots. The on-view ask (`pageFacts.request`) stays for a lot a viewer reaches before its sweep.
- **The shop's own page first.** `readPageFacts` fetches the product URL with a plain request and reduces the HTML to block text (`pageTextFromHtml`: chrome dropped, then `stripHtml`). Firecrawl's markdown scrape runs only when the shop errors, times out, serves something other than HTML, or serves a script shell under `MIN_PAGE_TEXT_LENGTH` characters. Credits are spent on the exception, not the rule.
- **The theme's notes element leads the candidates.** With HTML in hand, an element whose class names the notes (`tasting-notes`, `flavor-profile`, `flavors`) is split into one note per child element and prepended to the page text as a labelled line, so those notes head the candidate list instead of trailing the nav lines that fill the cap. Jev still verifies every candidate; the hint changes order, not authority. Classes that say upsell, related or card are another product's block and are skipped.
- **Nothing else moves.** The schema, the shared verifiers, the stamp-and-retry rule and Jev as the picker are as ADR-0005 set them. A page read still writes only `pageFacts`. (Amended below: the stamp-and-retry rule and the schema did move once the review found the gap.)

## Why this reverses C over A

ADR-0005 rejected A on cost: ~600 credits once and ~100 a week for lots nobody views. With the plain fetch the marginal cost of a read is one HTTP request to the shop and one Jev request, and the sweep cap bounds both. What A buys is coverage on the surfaces that never trigger the on-view ask: the roaster grid's notes column, recommendation candidates, and search. Half the catalog had no notes to show there.

## Consequences

- Expected coverage rises from 53% of lots to around 90%; Heart and East Pole publish no descriptors anywhere, and Verve keeps its notes only in an image alt attribute.
- The one-time backfill is roughly 1300 lots at 25 per crawl per roaster, so it completes within a few crawl cycles for the large catalogs (Sey, Proud Mary) and one cycle for the rest.
- A shop that rate-limits or challenges the crawler's user agent falls back to Firecrawl for every lot, which is the pre-ADR cost; the sweep cap bounds it.
- A theme that marks another product's notes with the same class as its own, without an upsell-style class, can lead the candidates with the wrong coffee's notes. Jev's per-note question asks about "the one coffee sold on this product page", which is the guard.
- Every extractor change remains a catalog correction; a lot read once is not re-read until its facts are cleared or the retry window passes with no facts stored.

## Amended 2026-09-18

A review of the first cut found that `needsPageFacts` treated any stored `pageFacts` as settled and `store` settled a lot on any single fact, so a lot whose first read yielded only a process was never read again, and that lots whose reads found nothing were retried every day with no end. The coverage estimate above assumed neither. The rule is now:

- A lot is read while any page fact is still missing after the merge: elevation, process, producer, region, roast level, tasting notes or variety (`lotFacts.hasMissingPageFacts`). Stored page facts do not settle a lot while another field is empty. The card badge (`isThin`) keeps its narrower rule of process, variety and notes.
- A lot is read at most `MAX_PAGE_READS` times (3) and no sooner than `PAGE_FACTS_RETRY_MS` (24 hours) apart. Every attempt counts, whether it found facts, found nothing, or could not read the page either way. A lot at the cap is left as it is.
- A read with facts no longer settles a lot that is still missing facts. A later read merges its facts over the earlier read's, so a second read adds fields without dropping the first read's.
- The `products` table gained `pageReads`, the attempt counter, owned by the page scrape next to `copyFetchedAt`. A lot without a shop URL is dropped before the sweep's slice, so it never holds one of the crawl's slots.
- The plain fetch accepts the page only when the shop answered from the same shop (host ignoring a leading www, an http to https upgrade allowed) and either the same path (query string and trailing slash ignored) or another product path, which is how Shopify answers a renamed handle. A redirect to a collection or any other page falls back to Firecrawl, which checks `sourceURL` itself.
- Sey stays in the sweep although its shop renders client-side and every lot needs the Firecrawl fallback: the markdown carries labelled Varietal, Region, Altitude and Processing blocks the page reader already understands (checked on one page, 2026-09-18), so the credits buy facts the feed does not state.
- Firecrawl fallbacks share one deployment-wide budget, `FIRECRAWL_FALLBACK_PER_MINUTE`, across every sweep and the recommendation worker. A cron tick crawls every source at once, and the first live sweeps sent every roaster's fallbacks into Firecrawl's per-minute limit. A read the budget defers, or one Firecrawl answers with 429, keeps its schedule stamp and is not a counted attempt.
- The sweep runs for `product_pages` sources too. That crawl reads every product page through Firecrawl's structured product format and the feed extractors over its description; it never sees the theme's notes element or the rendered spec block, which is what the sweep's candidates and Jev pick from. The second read is a plain fetch, no credit.

The backfill therefore grows from roughly 1300 lots to most of the 2740 current lots, since few feeds state producer, region, elevation and roast level all together, still at 25 per roaster per crawl. The owner prefers complete extraction over that cost. A noteless catalog (Heart, East Pole, Verve) now costs at most three Jev requests per lot in total instead of one per lot per day.

## Amended 2026-09-18, later the same day

- Every Jev question names the lot ("Ethiopia Mullugeta Muntasha", the one coffee sold on this product page) and the state opens with a `Coffee: <name>` line, when the read knows the name. The sweep, the lot page's ask and the recommendation worker all pass it; a read scheduled before the change runs without it. Sweet Bloom's featured-products block had passed the unnamed per-note question with another blend's notes on 54 of 55 lots; the block cut is the first guard, the name the second.
- `pageFacts.resetReads` clears the read count and the stamp on one roaster's current lots, and with `clearFacts` the stored page facts, so an extractor fix can be applied now instead of waiting for the retry window or never (a lot at the cap). Run by hand from the CLI.
- Labelled image alt text joins the page text (ADR-0009).

## Amended 2026-09-19

- The sweep skips a sold-out lot (`anyAvailable === false`). The first prod backfill showed Sey's feed keeps years of sold-out lots current (874 of 881), and with every lot's stamp equal after one crawl the sweep spent its first slots on 2019 archive pages while the seven purchasable lots waited behind roughly nine hours of reads. A sold-out lot's facts wait until a size is purchasable again; the lot page's on-view ask (`pageFacts.request`) is unchanged, so a viewer who reaches a sold-out lot still gets its read. A lot with no rollup yet (variants never seen) is not judged sold out and stays due.
- The line above about Sey needing the Firecrawl fallback is stale: Sey's shop answers the plain fetch with the labelled blocks (ADR-0009).

