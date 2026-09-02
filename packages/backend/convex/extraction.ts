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

/**
 * Request headers for every Shopify storefront fetch. Shopify Markets picks a
 * market (and converts prices) per request from geo signals that are not
 * reliable from a server — Madcap's feed came back in AED with a floating
 * rate, flapping price events every crawl. Nouveau tracks US roasters in USD,
 * so the localization cookie pins the US market explicitly.
 */
export const SHOPIFY_FETCH_HEADERS: Record<string, string> = {
	accept: "application/json",
	cookie: "localization=US",
};

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

/** Stop walking products.json pages here even if the feed is still full
 * (4 x 250 = 1000 products; the biggest seeded roasters sit around 300). */
export const MAX_PRODUCTS_JSON_PAGES = 4;

export interface FeedWalkResult {
	pageError: string | null;
	products: ExtractedProduct[];
}

export interface FeedWalkInput {
	/** Fetches one page body; null when the page is unavailable. */
	fetchPage: (url: string) => Promise<string | null>;
	firstPage: ProductsJsonPage;
	websiteUrl: string;
}

const parsePage = (text: string): ProductsJsonPage | null => {
	try {
		return parseProductsJson(text);
	} catch {
		return null;
	}
};

/**
 * Walk the feed pages after the first while the raw feed reports a full page,
 * merging products by externalId. The raw feedCount (not the post-filter
 * count) decides whether another page exists. A page lost mid-walk fails the
 * whole walk instead of returning a partial catalog, which would miss-count
 * the tail products toward the 3-strike archive.
 */
export const walkFeedPages = async (
	input: FeedWalkInput
): Promise<FeedWalkResult> => {
	const collected = new Map<string, ExtractedProduct>();
	for (const product of input.firstPage.products) {
		collected.set(product.externalId, product);
	}
	let { feedCount } = input.firstPage;
	let page = 1;
	while (
		feedCount === PRODUCTS_JSON_PAGE_SIZE &&
		page < MAX_PRODUCTS_JSON_PAGES
	) {
		page += 1;
		// Pages are sequential by design: each full page decides whether the
		// next one exists.
		// eslint-disable-next-line no-await-in-loop
		const text = await input.fetchPage(
			shopifyProductsUrl(input.websiteUrl, page)
		);
		const parsed = text === null ? null : parsePage(text);
		if (parsed === null) {
			return {
				pageError: `products.json page ${page} unavailable; partial catalog discarded`,
				products: [],
			};
		}
		for (const product of parsed.products) {
			collected.set(product.externalId, product);
		}
		({ feedCount } = parsed);
	}
	if (feedCount === PRODUCTS_JSON_PAGE_SIZE) {
		console.warn(
			`${input.websiteUrl}: products.json still full at page ${page}; catalog may exceed the crawl cap`
		);
	}
	return { pageError: null, products: [...collected.values()] };
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
	const extraction = (json as HtmlExtraction | null | undefined)?.products;
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
