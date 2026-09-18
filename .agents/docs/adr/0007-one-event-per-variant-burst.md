# One Drop event per variant burst per kind; variants gain a source id for deep links

Decided 2026-09-17 (owner). Evidence: the dev feed rendering one lot ("Yaye Chericho - Honey Process - 2025") as eight cards for one restock cycle, the per-event email fanout in `notifyWatchersOfEvent`, and build spec #19, which already collapsed a lot's first sighting to one event citing its cheapest size. Amends the per-variant emission the same commit introduced for known lots.

A crawl compares one variant at a time (`crawlSources.diffVariant`), and each compared variant emitted its own `dropEvents` row. A roaster restocking 250 g, 1 kg, 2 lb and 5 lb in one crawl therefore produced four `back_in_stock` events: four feed cards, four emails to every watcher, and four delivery-ledger rows per user. Build spec #19 had already recognized the burst as the real unit for a lot's *first* sighting ("every size is new at once and they are one fact"), but sizes added later and price/stock moves kept one event per variant.

Meanwhile the lot page and the roaster grid needed variant data the events never carried: which sizes exist, what each costs, and a link to the exact size on the roaster's shop. The Shopify feed publishes a numeric variant id for exactly that deep link; the store kept none of it.

## Decision

**Burst collapse.** One crawl of one product is one burst. `diffVariant` only reports the move; `planBurstEvents` groups the reported moves by kind and emits at most one event per kind (`back_in_stock`, `price_drop`, `sold_out`, `price_rise`, `new`), so a burst produces at most five events instead of one per moved variant. Each event carries:

- `variantId` — the headline variant the cards and emails name. Restocks and new sizes headline the cheapest size (the price a customer can actually pay first); price moves headline the biggest delta, ties to the cheaper new price.
- `variantIds` — every moved variant, capped at `MAX_CITED_VARIANTS` (32); the feed cards render the cited size names.
- price fields — the headline's own prices, and only when the headline's price moved.

The same-variant precedence rule is preserved: availability outranks price, so a variant that restocked *and* repriced appears in the `back_in_stock` event alone (citing both prices), never also in the price-drop bucket. The "new" collapse of #19 now also covers sizes added to a known lot later: one event citing the cheapest added size. A burst of one is byte-identical to the old per-variant event.

**Variant identity.** `productVariants.externalId` stores the source's own variant id (a Shopify variant id, as a string) when the feed publishes one. `variantShopUrl` builds the deep link: `?variant=` on the Shopify product page; anything without an id links the lot page. The id backfills onto name-matched variants on the next crawl — no migration. WooCommerce variations get no id; they link the lot page.

**Variant rollup.** `products.anyAvailable`, `products.minPriceCents` and `products.weightOptions` (distinct grams, ascending, capped at 8) are recomputed from the fetched variants on every upsert, in the same patch as the other feed fields. The feed is the stock truth each crawl. The lot page (`lots.get`) returns a `variants` table (size, grind split off the display name, price, availability, deep link) and a lot-level `available` flag; the roaster grid rows carry the same rollup, so unavailable lots dim and say so, and `listLotsFiltered` / `searchLots` filter on availability, price cap, bag size and origin substring over a bounded scan (`LOT_FILTER_SCAN`).

## Why this and not the alternatives

- **Group at the query layer** (`feed.ts` by productId within a time window): the email fanout stays broken, and "same burst" becomes a guess at read time. The crawl boundary is a fact only the writer knows.
- **Deduplicate in the React layer**: hides rows it cannot explain; the delivery footer stays per-event; emails still flood.
- **One event per burst regardless of kind**: a restock-plus-reprice burst would lose the price-drop visual and the email wording that names the move. Per-kind collapse keeps every card's type semantics and still removes the 4x noise.
- **Filter with Convex's FilterBuilder before `.paginate()`**: availability and a price cap are expressible, but weight membership (`weightOptions` contains 250 g) and origin substrings are not expressions. The filtered queries therefore run one bounded index scan (`LOT_FILTER_SCAN` = 1000, the biggest catalog is ~900 lots) and filter in JS; the unfiltered browse path stays paginate-based.
- **Hand-rolled pagination over a JS filter**: violates the paginationOpts contract and reactive pagination semantics for no gain over a bounded scan.

## Consequences

- A four-size restock is one card, one email per watcher, one ledger row per user. The Yaye Chericho case: eight cards become two (the sold-out and restock moments are genuinely different moments and both stay on the timeline).
- Deep links work on Shopify lots within one crawl of the schema change; older WooCommerce and product-page variants keep linking the lot page.
- Lots crawled before this change lack rollup fields until their next crawl (products upsert every crawl, so within one cadence). Absent rollup reads as unknown, never as sold out, everywhere it is rendered.
- The filtered grid reads up to 1000 product rows per render — bounded by the roaster's catalog, acceptable at the current scale; revisit with an index-backed shape if a roaster exceeds it.
- Email bodies name the headline size only; the full cited size list lives on the feed card and the lot page's size table.
- Jev is untouched by all of this: the collapse is deterministic plumbing over our own inventory data.
