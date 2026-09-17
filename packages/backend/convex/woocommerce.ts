// woocommerce mode (ADR-0006): the WooCommerce Store API is public on every
// WordPress shop that runs the block cart, no key needed:
//   GET /wp-json/wc/store/v1/products?per_page=100&page=N
// paginated through the X-WP-TotalPages header, prices in minor units with a
// currency code, stock per product, and a variation listing per parent
// (`?type=variation&parent=ID`) when the sizes carry their own prices. Pure
// parsing here; crawler.ts fetches.

import { buildLotCopy, classifyLot, parseVariantGrams } from "./extraction";
import type { ExtractedProduct, ExtractedVariant } from "./extraction";

export const WOO_PAGE_SIZE = 100;
/** Stop paging here even if the shop reports more (500 products). */
export const MAX_WOO_PAGES = 5;

/** One page of the Store API product listing. */
export const wooProductsUrl = (websiteUrl: string, page = 1): string => {
	const { origin } = new URL(websiteUrl);
	return `${origin}/wp-json/wc/store/v1/products?per_page=${WOO_PAGE_SIZE}&page=${page}`;
};

/** The variations of one variable product. */
export const wooVariationsUrl = (
	websiteUrl: string,
	parentId: number
): string => {
	const { origin } = new URL(websiteUrl);
	return `${origin}/wp-json/wc/store/v1/products?type=variation&parent=${parentId}&per_page=${WOO_PAGE_SIZE}`;
};

interface WooPrices {
	currency_code?: string | null;
	currency_minor_unit?: number | null;
	price?: string | number | null;
	price_range?: {
		max_amount?: string | number | null;
		min_amount?: string | number | null;
	} | null;
}

interface WooTerm {
	name?: string | null;
}

interface WooAttribute {
	has_variations?: boolean | null;
	name?: string | null;
	terms?: WooTerm[] | null;
}

/** The Store API product, listing and variation shapes alike. */
export interface WooProduct {
	attributes?: WooAttribute[] | null;
	brands?: WooTerm[] | null;
	categories?: WooTerm[] | null;
	description?: string | null;
	id?: number | null;
	images?: { src?: string | null }[] | null;
	is_in_stock?: boolean | null;
	is_purchasable?: boolean | null;
	name?: string | null;
	parent?: number | null;
	permalink?: string | null;
	prices?: WooPrices | null;
	short_description?: string | null;
	slug?: string | null;
	tags?: WooTerm[] | null;
	type?: string | null;
	/** On a variation: its attribute values, `Size: 12 oz, Grind: Whole Bean`. */
	variation?: string | null;
	variations?: { id?: number | null }[] | null;
}

const SIZE_ATTRIBUTE = /\b(?:size|weight|bag|amount|quantity)\b/iu;

/** Cents from a Store API price string in the shop's minor unit. */
const wooCents = (prices: WooPrices | null | undefined): number | null => {
	const raw = prices?.price;
	const amount = typeof raw === "number" ? raw : Number(raw ?? Number.NaN);
	if (!Number.isFinite(amount)) {
		return null;
	}
	const minorUnit = prices?.currency_minor_unit ?? 2;
	return Math.round(amount * 10 ** (2 - minorUnit));
};

const termNames = (terms: WooTerm[] | null | undefined): string[] =>
	(terms ?? [])
		.map((term) => term.name?.trim() ?? "")
		.filter((name) => name !== "");

/**
 * Whether the parent's variations are worth a second fetch: only when they
 * are different bag sizes, which shows as a price range or a size-like
 * attribute with several terms. A grind-only matrix (JBC: seven grinds, one
 * price) is one lot at one price, and one variant.
 */
export const wantsVariations = (product: WooProduct): boolean => {
	if ((product.variations ?? []).length === 0) {
		return false;
	}
	const range = product.prices?.price_range;
	if (
		range !== null &&
		range !== undefined &&
		range.min_amount !== range.max_amount
	) {
		return true;
	}
	return (product.attributes ?? []).some(
		(attribute) =>
			attribute.has_variations === true &&
			SIZE_ATTRIBUTE.test(attribute.name ?? "") &&
			(attribute.terms ?? []).length > 1
	);
};

/**
 * The size part of a variation label: `Size: 12 oz, Grind: Whole Bean` is
 * the `12 oz` bag. A label without a size-like key keeps every value, so a
 * shop that names its size attribute oddly still gets distinct variants.
 */
export const variationName = (label?: string | null): string => {
	const parts = (label ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.map((part) => {
			const colon = part.indexOf(":");
			return colon === -1
				? { key: "", value: part }
				: {
						key: part.slice(0, colon).trim(),
						value: part.slice(colon + 1).trim(),
					};
		});
	const sizes = parts.filter((part) => SIZE_ATTRIBUTE.test(part.key));
	const chosen = sizes.length > 0 ? sizes : parts;
	const name = chosen.map((part) => part.value).join(" / ");
	return name === "" ? "Default" : name;
};

/**
 * Variants from a parent's variation listing, collapsed to one per size
 * name: a Size x Grind matrix repeats each size once per grind, and a size is
 * available if any grind of it is.
 */
export const parseWooVariations = (raw: unknown): ExtractedVariant[] => {
	if (!Array.isArray(raw)) {
		return [];
	}
	const byName = new Map<string, ExtractedVariant>();
	for (const item of raw as WooProduct[]) {
		const priceCents = wooCents(item.prices);
		if (priceCents === null) {
			continue;
		}
		const name = variationName(item.variation);
		const available = item.is_in_stock === true;
		const prior = byName.get(name);
		if (prior !== undefined) {
			prior.available ||= available;
			prior.priceCents = Math.min(prior.priceCents, priceCents);
			continue;
		}
		const grams = parseVariantGrams(name, []);
		byName.set(name, {
			available,
			...(grams === undefined ? {} : { grams }),
			name,
			priceCents,
		});
	}
	return [...byName.values()];
};

type WooItem =
	| { externalId: string; kind: "rejected" }
	| {
			currency?: string;
			kind: "lot";
			product: ExtractedProduct;
			variationParent?: { externalId: string; parentId: number };
	  };

/**
 * The listing's own variant: the shop's price and stock for the product,
 * named by its single size attribute when it has one. Sizes with their own
 * prices replace this once the crawler fetches the variations.
 */
const listingVariant = (
	raw: WooProduct,
	priceCents: number,
	sizeHints: string[]
): ExtractedVariant => {
	const sizeTerm = (raw.attributes ?? []).find(
		(attribute) =>
			SIZE_ATTRIBUTE.test(attribute.name ?? "") &&
			(attribute.terms ?? []).length === 1
	)?.terms?.[0]?.name;
	const name = sizeTerm?.trim() || "Default";
	// A category can name the bag ("12 oz coffee" at JBC).
	const grams = parseVariantGrams(name, sizeHints);
	return {
		available: raw.is_in_stock === true,
		...(grams === undefined ? {} : { grams }),
		name,
		priceCents,
	};
};

/** One listing item: a lot, a classifier reject, or null when unusable. */
const parseWooItem = (raw: WooProduct): WooItem | null => {
	if (typeof raw.id !== "number") {
		return null;
	}
	const externalId = String(raw.id);
	const title = raw.name?.trim() ?? "";
	const categories = termNames(raw.categories);
	const tags = termNames(raw.tags);
	const [vendor] = termNames(raw.brands);
	const verdict = classifyLot({
		productType: categories.join(","),
		tags,
		title,
		vendor,
	});
	if (!verdict.isLot) {
		return { externalId, kind: "rejected" };
	}
	const priceCents = wooCents(raw.prices);
	if (priceCents === null || title === "") {
		return null;
	}
	const currency = raw.prices?.currency_code?.toUpperCase();
	const permalink = raw.permalink?.trim();
	const product: ExtractedProduct = {
		externalId,
		handle: raw.slug?.trim() || externalId,
		lotCopy: buildLotCopy({
			bodyHtml:
				(raw.description ?? "").trim() === ""
					? raw.short_description
					: raw.description,
			imageUrl: raw.images?.find((image) => typeof image.src === "string")?.src,
			productType: categories.join(", "),
			tags,
			title,
			vendor,
		}),
		name: title,
		...(permalink ? { url: permalink } : {}),
		variants: [listingVariant(raw, priceCents, [title, ...categories])],
	};
	return {
		...(currency ? { currency } : {}),
		kind: "lot",
		product,
		...(wantsVariations(raw)
			? { variationParent: { externalId, parentId: raw.id } }
			: {}),
	};
};

export interface WooListingPage {
	/** Raw listing length before the classifier. */
	feedCount: number;
	/** Every currency a kept product priced in; the market check wants all USD. */
	currencies: string[];
	products: ExtractedProduct[];
	/** externalIds the classifier rejected (§16), for the non-lot purge. */
	rejectedExternalIds: string[];
	/** Parents whose sizes carry their own prices; the crawler fetches these. */
	variationParents: { externalId: string; parentId: number }[];
}

/**
 * Parse one page of the Store API listing. Throws when the body is not a
 * Store API product list, so a probe can tell WooCommerce from a WordPress
 * blog. A product's single variant is the listing price and stock; parents
 * that `wantsVariations` are named in `variationParents` for the crawler to
 * expand, replacing that placeholder.
 */
export const parseWooListing = (text: string): WooListingPage => {
	const body: unknown = JSON.parse(text);
	if (!Array.isArray(body)) {
		throw new TypeError("Not a WooCommerce Store API product list");
	}
	const listing = body as WooProduct[];
	const currencies = new Set<string>();
	const products: ExtractedProduct[] = [];
	const rejectedExternalIds: string[] = [];
	const variationParents: WooListingPage["variationParents"] = [];
	for (const raw of listing) {
		const item = parseWooItem(raw);
		if (item === null) {
			continue;
		}
		if (item.kind === "rejected") {
			rejectedExternalIds.push(item.externalId);
			continue;
		}
		products.push(item.product);
		if (item.currency !== undefined) {
			currencies.add(item.currency);
		}
		if (item.variationParent !== undefined) {
			variationParents.push(item.variationParent);
		}
	}
	return {
		currencies: [...currencies],
		feedCount: listing.length,
		products,
		rejectedExternalIds,
		variationParents,
	};
};
