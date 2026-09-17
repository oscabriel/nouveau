// The shop page of a lot. Shopify lots live at `/products/{handle}` on the
// roaster's site; WooCommerce and product-page lots store the page URL the
// crawl read them from (products.url). One helper so the lot page, the
// recommendation candidate and the page-facts scrape all agree.

import type { Doc } from "./_generated/dataModel";

const HANDLE = /^[a-zA-Z0-9-]+$/u;

/** A Shopify product page, or null when the inputs cannot form a safe https URL. */
export const productUrl = (
	websiteUrl: string,
	handle: string
): string | null => {
	try {
		const base = new URL(websiteUrl);
		if (
			base.protocol !== "https:" ||
			base.username ||
			base.password ||
			!HANDLE.test(handle)
		) {
			return null;
		}
		return new URL(`/products/${handle}`, base.origin).href;
	} catch {
		return null;
	}
};

/** The lot's own page: the stored URL when the crawl knew it, else Shopify's. */
export const lotShopUrl = (
	roaster: Pick<Doc<"roasters">, "websiteUrl">,
	lot: Pick<Doc<"products">, "handle" | "url">
): string | null => lot.url ?? productUrl(roaster.websiteUrl, lot.handle);
