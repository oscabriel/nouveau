// How a crawl source reads its roaster's shop (ADR-0006, the platform
// ladder). Decided once per source by the probe (platform.ts) and dispatched
// on by the crawler; each mode maps a shop's own data into the same
// ExtractedProduct shape so everything downstream is platform-blind.

import type { Infer } from "convex/values";
import { v } from "convex/values";

export const sourceModeValidator = v.union(
	// Shopify storefront feed (ADR-0001). Free, complete, per-variant stock.
	v.literal("products_json"),
	// WooCommerce Store API. Free, public, paginated; variations fetched
	// per product when sizes differ.
	v.literal("woocommerce"),
	// Any other shop: Firecrawl's deterministic `product` format over each
	// product page, gated by change tracking on the collection page.
	v.literal("product_pages")
);

export type SourceMode = Infer<typeof sourceModeValidator>;
