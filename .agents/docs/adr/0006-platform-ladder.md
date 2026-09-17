# A platform ladder decides how a shop is read; the LLM grid crawl is gone

Decided 2026-09-16 (owner). Evidence: the 2026-09-16 Firecrawl audit (handoff `nouveau-crawl-review-handoff.md`), `.agents/research/extraction-audit.md` §6 and D14, and nine live scrapes of Onyx, Sey, JBC, Red Rooster and Passenger product pages with Firecrawl's `product` format. Amends ADR-0001's fallback clause.

ADR-0001 made Shopify's `/products.json` the primary source and left "HTML grid parsing with Firecrawl structured extraction" as the fallback for non-Shopify submissions. That fallback (`html` mode) was an LLM `json` extraction over up to 10 collection pages per hour: 5 credits a page, one `Default` variant per product, no copy, no product type, availability guessed from badges, and `externalId` keyed on whatever URL the model returned. It ran for Passenger only because the apex host had no feed; `www.` did, and no seed roaster needs it. A user-submitted non-Shopify shop would hit it next.

Meanwhile 17 of 19 US roasters probed run Shopify; the exceptions are WooCommerce (JBC) and a headless Next storefront (Red Rooster). Both publish structured product data that needs no model: WooCommerce's Store API is a public JSON listing with prices in minor units, a currency code, stock per product and a variation listing per parent; every other shop tested carries JSON-LD, microdata or embedded state that Firecrawl's deterministic `product` format reads for 1 credit, returning the full variant matrix with price, currency and stock.

## Decision

`crawlSources.mode` is a three-step ladder, decided once per roaster by a probe (`platform.ts`, run at submission per build spec §7.1 or by the operator's `detectSourceMode`) and dispatched on by the crawler:

1. `products_json`: the Shopify feed, apex then `www.` (ADR-0001, unchanged).
2. `woocommerce`: `/wp-json/wc/store/v1/products`, paginated by `X-WP-TotalPages`. Variations are fetched only when sizes carry their own prices (a price range, or a size attribute with several terms); a grind-only matrix is one variant. Grind and size are separated in the variation label so a Size x Grind matrix collapses to one variant per size.
3. `product_pages`: one `markdown + links + changeTracking` scrape of the roaster's collection page (1 credit) gates the tick. If the page is unchanged, the baseline is done and the last full read is under six hours old, the crawl finalizes as a success with the catalog untouched. Otherwise every product page in the set is scraped with `formats: ["product"]` and `maxAge: 0` (Firecrawl's default cache is two days, too old for stock). The set is the grid's product links, then the catalog's current lots (so a lot that left the grid is still read and archived once its page is gone), then the sitemap only if the grid listed nothing; capped at 120 pages.

Every mode maps into the same `ExtractedProduct` and passes through the same classifier (`classifyLot`, with the shop's category as the type and its brand as the vendor) and the same `buildLotCopy`. Products from modes 2 and 3 store the shop page they were read from (`products.url`); Shopify lots keep deriving `/products/{handle}`. The market for modes 2 and 3 is confirmed from the currency every price reported, since neither shop type has Shopify's storefront globals.

`html` mode, its LLM prompt and schema, the durable crawl and its completion callback are deleted. No row on dev or prod used it.

## Why this and not the alternatives

- **Keep the LLM grid crawl but fix its hygiene** (issue #35): still 50 credits an hour per roaster for one guessed variant per product. The `product` format is cheaper by 5x per page, deterministic, and gives the variant matrix the domain is built on (a variant is a bag size with its own price and stock).
- **`crawl` with `scrapeOptions.formats: ["product"]`**: one durable job instead of per-page scrapes, but the Convex component only persists `markdown`, `html`, `rawHtml`, `summary`, `screenshot`, `links`, `json` and `changeTracking` on crawled pages; `product` would be dropped. Per-page `scrape` returns the whole document. Revisit if the component grows the field.
- **Firecrawl `map` for discovery**: on JBC it returned 137 URLs, mostly WordPress attachment pages, and none of the 56 products in `product-sitemap.xml`. The collection page's links and the sitemap are free and exact.
- **Sitemap as the primary set**: Red Rooster's names 548 product pages, most retired. The grid is what the shop sells now, which is the catalog a drop watch is about.
- **Firecrawl Monitor or Agent**: server-side scheduling and dynamic pricing; the app owns the schedule and needs per-variant events.
- **Rescrape only the products the collection diff names**: a git-diff of grid markdown is a fragile place to read product identity from. A full re-read on any change costs one credit per lot and is correct.

## Consequences

- A non-Shopify submission costs about one credit per lot once, then one to three credits an hour idle plus one per lot whenever the grid changes. The old path cost up to 1,200 credits a day per roaster.
- A size selling out can leave the grid unchanged; the forced full read every six hours is the bound on that miss. Shopify feeds keep their per-tick variant diff.
- `eligibleSource` no longer requires `products_json`; a WooCommerce or product-page roaster whose prices are all USD can feed Find my next bag.
- `pageFacts` now reads with a day-long `maxAge` and no custom headers (headers bypass Firecrawl's cache; the facts do not depend on the market). Stock-bearing scrapes keep `maxAge: 0`.
- Five product scrapes show the format's shape, not its failure rate across themes. Before a non-Shopify roaster goes into the directory, run `detectSourceMode` and a baseline on dev and read the `unreadable` count the crawl logs.
- The submission flow (§7.1) does not exist yet; when it does, it calls `probeShop` and stores the mode, and a failed baseline is the visible failure the spec asks for.
