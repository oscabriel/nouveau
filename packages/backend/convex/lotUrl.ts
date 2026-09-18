// The shop page of a lot. Shopify lots live at `/products/{handle}` on the
// roaster's site; WooCommerce and product-page lots store the page URL the
// crawl read them from (products.url). One helper so the lot page, the
// recommendation candidate and the page-facts scrape all agree.

import type { Doc } from "./_generated/dataModel";

const HANDLE = /^[a-zA-Z0-9-]+$/u;

/**
 * A shop page URL as the catalog stores it: http(s) only, without query
 * string, hash or trailing slash (`?variant=` and `?Size=` are the same
 * lot). Null for anything else, so a shop's own data cannot plant a
 * `javascript:` link on a lot page.
 */
export const bareProductUrl = (url: string): string | null => {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
			return null;
		}
		return `${parsed.origin}${parsed.pathname.replace(/\/$/u, "")}`;
	} catch {
		return null;
	}
};

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

/**
 * The deep link to one size on the roaster's shop: a Shopify variant id
 * appends `?variant=` to the lot page; anything else falls back to the lot's
 * own page. Null when no safe lot URL exists.
 *
 * The gate stands on two facts about the extractors, not on the source
 * mode (crawlSources.mode is not in reach here). Only the Shopify
 * products.json extractor sets a variant externalId (extraction.ts), and
 * only that extractor leaves products.url unset, because its page is
 * /products/{handle} (productUrl above). A stored url therefore marks a
 * WooCommerce or product-page lot, whose shop ignores ?variant=. If a
 * later extractor sets variant ids on a lot that stores its url, pass the
 * mode through instead of widening this test.
 */
export const variantShopUrl = (
	roaster: Pick<Doc<"roasters">, "websiteUrl">,
	lot: Pick<Doc<"products">, "handle" | "url">,
	variant: Pick<Doc<"productVariants">, "externalId" | "name">
): string | null => {
	const base = lotShopUrl(roaster, lot);
	if (base === null) {
		return null;
	}
	const shopifyLot = lot.url === undefined;
	const shopifyVariantId =
		variant.externalId !== undefined && /^[0-9]+$/u.test(variant.externalId);
	if (shopifyLot && shopifyVariantId) {
		return `${base}?variant=${variant.externalId}`;
	}
	return base;
};
