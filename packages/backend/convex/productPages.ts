// product_pages mode (ADR-0006): a shop that is neither Shopify nor
// WooCommerce is read one product page at a time through Firecrawl's
// deterministic `product` format (JSON-LD, microdata, embedded state,
// OpenGraph; no LLM, 1 credit). This module is the pure half: mapping a
// `product` object to ExtractedProduct, and finding the product URLs to
// scrape. crawler.ts does the fetching.

import {
	buildLotCopy,
	classifyLot,
	parseVariantGrams,
	toCents,
} from "./extraction";
import type { ExtractedProduct, ExtractedVariant } from "./extraction";
import { bareProductUrl } from "./lotUrl";

/**
 * Firecrawl's `product` object, as documented at
 * docs.firecrawl.dev/features/scrape#product-object-structure. Every field
 * but `variants[].availability` is optional there; typed loosely here and
 * narrowed field by field, since it is read off third-party pages.
 */
export interface FirecrawlProduct {
	brand?: string | null;
	category?: string | null;
	description?: string | null;
	title?: string | null;
	url?: string | null;
	variants?: FirecrawlProductVariant[] | null;
}

export interface FirecrawlProductVariant {
	availability?: { inStock?: boolean | null; text?: string | null } | null;
	id?: string | null;
	images?: { alt?: string | null; url?: string | null }[] | null;
	price?: {
		amount?: number | null;
		currency?: string | null;
		formatted?: string | null;
	} | null;
	sku?: string | null;
	title?: string | null;
	values?: Record<string, string> | null;
}

/** A product page path: Shopify `/products/x`, WooCommerce `/product/x/`. */
const PRODUCT_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?products?\/[^/]+\/?$/iu;

const registrable = (hostname: string): string =>
	hostname.toLowerCase().split(".").slice(-2).join(".");

/** True for a product page on the shop's own host. */
export const isProductUrl = (url: string, shopOrigin: string): boolean => {
	try {
		const parsed = new URL(url);
		return (
			registrable(parsed.hostname) ===
				registrable(new URL(shopOrigin).hostname) &&
			PRODUCT_PATH.test(parsed.pathname)
		);
	} catch {
		return false;
	}
};

/**
 * Product URLs among a page's links, bare and deduplicated, in page order.
 * A collection page lists what the shop sells now, which is the catalog a
 * drop watch cares about (a sitemap also names every retired page).
 */
export const productUrlsFromLinks = (
	links: readonly string[],
	shopOrigin: string
): string[] => {
	const seen = new Set<string>();
	const urls: string[] = [];
	for (const link of links) {
		if (!isProductUrl(link, shopOrigin)) {
			continue;
		}
		const bare = bareProductUrl(link);
		if (bare !== null && !seen.has(bare)) {
			seen.add(bare);
			urls.push(bare);
		}
	}
	return urls;
};

const LOC = /<loc>\s*(?<loc>[^<\s]+)\s*<\/loc>/giu;
const XML_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&apos;": "'",
	"&gt;": ">",
	"&lt;": "<",
	"&quot;": '"',
};

const decodeXml = (text: string): string =>
	text.replaceAll(
		/&(?:amp|apos|gt|lt|quot);/gu,
		(entity) => XML_ENTITIES[entity] ?? entity
	);

/** Every `<loc>` in a sitemap or sitemap index, entities decoded. */
export const sitemapLocations = (xml: string): string[] => {
	const locations: string[] = [];
	for (const match of xml.matchAll(LOC)) {
		const loc = match.groups?.loc;
		if (loc !== undefined) {
			locations.push(decodeXml(loc));
		}
	}
	return locations;
};

/**
 * Which child sitemaps of an index to read: the ones named for products
 * (Shopify `sitemap_products_1.xml`, Yoast `product-sitemap.xml`). A blog's
 * or an attachment sitemap is never worth a fetch.
 */
export const productSitemaps = (index: string[]): string[] =>
	index.filter((loc) => {
		try {
			return /product/iu.test(new URL(loc).pathname);
		} catch {
			// A malformed <loc> is the sitemap's problem, not the crawl's.
			return false;
		}
	});

/** The variant's display name: its title, else its option values joined. */
const variantName = (variant: FirecrawlProductVariant): string => {
	const title = variant.title?.trim();
	if (title !== undefined && title !== "") {
		return title;
	}
	const values = Object.values(variant.values ?? {})
		.map((value) => value.trim())
		.filter((value) => value !== "");
	return values.length > 0 ? values.join(" / ") : "Default";
};

interface ParsedVariants {
	currencies: string[];
	imageUrl?: string;
	variants: ExtractedVariant[];
}

/** Priced variants only (a lot needs a price), the first image among them. */
const parseVariants = (
	raw: readonly FirecrawlProductVariant[]
): ParsedVariants => {
	const currencies = new Set<string>();
	const variants: ExtractedVariant[] = [];
	let imageUrl: string | undefined;
	for (const variant of raw) {
		const amount = variant.price?.amount;
		if (typeof amount !== "number" || !Number.isFinite(amount)) {
			continue;
		}
		const currency = variant.price?.currency;
		if (typeof currency === "string" && currency !== "") {
			currencies.add(currency.toUpperCase());
		}
		const name = variantName(variant);
		const grams = parseVariantGrams(name, Object.values(variant.values ?? {}));
		variants.push({
			available: variant.availability?.inStock === true,
			...(grams === undefined ? {} : { grams }),
			name,
			priceCents: toCents(amount),
		});
		const image = variant.images?.find(
			(candidate) => typeof candidate.url === "string" && candidate.url !== ""
		)?.url;
		if (imageUrl === undefined && typeof image === "string") {
			imageUrl = image;
		}
	}
	return {
		currencies: [...currencies],
		...(imageUrl === undefined ? {} : { imageUrl }),
		variants,
	};
};

export interface ProductPageParse {
	/** The lot, or null when the page's product is a non-lot or unusable. */
	product: ExtractedProduct | null;
	/** True when the classifier rejected it; false when it was unreadable. */
	rejected: boolean;
	/** Currencies the variants priced in; the market check wants all USD. */
	currencies: string[];
}

/**
 * Map one page's `product` to a lot. Keyed by the page URL it was read from
 * (bare), never by `product.url`, which carries `?variant=` on Shopify
 * themes. The classifier gets the page's category as the type and the brand
 * as the vendor; as in every untyped-shop path, only a positive title or
 * type verdict rejects, since an untyped coffee name is every real lot on
 * such a shop. Variants without a price are dropped (a lot needs one);
 * a product with none left is unreadable, not rejected.
 */
export const parseProductPage = (
	raw: unknown,
	pageUrl: string
): ProductPageParse => {
	const none = { currencies: [], product: null, rejected: false };
	const externalId = bareProductUrl(pageUrl);
	if (typeof raw !== "object" || raw === null || externalId === null) {
		return none;
	}
	const product = raw as FirecrawlProduct;
	const title = product.title?.trim() ?? "";
	if (title === "") {
		return none;
	}
	// A breadcrumb category ("Coffee > Single Origin") reads as segments.
	const productType = product.category?.replaceAll(">", ",") ?? null;
	const verdict = classifyLot({
		productType,
		tags: null,
		title,
		vendor: product.brand,
	});
	if (!verdict.isLot && verdict.rule !== "default") {
		return { currencies: [], product: null, rejected: true };
	}

	const { currencies, imageUrl, variants } = parseVariants(
		product.variants ?? []
	);
	if (variants.length === 0) {
		return none;
	}
	return {
		currencies,
		product: {
			externalId,
			handle: externalId.split("/").pop() ?? externalId,
			lotCopy: buildLotCopy({
				bodyHtml: product.description,
				imageUrl,
				productType,
				title,
				vendor: product.brand,
			}),
			name: title,
			url: externalId,
			variants,
		},
		rejected: false,
	};
};
