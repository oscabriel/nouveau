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

// §14.4 lot copy: what the roaster publishes about the lot itself, stored on
// `products` at upsert time (products upsert every crawl, so new fields fill
// on the next cycle — no migration). All optional: HTML-mode and thin feeds
// carry none of it.
export const extractedProduct = v.object({
	description: v.optional(v.string()),
	externalId: v.string(),
	handle: v.string(),
	imageUrl: v.optional(v.string()),
	name: v.string(),
	origin: v.optional(v.string()),
	process: v.optional(v.string()),
	roastLevel: v.optional(v.string()),
	roasterNotes: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	variants: v.array(extractedVariant),
});

export interface ExtractedVariant {
	available: boolean;
	grams?: number;
	name: string;
	priceCents: number;
}

export interface ExtractedProduct {
	description?: string;
	externalId: string;
	handle: string;
	imageUrl?: string;
	name: string;
	origin?: string;
	process?: string;
	roastLevel?: string;
	roasterNotes?: string;
	tags?: string[];
	variants: ExtractedVariant[];
}

/** Store cap for the HTML-stripped description (marketing copy runs long). */
export const DESCRIPTION_MAX_LENGTH = 2000;
/** Store cap for roasterNotes (a descriptor clause, not the whole paragraph). */
export const ROASTER_NOTES_MAX_LENGTH = 200;
/** Store cap for the tag list (tags are marketing noise as often as not). */
export const MAX_TAGS = 32;

const NAMED_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&apos;": "'",
	"&gt;": ">",
	"&lt;": "<",
	"&nbsp;": " ",
	"&quot;": '"',
};

/** Block-level tags become paragraph breaks; everything else inline. */
const BLOCK_TAG =
	/<\/?\s*(?:p|div|br|li|ul|ol|h[1-6]|blockquote|table|tr|td|th)\b[^>]*>/giu;

/**
 * Strip tags, decode entities, collapse whitespace — roaster copy as prose.
 * Block tags become newlines: tasting-note lists often live in their own
 * block (Ruby's <h5>We Taste: …</h5>), and the newline is what stops the
 * roasterNotes clause captures at the end of the descriptor list.
 */
export const stripHtml = (html: string): string =>
	html
		.replaceAll(BLOCK_TAG, "\n")
		.replaceAll(/<[^>]*>/gu, " ")
		.replaceAll(
			/&(?:amp|apos|gt|lt|nbsp|quot|#\d+|#x[0-9a-f]+);/giu,
			(entity) => {
				const named = NAMED_ENTITIES[entity.toLowerCase()];
				if (named !== undefined) {
					return named;
				}
				const hex = /^&#x/iu.test(entity);
				const digits = entity.replaceAll(/&#x|&#|;/giu, "");
				const radix = hex ? 16 : 10;
				const codePoint = Number.parseInt(digits, radix);
				return Number.isNaN(codePoint)
					? entity
					: String.fromCodePoint(codePoint);
			}
		)
		.replaceAll(/[^\S\n]+/gu, " ")
		.replaceAll(/\s*\n\s*/gu, "\n")
		.trim();

/** Cap at a word boundary so stored copy never ends mid-word. */
const capAtWord = (text: string, maxLength: number): string | null => {
	const trimmed = text.trim();
	if (trimmed === "") {
		return null;
	}
	if (trimmed.length < maxLength) {
		return trimmed;
	}
	const cut = trimmed.lastIndexOf(" ", maxLength - 1);
	return (
		cut < 20 ? trimmed.slice(0, maxLength) : trimmed.slice(0, cut)
	).trim();
};

const ORIGIN_TAG = /^(?:origin|from|country)$/iu;
const PROCESS_TAG = /^process$/iu;
const ROAST_TAG = /^(?:roast|roast level)$/iu;
const ROAST_VALUE = /light|medium|dark/iu;
const BARE_PROCESS_TAG = /^(?:washed|natural|honey|anaerobic)$/iu;
const FLAVOR_PROFILE_TAG = /^flavor profile$/iu;

export interface LotAttributes {
	origin?: string;
	process?: string;
	roastLevel?: string;
}

/**
 * Parsed tag conventions over the roaster's own tag vocabulary (observed
 * 2026-09-04: Proud Mary `From: Ethiopia`/`Process: Natural`, Intelligentsia
 * `Country: Guatemala`/`Roast Level: ...`, Verve `Roast: Light`, Onyx
 * `origin:Ethiopia`, Ruby bare `Washed`). `roastLevel` only lands when the
 * value names an actual roast — Intelligentsia uses "Roast Level: Bright"
 * for taste, not roast.
 */
export const parseLotAttributes = (tags: string[]): LotAttributes => {
	const attributes: LotAttributes = {};
	for (const tag of tags) {
		const [key, ...rest] = tag.split(":");
		const value = rest.join(":").trim();
		if (ORIGIN_TAG.test(key.trim()) && value !== "") {
			attributes.origin ??= value;
		} else if (PROCESS_TAG.test(key.trim()) && value !== "") {
			attributes.process ??= value;
		} else if (ROAST_TAG.test(key.trim()) && ROAST_VALUE.test(value)) {
			attributes.roastLevel ??= value;
		} else if (BARE_PROCESS_TAG.test(tag.trim())) {
			attributes.process ??= tag.trim();
		}
	}
	return attributes;
};

/** Trailing connectives left behind by the clause captures ("and", "&"). */
const TRIM_TAIL = /[\s,&-]+$/u;

/**
 * roasterNotes (§14.4): descriptors taken only from the roaster's own copy —
 * a clause matched over the description prose, else the structured Flavor
 * Profile tag. Null when nothing matches. Nothing is invented: the matched
 * words are stored verbatim.
 */
export const extractRoasterNotes = (
	description: string,
	tags: string[]
): string | null => {
	const clause = (pattern: RegExp): string | null =>
		pattern.exec(description)?.groups?.clause.replace(TRIM_TAIL, "").trim() ??
		null;
	// Ruby lists descriptors dash-separated in their own block; the newline
	// (not the boilerplate that follows) ends the capture.
	const dashList = clause(/we\s+taste:?\s*(?<clause>[^\n]{5,200})/iu);
	const matched =
		dashList ??
		clause(
			/in\s+the\s+cup,?\s+we\s+(?:find|taste|get)\s+(?<clause>[^.!?\n]{5,200})/iu
		) ??
		clause(
			/(?:tasting\s+)?notes\s+of\s+(?<clause>[^\u2014\u2013.!?\n]{5,160})/iu
		) ??
		clause(/flavors\s+of\s+(?<clause>[^\u2014\u2013.!?\n]{5,160})/iu);
	if (matched !== null && matched !== "") {
		return capAtWord(matched, ROASTER_NOTES_MAX_LENGTH);
	}
	// Intelligentsia puts descriptors in a structured tag when the prose has
	// none ("Flavor Profile: Caramel + Stone Fruit").
	for (const tag of tags) {
		const [key, ...rest] = tag.split(":");
		if (FLAVOR_PROFILE_TAG.test(key.trim()) && rest.join(":").trim() !== "") {
			return capAtWord(rest.join(":"), ROASTER_NOTES_MAX_LENGTH);
		}
	}
	return null;
};

/** Normalize the Shopify tag field (array from products.json, comma string
 * elsewhere) into a clean list. */
export const parseTags = (
	tags: string[] | string | null | undefined
): string[] =>
	(Array.isArray(tags) ? tags : (tags ?? "").split(","))
		.map((tag) => tag.trim())
		.filter((tag) => tag !== "");

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

interface ShopifyImage {
	src?: string | null;
}

interface ShopifyProduct {
	body_html?: string | null;
	handle?: string | null;
	id?: number | string | null;
	image?: ShopifyImage | null;
	images?: ShopifyImage[] | null;
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
		const tags = parseTags(raw.tags);
		// The block-structured text drives the notes regex (blocks end clause
		// captures); the stored description is the same copy flattened to one
		// line.
		const blockText =
			typeof raw.body_html === "string" ? stripHtml(raw.body_html) : "";
		const description = capAtWord(
			blockText.replaceAll("\n", " "),
			DESCRIPTION_MAX_LENGTH
		);
		const imageUrl =
			raw.image?.src ??
			raw.images?.find((image) => typeof image.src === "string")?.src ??
			null;
		const attributes = parseLotAttributes(tags);
		const roasterNotes = extractRoasterNotes(blockText, tags);
		products.push({
			externalId: String(raw.id ?? raw.handle ?? ""),
			handle: raw.handle ?? "",
			name: raw.title ?? "",
			variants,
			...(description === null ? {} : { description }),
			...(imageUrl === null || imageUrl === undefined ? {} : { imageUrl }),
			...(tags.length === 0 ? {} : { tags: tags.slice(0, MAX_TAGS) }),
			...attributes,
			...(roasterNotes === null ? {} : { roasterNotes }),
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
