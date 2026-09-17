// The platform ladder (ADR-0006): which source mode reads a shop. Run once
// per roaster, at submission (build spec §7.1 step 2) or by the operator's
// detectSourceMode; the crawler then dispatches on the stored mode. Pure:
// the fetcher is injected so the ladder runs the same in tests.
//
//   1. Shopify feed, apex then `www.` (ADR-0001)
//   2. WooCommerce Store API
//   3. Generic product pages through Firecrawl's product format
//
// Step 3 always "succeeds" here: whether the pages carry structured product
// data is the baseline crawl's job to find out, and it fails visibly if not.

import { fetchFirstFeedPage, parseProductsJson, wwwOrigin } from "./extraction";
import type { FeedPageResponse } from "./extraction";
import type { SourceMode } from "./sourceMode";
import { parseWooListing, wooProductsUrl } from "./woocommerce";

export interface ProbeInput {
	fetchPage: (url: string) => Promise<FeedPageResponse>;
	websiteUrl: string;
}

export interface ProbeResult {
	mode: SourceMode;
	/** The origin that answered; `www.` when the apex had no feed. */
	websiteUrl: string;
}

const hasLots = (
	text: string | null,
	parse: (text: string) => { products: unknown[] }
): boolean => {
	if (text === null) {
		return false;
	}
	try {
		return parse(text).products.length > 0;
	} catch {
		return false;
	}
};

/** Decide how a shop is read. */
export const probeShop = async (input: ProbeInput): Promise<ProbeResult> => {
	const feed = await fetchFirstFeedPage(input);
	if (hasLots(feed.text, parseProductsJson)) {
		return { mode: "products_json", websiteUrl: feed.websiteUrl };
	}

	// The Store API lives on the same host the feed would have; a headless
	// apex with the shop on `www.` gets the same one retry.
	const woo = await input.fetchPage(wooProductsUrl(input.websiteUrl));
	if (hasLots(woo.text, parseWooListing)) {
		return { mode: "woocommerce", websiteUrl: input.websiteUrl };
	}
	const www = wwwOrigin(input.websiteUrl);
	if (www !== null) {
		const retry = await input.fetchPage(wooProductsUrl(www));
		if (hasLots(retry.text, parseWooListing)) {
			return { mode: "woocommerce", websiteUrl: www };
		}
	}

	return { mode: "product_pages", websiteUrl: input.websiteUrl };
};
