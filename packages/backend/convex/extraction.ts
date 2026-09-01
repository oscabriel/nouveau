// Pure extraction helpers (ADR-0001): Shopify /products.json is the primary
// source, HTML grid parsing is the fallback. Nothing here touches ctx — it all
// runs identically in actions and tests.

import { v } from "convex/values";

export const extractedVariant = v.object({
	available: v.boolean(),
	grams: v.optional(v.number()),
	name: v.string(),
	priceCents: v.number(),
});

export const extractedProduct = v.object({
	externalId: v.string(),
	handle: v.string(),
	name: v.string(),
	variants: v.array(extractedVariant),
});

export interface ExtractedVariant {
	available: boolean;
	grams?: number;
	name: string;
	priceCents: number;
}

export interface ExtractedProduct {
	externalId: string;
	handle: string;
	name: string;
	variants: ExtractedVariant[];
}

/** Shopify caps /products.json at this many items per page. */
export const PRODUCTS_JSON_PAGE_SIZE = 250;

/** One page of the roaster's Shopify products feed (ADR-0001 primary source). */
export const shopifyProductsUrl = (websiteUrl: string, page = 1): string => {
	const { origin } = new URL(websiteUrl);
	return `${origin}/products.json?limit=${PRODUCTS_JSON_PAGE_SIZE}&page=${page}`;
};

/**
 * Some feeds mix wholesale-only SKUs (Madcap, La Colombe). They are not
 * customer-purchasable lots, so they never enter the catalog.
 */
export const isWholesale = (
	productType: string | null | undefined,
	tags: string[] | string | null | undefined
): boolean => {
	// Tags arrive as an array from /products.json but as a comma-separated
	// string from other Shopify surfaces; both must hit the filter.
	const tagList = Array.isArray(tags) ? tags : [tags ?? ""];
	const haystack = [productType ?? "", ...tagList].join(" ").toLowerCase();
	return haystack.includes("wholesale");
};

const toCents = (price: unknown): number => {
	const n = typeof price === "number" ? price : Number(String(price));
	if (!Number.isFinite(n)) {
		return 0;
	}
	return Math.round(n * 100);
};

interface ShopifyVariant {
	available?: boolean | null;
	grams?: number | null;
	price?: string | number;
	title?: string | null;
}

interface ShopifyProduct {
	handle?: string | null;
	id?: number | string | null;
	product_type?: string | null;
	tags?: string[] | string | null;
	title?: string | null;
	variants?: ShopifyVariant[] | null;
}

export interface ProductsJsonPage {
	/**
	 * Raw feed length before the wholesale filter. A full page
	 * (PRODUCTS_JSON_PAGE_SIZE) means the next page may hold more products.
	 */
	feedCount: number;
	products: ExtractedProduct[];
}

/**
 * Parse one page of a Shopify /products.json body. Throws when the body is
 * not a Shopify products feed (caller falls back to HTML mode). Applies the
 * wholesale-SKU filter; an all-wholesale or empty first page yields no
 * products so the caller can treat an empty catalog as a failed crawl (build
 * spec: empty catalog -> crawl-failed -> HTML mode).
 */
export const parseProductsJson = (text: string): ProductsJsonPage => {
	const body: unknown = JSON.parse(text);
	const feed = (body as { products?: ShopifyProduct[] }).products;
	if (!Array.isArray(feed)) {
		throw new TypeError("Not a Shopify products.json feed");
	}
	const products: ExtractedProduct[] = [];
	for (const raw of feed) {
		if (isWholesale(raw.product_type, raw.tags)) {
			continue;
		}
		const variants: ExtractedVariant[] = (raw.variants ?? []).map(
			(variant) => ({
				available: variant.available === true,
				...(typeof variant.grams === "number" ? { grams: variant.grams } : {}),
				name: variant.title ?? "Default",
				priceCents: toCents(variant.price),
			})
		);
		products.push({
			externalId: String(raw.id ?? raw.handle ?? ""),
			handle: raw.handle ?? "",
			name: raw.title ?? "",
			variants,
		});
	}
	return { feedCount: feed.length, products };
};

/**
 * Structured-extraction prompt for HTML-mode sources (non-Shopify,
 * user-submitted). Firecrawl returns { json } per page against this shape.
 */
export const HTML_EXTRACTION_PROMPT = `Extract every coffee product visible in this product grid. For each product return its display name, its price (a decimal number in the shop's currency), whether it is available for purchase (true unless it is visibly sold out, out of stock, or marked unavailable), its size in grams if shown (from the size option or the product title), and its product page URL.`;

export const htmlExtractionSchema = {
	properties: {
		products: {
			items: {
				properties: {
					available: { type: "boolean" },
					grams: { type: "number" },
					name: { type: "string" },
					price: { type: "number" },
					url: { type: "string" },
				},
				required: ["name", "price", "available"],
				type: "object",
			},
			type: "array",
		},
	},
	required: ["products"],
	type: "object",
};

interface HtmlExtraction {
	products?: {
		available?: boolean;
		grams?: number;
		name?: string;
		price?: number;
		url?: string;
	}[];
}

/** Map one crawled page's structured extraction to a product. */
export const parseHtmlPage = (
	json: unknown,
	pageUrl: string
): ExtractedProduct[] => {
	const extraction = (json as HtmlExtraction).products;
	if (!Array.isArray(extraction)) {
		return [];
	}
	const base = pageUrl.replace(/\/$/u, "");
	return extraction.flatMap((item) => {
		if (typeof item.name !== "string" || item.name.length === 0) {
			return [];
		}
		const url =
			typeof item.url === "string" && item.url.length > 0 ? item.url : null;
		// URL-less items key on page + name so products extracted from the same
		// listing page don't collapse into one externalId.
		const externalId = url ?? `${base}#${item.name}`;
		const product: ExtractedProduct = {
			externalId,
			handle: (url ?? base).split("/").pop() ?? externalId,
			name: item.name,
			variants: [
				{
					available: item.available !== false,
					...(typeof item.grams === "number" ? { grams: item.grams } : {}),
					name: "Default",
					priceCents: Math.round((item.price ?? 0) * 100),
				},
			],
		};
		return [product];
	});
};
