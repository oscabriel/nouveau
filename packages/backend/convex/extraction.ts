// Pure extraction helpers (ADR-0001, ADR-0006): the Shopify /products.json
// parser, the lot classifier, the lot-copy builder and the fact shapes the
// other platform parsers (woocommerce.ts, productPages.ts) share. Nothing
// here touches ctx — it all runs identically in actions and tests.

import { v } from "convex/values";

import type { PageFacts } from "./lotFacts";
import {
	NOTE_SEPARATOR,
	splitNotes,
	verifyElevation,
	verifyNotes,
	verifyProducer,
	verifyRegion,
	verifyVariety,
} from "./lotFacts";

export const extractedVariant = v.object({
	available: v.boolean(),
	// The id the source knows the variant by (a Shopify variant id), when the
	// source publishes one. Enables a deep link to the exact size on the
	// roaster's shop; WooCommerce variations have no stable public link, so
	// they stay nameless ids and link to the lot page.
	externalId: v.optional(v.string()),
	grams: v.optional(v.number()),
	name: v.string(),
	priceCents: v.number(),
});

// §14.4 lot copy: what the roaster publishes about the lot itself, stored on
// `products` at upsert time (products upsert every crawl, so new fields fill
// on the next cycle — no migration). Every field is optional: a lot with no
// tasting prose has no roasterNotes, and that absence is meaningful (see
// ExtractedProduct.lotCopy).
export const lotCopyValidator = v.object({
	description: v.optional(v.string()),
	elevation: v.optional(v.string()),
	imageUrl: v.optional(v.string()),
	origin: v.optional(v.string()),
	process: v.optional(v.string()),
	producer: v.optional(v.string()),
	productType: v.optional(v.string()),
	region: v.optional(v.string()),
	roastLevel: v.optional(v.string()),
	roasterNotes: v.optional(v.array(v.string())),
	tags: v.optional(v.array(v.string())),
	variety: v.optional(v.string()),
});

export const extractedProduct = v.object({
	externalId: v.string(),
	handle: v.string(),
	lotCopy: v.optional(lotCopyValidator),
	name: v.string(),
	url: v.optional(v.string()),
	variants: v.array(extractedVariant),
});

export interface ExtractedVariant {
	available: boolean;
	/** The source's own variant id, when it publishes one (Shopify does). */
	externalId?: string;
	grams?: number;
	name: string;
	priceCents: number;
}

export interface LotCopy {
	description?: string;
	elevation?: string;
	imageUrl?: string;
	origin?: string;
	process?: string;
	producer?: string;
	productType?: string;
	region?: string;
	roastLevel?: string;
	roasterNotes?: string[];
	tags?: string[];
	variety?: string;
}

export interface ExtractedProduct {
	externalId: string;
	handle: string;
	/**
	 * The roaster's published copy (§14.4). Present when the source is
	 * authoritative for it (products.json carries body_html, tags and images
	 * for every product), in which case a field it lacks is cleared on the
	 * stored product: a roaster who edits "notes of cherry" out of their copy
	 * must not keep "cherry" shown as their verbatim words. Absent when the
	 * source knows nothing about copy (HTML mode), and stored values stay.
	 */
	lotCopy?: LotCopy;
	name: string;
	/**
	 * The lot's shop page when the source knows it (a WooCommerce permalink,
	 * the product page a scrape read). Shopify feeds leave it out; their page
	 * is `/products/{handle}` (lotUrl.ts).
	 */
	url?: string;
	variants: ExtractedVariant[];
}

/** Store cap for the HTML-stripped description (marketing copy runs long). */
export const DESCRIPTION_MAX_LENGTH = 2000;
/** Store cap for roasterNotes (a descriptor clause, not the whole paragraph). */
export const ROASTER_NOTES_MAX_LENGTH = 200;
/** Store cap for the tag list (tags are marketing noise as often as not). */
export const MAX_TAGS = 32;
/** Store cap for the raw Shopify product_type. */
const PRODUCT_TYPE_MAX_LENGTH = 60;

/**
 * The named entities the seed shops' pages use (a census of all 20 product
 * pages), plus the markup set. Anything not listed stays as typed, and a
 * stray entity in a spec value splits it: Intelligentsia's
 * "Chinacla&comma; La Paz" read as a region called "comma".
 */
const NAMED_ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&apos;": "'",
	"&comma;": ",",
	"&copy;": "\u00A9",
	"&gt;": ">",
	"&hellip;": "\u2026",
	"&ldquo;": "\u201C",
	"&lsquo;": "\u2018",
	"&lt;": "<",
	"&mdash;": "\u2014",
	"&minus;": "\u2212",
	"&nbsp;": " ",
	"&ndash;": "\u2013",
	"&quot;": '"',
	"&rarr;": "\u2192",
	"&rdquo;": "\u201D",
	"&reg;": "\u00AE",
	"&rsquo;": "\u2019",
	"&trade;": "\u2122",
};

/** Every named entity above plus decimal and hex references; built from the table so the two cannot drift. */
const ENTITY = new RegExp(
	`(?:${Object.keys(NAMED_ENTITIES).join("|")}|&#\\d+;|&#x[0-9a-f]+;)`,
	"giu"
);

/** Block-level tags become paragraph breaks; everything else inline. */
const BLOCK_TAG =
	/<\/?\s*(?:p|div|br|li|ul|ol|h[1-6]|blockquote|table|tr|td|th)\b[^>]*>/giu;

/** Any tag, for stripping or turning into a line break. */
const ANY_TAG = /<[^>]*>/gu;

/** Elements whose text content is code, not prose; dropped whole. */
const DROPPED_ELEMENT =
	/<(?<tag>script|style)\b[^>]*>[\s\S]*?<\/\k<tag>\s*>/giu;

/**
 * Strip tags, decode entities, collapse whitespace — roaster copy as prose.
 * Block tags become newlines: tasting-note lists often live in their own
 * block (Ruby's <h5>We Taste: …</h5>), and the newline is what stops the
 * roasterNotes clause captures at the end of the descriptor list.
 */
export const stripHtml = (html: string): string =>
	html
		.replaceAll(DROPPED_ELEMENT, "\n")
		.replaceAll(BLOCK_TAG, "\n")
		.replaceAll(ANY_TAG, " ")
		.replaceAll(ENTITY, (entity) => {
			const named = NAMED_ENTITIES[entity.toLowerCase()];
			if (named !== undefined) {
				return named;
			}
			const hex = /^&#x/iu.test(entity);
			const digits = entity.replaceAll(/&#x|&#|;/giu, "");
			const radix = hex ? 16 : 10;
			const codePoint = Number.parseInt(digits, radix);
			return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint);
		})
		.replaceAll(/[^\S\n]+/gu, " ")
		.replaceAll(/\s*\n\s*/gu, "\n")
		.trim();

/**
 * Page chrome whose text is never a fact about the coffee, plus the
 * elements that carry no prose (template, noscript, svg): dropped whole.
 * Script and style are stripHtml's own DROPPED_ELEMENT.
 */
const CHROME_ELEMENT =
	/<(?<tag>header|nav|footer|aside|template|noscript|svg)\b[^>]*>[\s\S]*?<\/\k<tag>\s*>/giu;

/**
 * A page below this much text is a script shell (the theme renders
 * client-side), not a product page a plain fetch can read.
 */
export const MIN_PAGE_TEXT_LENGTH = 200;

/**
 * The opening tag of an element a theme dedicates to the coffee's notes
 * (Onyx `tasting-notes`, Counter Culture `tasting-notes--wrapper`,
 * Stumptown `product-flavor-profile__tasting-notes`, Intelligentsia
 * `pv-gallery__flavors`), the class attribute in either quote style.
 */
const NOTES_ELEMENT =
	/<(?<tag>[a-z][a-z0-9-]*)\b[^>]*\bclass=(?<quote>["'])(?<classes>[^"']*(?:tast(?:e|ing)[-_]?notes?|flavou?r[-_]?(?:notes?|profile|s)\b)[^"']*)\k<quote>[^>]*>/giu;
/**
 * A class token (bounded by the start, the end, a space, a hyphen or an
 * underscore) that says the element is another product's block, so a notes
 * element carrying it is skipped: "card__tasting-notes" is an upsell card's,
 * "discard" and "product-grid__tasting-notes" are not.
 */
const OTHER_PRODUCT_CLASS =
	/(?:^|[\s_-])(?:upsells?|related|recommendations?|recommended|cross[-_]?sells?|cards?|collections?)(?=$|[\s_-])/iu;
/**
 * The class tokens (or custom element names) that mark a whole block as
 * other products: the block is cut from the page before anything reads it.
 * Only the tokens that always mean upsell qualify. "card", "grid" and
 * "collection" stay out: Dawn wraps the product itself in `grid`, so cutting
 * on those would drop the page's own description.
 */
const OTHER_PRODUCT_BLOCK =
	/(?:^|[\s_-])(?:upsells?|related|recommendations?|recommended|cross[-_]?sells?|also[-_]?like|complementary|featured[-_]products?)(?=$|[\s_-])/iu;
/** A role that marks a menu or a modal: text a viewer opens, never the lot's. */
const DROPPED_ROLE = /\brole\s*=\s*["']?(?:navigation|dialog)\b/iu;
/**
 * A class token that marks the same thing without the role: a popover or
 * tooltip a viewer opens (Counter Culture's flavor-wheel popover sits inside
 * the notes wrapper and its copy read as notes).
 */
const VIEWER_OPENED_BLOCK =
	/(?:^|[\s_-])(?:popover|popup|tooltip|modal)(?=$|[\s_-])/iu;
/** The class attribute of an opening tag, in either quote style. */
const CLASS_ATTRIBUTE =
	/\bclass\s*=\s*(?<quote>["'])(?<classes>[^"']*)\k<quote>/iu;
/** The id attribute of an opening tag: a theme can mark its upsell section by id alone. */
const ID_ATTRIBUTE = /\bid\s*=\s*(?<quote>["'])(?<id>[^"']*)\k<quote>/iu;
/** An opening tag that carries a class, an id or a role: the only tags a block cut can start at. */
const ATTRIBUTED_OPEN_TAG =
	/<(?<tag>[a-z][a-z0-9-]*)\b(?<attributes>[^>]*\b(?:class|id|role)\s*=[^>]*)>/giu;
/** The opening tag of the page's main element (Shopify: `<main id="MainContent">`). */
const MAIN_OPEN_TAG = /<main\b[^>]*>/iu;
const MAIN_CLOSE_TAG = /<\/main\s*>/giu;
const NOTES_LABEL = /^(?:tast(?:e|ing)|flavou?r)\s*notes?$/iu;
/** Every tag, opening or closing, with its name: the depth scanner. Reset lastIndex before use. */
const TAG_SCANNER = /<\/?(?<name>[a-z][a-z0-9-]*)\b[^>]*>/giu;
/** An element longer than this is a section, not a notes block. */
const MAX_NOTES_ELEMENT_LENGTH = 4000;
/** A dropped block (an upsell section, a menu drawer) is scanned for its close this far; unclosed within it, it stays. */
const MAX_DROPPED_BLOCK_LENGTH = 200_000;
/** Notes elements tried before giving up (an upsell block can sit first). */
const MAX_NOTES_ELEMENTS = 3;

/** Where an element's body starts and where the element ends, or null when the close is not within `maxLength`. */
interface ElementSpan {
	bodyEnd: number;
	bodyStart: number;
	end: number;
}

/**
 * The span of the element whose opening tag `open` matched (its `tag`
 * group, index and length), found by depth over same-named tags.
 */
const elementSpan = (
	html: string,
	open: RegExpExecArray,
	maxLength: number
): ElementSpan | null => {
	const tag = (open.groups?.tag ?? "").toLowerCase();
	const bodyStart = open.index + open[0].length;
	TAG_SCANNER.lastIndex = bodyStart;
	let depth = 1;
	for (
		let match = TAG_SCANNER.exec(html);
		match !== null && match.index - bodyStart < maxLength;
		match = TAG_SCANNER.exec(html)
	) {
		if (match.groups?.name?.toLowerCase() !== tag) {
			continue;
		}
		depth += match[0].startsWith("</") ? -1 : 1;
		if (depth === 0) {
			return {
				bodyEnd: match.index,
				bodyStart,
				end: match.index + match[0].length,
			};
		}
	}
	return null;
};

/** The inner HTML of the element `open` starts; the first cap's worth when it never closes. */
const elementInnerHtml = (html: string, open: RegExpExecArray): string => {
	const span = elementSpan(html, open, MAX_NOTES_ELEMENT_LENGTH);
	if (span !== null) {
		return html.slice(span.bodyStart, span.bodyEnd);
	}
	const bodyStart = open.index + open[0].length;
	return html.slice(bodyStart, bodyStart + MAX_NOTES_ELEMENT_LENGTH);
};

/** Whether an opening tag starts a block the page read never sees. */
const isDroppedBlock = (open: RegExpExecArray): boolean => {
	const { attributes = "", tag = "" } = open.groups ?? {};
	if (DROPPED_ROLE.test(attributes)) {
		return true;
	}
	const classes = CLASS_ATTRIBUTE.exec(attributes)?.groups?.classes ?? "";
	const id = ID_ATTRIBUTE.exec(attributes)?.groups?.id ?? "";
	return (
		OTHER_PRODUCT_BLOCK.test(classes) ||
		OTHER_PRODUCT_BLOCK.test(id) ||
		OTHER_PRODUCT_BLOCK.test(tag) ||
		VIEWER_OPENED_BLOCK.test(classes)
	);
};

/**
 * The HTML with every other-product block (an upsell or related-products
 * section, ancestors included) and every menu, modal, popover or tooltip
 * cut out whole, so neither the notes scan nor the page text sees another
 * coffee's copy or a viewer-opened one.
 */
const dropBlocks = (html: string): string => {
	const kept: string[] = [];
	let cursor = 0;
	for (const open of html.matchAll(ATTRIBUTED_OPEN_TAG)) {
		if (open.index < cursor || !isDroppedBlock(open)) {
			continue;
		}
		const span = elementSpan(html, open, MAX_DROPPED_BLOCK_LENGTH);
		if (span === null) {
			continue;
		}
		kept.push(html.slice(cursor, open.index), "\n");
		cursor = span.end;
	}
	kept.push(html.slice(cursor));
	return kept.join("");
};

/** The notes of the first real notes element in HTML that dropBlocks has already reduced. */
const themeNotesFromReducedHtml = (html: string): string[] => {
	let tried = 0;
	for (const match of html.matchAll(NOTES_ELEMENT)) {
		if (OTHER_PRODUCT_CLASS.test(match.groups?.classes ?? "")) {
			continue;
		}
		tried += 1;
		if (tried > MAX_NOTES_ELEMENTS) {
			break;
		}
		const inner = elementInnerHtml(html, match);
		// Every child element is its own line: a theme renders one note per
		// span or div, and stripHtml would run inline spans together.
		const notes = splitNotes(
			stripHtml(inner.replaceAll(ANY_TAG, "\n")).replaceAll("\n", ", ")
		).filter((note) => !NOTES_LABEL.test(note));
		if (notes.length > 0) {
			return notes;
		}
	}
	return [];
};

/**
 * The notes a theme's dedicated element carries, one per child element or
 * separator-split item, each through verifyNote; the block's own label
 * ("Tasting Notes") is not a note. An element inside an upsell or
 * related-products block is another coffee's and is never read. Empty when
 * the page has no such element.
 */
export const themeNotesFromHtml = (html: string): string[] =>
	themeNotesFromReducedHtml(dropBlocks(html));

/** The inner HTML of the document's main element, or null when it has none. */
const mainInnerHtml = (html: string): string | null => {
	const open = MAIN_OPEN_TAG.exec(html);
	if (open === null) {
		return null;
	}
	let close: RegExpExecArray | null = null;
	for (const match of html.matchAll(MAIN_CLOSE_TAG)) {
		close = match;
	}
	const bodyStart = open.index + open[0].length;
	return close === null || close.index < bodyStart
		? html.slice(bodyStart)
		: html.slice(bodyStart, close.index);
};

/** Chrome, upsell blocks and menus cut out: the HTML the page read sees. */
const reduceHtml = (html: string): string =>
	dropBlocks(html.replaceAll(CHROME_ELEMENT, "\n"));

/** The reduced HTML a page read scans and the block text it yields. */
interface ReducedPage {
	html: string;
	text: string;
}

/** Main's reduced HTML and text when main carries a page's worth, else the whole document's. */
const reducePage = (html: string): ReducedPage => {
	const main = mainInnerHtml(html);
	if (main !== null) {
		const reduced = reduceHtml(main);
		const text = stripHtml(reduced);
		if (text.length >= MIN_PAGE_TEXT_LENGTH) {
			return { html: reduced, text };
		}
	}
	const reduced = reduceHtml(html);
	return { html: reduced, text: stripHtml(reduced) };
};

/** The alt attribute of an image, in either quote style. */
const IMAGE_ALT =
	/<img\b[^>]*\balt\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/giu;
/** The separators a theme joins an alt's segments with ("... - Process: Washed - Variety: ..."). */
const ALT_SEGMENT_SEPARATOR = /\s+[-|–—•·]\s+/u;
/**
 * A `Label: value` alt segment whose label the page router reads. Nothing
 * else in an alt is a line: "Layered Elegance" and a menu image's list of
 * coffees would otherwise be note candidates.
 */
const ALT_FACT_SEGMENT =
	/^(?<label>(?:tasting|flavou?r|cupping)\s+notes?|notes|process(?:ing)?(?:\s+method)?|variet(?:y|al|als|ies)|cultivar|(?:growing\s+)?region|location|elevation|altitude|producer|farm|farmer|washing\s+station|roast(?:\s+level)?)\s*:\s*(?<value>.+)$/iu;
/** Alt lines one page contributes; Verve's spec line yields four. */
const MAX_ALT_LINES = 8;

/**
 * The labelled facts the images' alt text states, one `Label: value` line
 * each, in page order, deduplicated (ADR-0009). Verve keeps the coffee's
 * whole spec line in its product image alt ("... - Process: Washed -
 * Variety: Pink Bourbon - Tasting Notes: Pear, Nectarine, Brown Sugar -
 * ...") and nowhere in the rendered text. Reads HTML dropBlocks has
 * already reduced, so an upsell card's image is never seen.
 */
const altFactLines = (html: string): string[] => {
	const lines: string[] = [];
	for (const match of html.matchAll(IMAGE_ALT)) {
		const alt = stripHtml(match.groups?.double ?? match.groups?.single ?? "");
		for (const segment of alt.split(ALT_SEGMENT_SEPARATOR)) {
			const fact = ALT_FACT_SEGMENT.exec(segment.trim())?.groups;
			if (fact?.label === undefined || fact.value === undefined) {
				continue;
			}
			const line = `${fact.label}: ${fact.value.trim()}`;
			if (
				lines.length < MAX_ALT_LINES &&
				!lines.some((seen) => seen.toLowerCase() === line.toLowerCase())
			) {
				lines.push(line);
			}
		}
	}
	return lines;
};

/**
 * A product page as the shop serves it, reduced to the block text the page
 * candidate finder reads. The main element is read when the page has one
 * (Shopify themes wrap the product in `<main id="MainContent">`), so a
 * mega-menu built from divs never pushes the description out of Jev's
 * window; the whole document is read when there is no main or main is a
 * shell. Chrome, other-product blocks and menus are cut, then stripHtml.
 * Every roaster checked (ADR-0008) renders its notes server-side, so this
 * is the same text Firecrawl's markdown carries, without the credit. When
 * the theme marks its notes element, those notes open the text as a
 * labelled line, and the labelled facts in the images' alt text follow
 * (ADR-0009), so both lead the candidates instead of trailing the lines
 * that fill the cap. Null for a shell page.
 */
export const pageTextFromHtml = (html: string): string | null => {
	const { html: reduced, text } = reducePage(html);
	if (text.length < MIN_PAGE_TEXT_LENGTH) {
		return null;
	}
	const themeNotes = themeNotesFromReducedHtml(reduced);
	const head = [
		...(themeNotes.length === 0
			? []
			: [`Tasting notes: ${themeNotes.join(", ")}`]),
		...altFactLines(reduced),
	];
	return head.length === 0 ? text : `${head.join("\n")}\n${text}`;
};

/**
 * When the last space before the cap sits this early, the text is one long
 * unbroken token (a URL, a run of dashes) and a word-boundary cut would keep
 * almost nothing; hard-cut at the cap instead.
 */
const MIN_WORD_CUT = 20;

/**
 * Cap at a word boundary so stored copy never ends mid-word. A text exactly
 * at the cap counts as truncated: the clause regexes cap their capture at the
 * same length and cut mid-word.
 */
export const capAtWord = (text: string, maxLength: number): string | null => {
	const trimmed = text.trim();
	if (trimmed === "") {
		return null;
	}
	if (trimmed.length < maxLength) {
		return trimmed;
	}
	const cut = trimmed.lastIndexOf(" ", maxLength - 1);
	return (
		cut < MIN_WORD_CUT ? trimmed.slice(0, maxLength) : trimmed.slice(0, cut)
	).trim();
};

interface TagParts {
	key: string;
	value: string;
}

/** Split a `Key: Value` Shopify tag; a bare tag is all key, empty value. */
const splitTag = (tag: string): TagParts => {
	const colon = tag.indexOf(":");
	if (colon === -1) {
		return { key: tag.trim(), value: "" };
	}
	return {
		key: tag.slice(0, colon).trim(),
		value: tag.slice(colon + 1).trim(),
	};
};

const ORIGIN_TAG = /^(?:origin|from|country)$/iu;
const VARIETY_TAG = /^(?:variet(?:y|al|ies|als)|cultivar)$/iu;
const REGION_TAG = /^region$/iu;
const ELEVATION_TAG = /^(?:elevation|altitude)$/iu;
const PRODUCER_TAG = /^(?:producer|farm|farmer)$/iu;
/**
 * A place name: letters and light punctuation, a few words at most.
 * `From:` is the loosest origin key (Proud Mary), so the value has to look
 * like a place — "From: our friends at the co-op" is not an origin.
 */
const ORIGIN_VALUE = /^[\p{L}][\p{L}\s,.'’()-]*$/u;
const MAX_ORIGIN_WORDS = 4;
const PROCESS_TAG = /^process$/iu;
const ROAST_TAG = /^(?:roast|roast level)$/iu;
const FLAVOR_PROFILE_TAG = /^flavor profile$/iu;

const looksLikeOrigin = (value: string): boolean =>
	ORIGIN_VALUE.test(value) && value.split(/\s+/u).length <= MAX_ORIGIN_WORDS;

/**
 * Producing countries, canonical spelling. Free text (a title, a bare tag, a
 * body line, the vendor) yields an origin only when it names one of these;
 * a keyed `From:` tag is the roaster's own value and skips the list. Regions
 * (Huila, Yirgacheffe) are not origins: 694 of the 696 origins stored before
 * #30 were a country, and the lot page labels the field "Origin".
 */
const COUNTRIES = [
	"Bolivia",
	"Brazil",
	"Burundi",
	"Cameroon",
	"China",
	"Colombia",
	"Congo",
	"Costa Rica",
	"Cuba",
	"Dominican Republic",
	"Ecuador",
	"El Salvador",
	"Ethiopia",
	"Guatemala",
	"Haiti",
	"Hawaii",
	"Honduras",
	"India",
	"Indonesia",
	"Jamaica",
	"Kenya",
	"Laos",
	"Malawi",
	"Mexico",
	"Myanmar",
	"Nepal",
	"Nicaragua",
	"Panama",
	"Papua New Guinea",
	"Peru",
	"Philippines",
	"Puerto Rico",
	"Rwanda",
	"Tanzania",
	"Thailand",
	"Timor",
	"Uganda",
	"Venezuela",
	"Vietnam",
	"Yemen",
	"Zambia",
	"Zimbabwe",
] as const;

/** Other spellings and the Indonesian islands sold under their own name. */
const COUNTRY_ALIASES: Record<string, (typeof COUNTRIES)[number]> = {
	"democratic republic of congo": "Congo",
	"democratic republic of the congo": "Congo",
	dominican: "Dominican Republic",
	"dr congo": "Congo",
	"east timor": "Timor",
	png: "Papua New Guinea",
	sulawesi: "Indonesia",
	sumatra: "Indonesia",
	"timor leste": "Timor",
};

const CANONICAL_COUNTRY = new Map<string, string>([
	...COUNTRIES.map((name): [string, string] => [name.toLowerCase(), name]),
	...Object.entries(COUNTRY_ALIASES),
]);

const escapeRegExp = (text: string): string =>
	text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

// Multi-word names first so "Dominican Republic" wins over "Dominican".
const COUNTRY_KEYS = [...CANONICAL_COUNTRY.keys()];
const COUNTRY_NAME = new RegExp(
	`\\b(?:${[
		...COUNTRY_KEYS.filter((name) => name.includes(" ")),
		...COUNTRY_KEYS.filter((name) => !name.includes(" ")),
	]
		.map((name) => escapeRegExp(name).replaceAll(" ", "\\s+"))
		.join("|")})\\b`,
	"giu"
);

/** Hyphens and underscores read as spaces: `El-Salvador`, `origin__costa-rica`. */
const unslug = (text: string): string =>
	text.replaceAll(/[_-]+/gu, " ").replaceAll(/\s+/gu, " ").trim();

interface CountryMatch {
	name: string;
	start: number;
	end: number;
}

const matchCountries = (text: string): CountryMatch[] => {
	const found: CountryMatch[] = [];
	for (const match of text.matchAll(COUNTRY_NAME)) {
		const name = CANONICAL_COUNTRY.get(
			match[0].toLowerCase().replaceAll(/\s+/gu, " ")
		);
		if (name !== undefined && !found.some((seen) => seen.name === name)) {
			found.push({
				end: match.index + match[0].length,
				name,
				start: match.index,
			});
		}
	}
	return found;
};

/** Every country the text names, canonical spelling, in order, distinct. */
const findCountries = (text: string): string[] =>
	matchCountries(unslug(text)).map((match) => match.name);

/**
 * The one country a title names. Farms borrow country names (Intelligentsia
 * "Costa Rica El Congo Geisha", Sey "Finca Costa Rica - Colombia") and a
 * variety can carry one ("Guatemala Ethiopia Landrace"), so when a title
 * names two the coffee's own country is the one that opens the title, else
 * the one that closes it.
 */
const titleCountry = (title: string): string[] => {
	const text = unslug(title);
	const matches = matchCountries(text);
	if (matches.length <= 1) {
		return matches.map((match) => match.name);
	}
	const opens = matches.find((match) => match.start === 0);
	const closes = matches.find((match) => match.end === text.length);
	return [(opens ?? closes ?? matches[0]).name];
};

/**
 * The closed process vocabulary, with the qualifiers roasters attach to it
 * ("Anaerobic Washed", "Fully washed", "Black Honey", "Wet-Hulled"). An
 * optional lead qualifier is greedy, so "Anaerobic Natural" is one term.
 */
const PROCESS_TERM =
	/\b(?:(?:fully|semi|double|extended|anaerobic|carbonic|natural|lactic|thermal)[\s-]+)?(?:washed|natural|honey|anaerobic|carbonic\s+maceration|thermal[\s-]shock|wet[\s-]hulled|pulped\s+natural|(?:white|red|black|yellow|gold(?:en)?)\s+honey|co-?ferment(?:ed|ation)?|swiss\s+water(?:\s+(?:process|decaf))?|sugar\s?cane(?:\s+(?:process|decaf))?|mountain\s+water(?:\s+(?:process|decaf))?|ea\s+decaf|giling\s+basah|wet[\s-]process(?:ed)?|dry[\s-]process(?:ed)?)\b/giu;

/** A bare tag that is a process term, with or without the word process. */
const BARE_PROCESS_TAG = new RegExp(
	`^${PROCESS_TERM.source.slice(2)}(?:[\\s-]process(?:ed|ing)?)?$`,
	"iu"
);

/** Every process term the text names, roaster's casing, distinct. */
const findProcesses = (text: string): string[] => {
	const found: string[] = [];
	for (const match of text.matchAll(PROCESS_TERM)) {
		const term = match[0].replaceAll(/\s+/gu, " ");
		if (!found.some((seen) => seen.toLowerCase() === term.toLowerCase())) {
			found.push(term);
		}
	}
	return found;
};

/**
 * Anchored: "Light", "Medium-Light", "Light Roast", "Medium-light Roast";
 * not "Lightly sweet", "Comforting", "Bright". Nothing else is a roast level.
 */
const ROAST_VALUE =
	/^(?<level>light|medium|dark)(?:[\s-](?<shade>light|medium|dark))?(?<roast>[\s-]roast)?$/iu;
/** In a title the word roast is required: "Dark Chocolate Blend" is a note. */
const ROAST_IN_TITLE =
	/\b(?:light|medium|dark)(?:[\s-](?:light|medium|dark))?[\s-]roast\b/iu;

const capitalize = (word: string): string =>
	word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** A roast slug (`medium-light-roast`) in display form: "Medium-Light Roast". */
const roastFromSlug = (slug: string): string | undefined => {
	const groups = ROAST_VALUE.exec(unslug(slug))?.groups;
	if (groups?.level === undefined) {
		return undefined;
	}
	const shade =
		groups.shade === undefined ? "" : `-${capitalize(groups.shade)}`;
	const roast = groups.roast === undefined ? "" : " Roast";
	return `${capitalize(groups.level)}${shade}${roast}`;
};

const roastFromValue = (value: string): string[] =>
	ROAST_VALUE.test(value.trim()) ? [value.trim()] : [];

/** Counter Culture's `key__value` tags: `origin__colombia`, `roastlevel__dark-roast`. */
const SLUG_TAG = /^(?<key>[a-z]+)__(?<value>.+)$/iu;
const SLUG_ORIGIN_KEY = /^(?:origin|country)$/iu;
const SLUG_PROCESS_KEY = /^process$/iu;
const SLUG_ROAST_KEY = /^roast(?:level)?$/iu;

/** `Key: Value` body lines. `From:` is left out: in prose it opens a sentence. */
const BODY_LINE = /^(?<key>[\p{L}][\p{L} /]{0,24}?)\s*:\s*(?<value>.+)$/u;
const BODY_ORIGIN_KEY = /^(?:origins?|countr(?:y|ies))$/iu;
const BODY_PROCESS_KEY = /^process(?:ing)?(?:\s+method)?$/iu;
const BODY_ROAST_KEY = /^roast(?:\s+level)?$/iu;
const BODY_VARIETY_KEY = /^(?:variet(?:y|al|ies|als)|cultivar)$/iu;
/** Heart writes `Location: Gedeb`; the value is the region. */
const BODY_REGION_KEY = /^(?:region|location)$/iu;
const BODY_ELEVATION_KEY = /^(?:elevation|altitude)$/iu;
const BODY_PRODUCER_KEY = /^(?:producer|farm|farmer)$/iu;
/** East Pole's table: an all-caps header line, the value on the next line. */
const TABLE_ORIGIN_HEADER = /^(?:ORIGIN|COUNTRY)$/u;
const TABLE_PROCESS_HEADER = /^PROCESS$/u;
const TABLE_ROAST_HEADER = /^ROAST(?: LEVEL)?$/u;
const TABLE_VARIETY_HEADER = /^(?:VARIETY|VARIETAL|CULTIVAR)$/u;
const TABLE_REGION_HEADER = /^(?:REGION|LOCATION)$/u;
const TABLE_ELEVATION_HEADER = /^(?:ELEVATION|ALTITUDE)$/u;
const TABLE_PRODUCER_HEADER = /^(?:PRODUCER|FARM)$/u;
/** Body lines past this are prose; the sheet sits at the top. */
const MAX_BODY_LINES = 80;

export interface LotAttributes {
	elevation?: string;
	origin?: string;
	process?: string;
	producer?: string;
	region?: string;
	roastLevel?: string;
	variety?: string;
}

export interface LotAttributeSource {
	tags: string[];
	title?: string | null;
	/** The roaster's copy as block text (stripHtml), one block per line. */
	blockText?: string | null;
	/** Shopify vendor; some roasters put the farm's region and country here. */
	vendor?: string | null;
}

/**
 * Candidates for one field by tier, in precedence order. The first tier
 * with a value wins; origin and process keep every distinct value in it.
 */
interface Tiers {
	keyed: string[];
	slug: string[];
	bare: string[];
	title: string[];
	body: string[];
	vendor: string[];
}

const emptyTiers = (): Tiers => ({
	bare: [],
	body: [],
	keyed: [],
	slug: [],
	title: [],
	vendor: [],
});

const push = (into: string[], values: string[]): void => {
	for (const value of values) {
		if (!into.some((seen) => seen.toLowerCase() === value.toLowerCase())) {
			into.push(value);
		}
	}
};

const resolve = (tiers: Tiers, multi: boolean): string | undefined => {
	for (const tier of [
		tiers.keyed,
		tiers.slug,
		tiers.bare,
		tiers.title,
		tiers.body,
		tiers.vendor,
	]) {
		if (tier.length > 0) {
			// One roast level; a value with the word roast ("dark roast") is
			// surer than a bare level ("dark") next to it.
			return multi
				? tier.join(", ")
				: (tier.find((value) => /\broast\b/iu.test(value)) ?? tier[0]);
		}
	}
	return undefined;
};

/** Every fact field the feed path reads, each with its own tiers. */
type FactField =
	| "elevation"
	| "origin"
	| "process"
	| "producer"
	| "region"
	| "roast"
	| "variety";
type Fields = Record<FactField, Tiers>;

const emptyFields = (): Fields => ({
	elevation: emptyTiers(),
	origin: emptyTiers(),
	process: emptyTiers(),
	producer: emptyTiers(),
	region: emptyTiers(),
	roast: emptyTiers(),
	variety: emptyTiers(),
});

const single = (verified: string | null): string[] =>
	verified === null ? [] : [verified];

/** A keyed value (`Key: Value` tag or body line) into the tier it belongs to. */
const readKeyed = (
	fields: Fields,
	tier: "keyed" | "body",
	key: string,
	value: string
): void => {
	if (tier === "keyed" ? ORIGIN_TAG.test(key) : BODY_ORIGIN_KEY.test(key)) {
		// A keyed tag carries the roaster's own value; a body line is prose
		// and passes the country list.
		if (tier === "body") {
			push(fields.origin.body, findCountries(value));
		} else if (looksLikeOrigin(value)) {
			push(fields.origin.keyed, [value]);
		}
	} else if (
		tier === "keyed" ? PROCESS_TAG.test(key) : BODY_PROCESS_KEY.test(key)
	) {
		// The roaster's own vocabulary ("Culture-Innoculated Washed") stands in
		// a tag; body prose passes the term list.
		push(
			fields.process[tier],
			tier === "keyed" ? [value] : findProcesses(value)
		);
	} else if (
		tier === "keyed" ? ROAST_TAG.test(key) : BODY_ROAST_KEY.test(key)
	) {
		push(fields.roast[tier], roastFromValue(value));
	} else if (
		tier === "keyed" ? VARIETY_TAG.test(key) : BODY_VARIETY_KEY.test(key)
	) {
		push(fields.variety[tier], single(verifyVariety(value)));
	} else if (
		tier === "keyed" ? REGION_TAG.test(key) : BODY_REGION_KEY.test(key)
	) {
		push(fields.region[tier], single(verifyRegion(value)));
	} else if (
		tier === "keyed" ? ELEVATION_TAG.test(key) : BODY_ELEVATION_KEY.test(key)
	) {
		push(fields.elevation[tier], single(verifyElevation(value)));
	} else if (
		tier === "keyed" ? PRODUCER_TAG.test(key) : BODY_PRODUCER_KEY.test(key)
	) {
		push(fields.producer[tier], single(verifyProducer(value)));
	}
};

const readTags = (tags: string[], fields: Fields): void => {
	for (const tag of tags) {
		const slug = SLUG_TAG.exec(tag)?.groups;
		if (slug?.key !== undefined && slug.value !== undefined) {
			if (SLUG_ORIGIN_KEY.test(slug.key)) {
				push(fields.origin.slug, findCountries(slug.value));
			} else if (SLUG_PROCESS_KEY.test(slug.key)) {
				push(fields.process.slug, findProcesses(unslug(slug.value)));
			} else if (SLUG_ROAST_KEY.test(slug.key)) {
				const level = roastFromSlug(slug.value);
				push(fields.roast.slug, level === undefined ? [] : [level]);
			}
			continue;
		}
		const { key, value } = splitTag(tag);
		if (value === "") {
			push(fields.origin.bare, findCountries(key));
			if (BARE_PROCESS_TAG.test(key)) {
				push(fields.process.bare, findProcesses(key));
			}
			push(fields.roast.bare, roastFromValue(key));
		} else {
			readKeyed(fields, "keyed", key, value);
		}
	}
};

/** A line that is itself a table header, never a value: `AMOUNT`, `ROAST LEVEL`. */
const TABLE_HEADER_LINE = /^[A-Z][A-Z ]{1,24}$/u;

/**
 * An all-caps table header line (East Pole) into its field, value on the
 * next line. Two headers in a row (`PRODUCER` / `AMOUNT`, a two-column
 * layout) yield nothing: the next line is not this header's value.
 */
const readTableRow = (
	fields: Fields,
	header: string,
	next: string
): boolean => {
	if (TABLE_HEADER_LINE.test(next)) {
		return TABLE_HEADER_LINE.test(header);
	}
	if (TABLE_ORIGIN_HEADER.test(header)) {
		push(fields.origin.body, findCountries(next));
	} else if (TABLE_PROCESS_HEADER.test(header)) {
		push(fields.process.body, findProcesses(next));
	} else if (TABLE_ROAST_HEADER.test(header)) {
		push(fields.roast.body, roastFromValue(next));
	} else if (TABLE_VARIETY_HEADER.test(header)) {
		push(fields.variety.body, single(verifyVariety(next)));
	} else if (TABLE_REGION_HEADER.test(header)) {
		push(fields.region.body, single(verifyRegion(next)));
	} else if (TABLE_ELEVATION_HEADER.test(header)) {
		push(fields.elevation.body, single(verifyElevation(next)));
	} else if (TABLE_PRODUCER_HEADER.test(header)) {
		push(fields.producer.body, single(verifyProducer(next)));
	} else {
		return false;
	}
	return true;
};

const readBody = (blockText: string, fields: Fields): void => {
	const lines = blockText
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(0, MAX_BODY_LINES);
	for (const [index, line] of lines.entries()) {
		const next = lines[index + 1] ?? "";
		const labelled = BODY_LINE.exec(line)?.groups;
		if (labelled?.key !== undefined && labelled.value !== undefined) {
			readKeyed(fields, "body", labelled.key, labelled.value);
		} else if (!readTableRow(fields, line, next)) {
			// Ruby: "Light Roast" stands alone on its own line.
			push(fields.roast.body, roastFromValue(line));
		}
	}
};

/**
 * Origin, process and roast level from everything the feed says about a lot
 * (#30), plus variety, region, elevation and producer where the roaster
 * labels them (ADR-0005). Per field, the first tier with a value wins: a
 * `Key: Value` tag (Proud Mary `From: Ethiopia`, Intelligentsia `Country:
 * Guatemala`, Verve `Roast: Light`, Onyx `origin:Ethiopia`), a `key__value`
 * tag (Counter Culture `origin__colombia`), a bare tag (Ruby `Washed`,
 * Blossom `Mexico`), the title ("Kenya Karumandi", "Kerehaklu - Washed
 * Process"), a body label line or all-caps table (Heart `Process: Fully
 * washed`, `Location: Gedeb`, `Varietals: Heirloom`; East Pole `PROCESS` /
 * `Washed`, `ALTITUDE` / `1900m`), then the vendor for origin only (Regalia
 * "Huila, Colombia").
 *
 * Keyed origin and process tags carry the roaster's own value. Everything
 * else passes a shape check first: a country from COUNTRIES, a term from
 * PROCESS_TERM, the anchored ROAST_VALUE, or the lotFacts shapes for the
 * rest, so Intelligentsia's "Roast Level: Bright" (taste, not roast) and
 * Merit's "recommended use: Espresso" land nowhere. Origin and process keep
 * every distinct value in the winning tier, joined with a comma (Proud Mary
 * "Humbler Blend": `Brazil, Honduras`).
 */
export const parseLotAttributes = (
	source: LotAttributeSource
): LotAttributes => {
	const fields = emptyFields();
	readTags(source.tags, fields);
	const title = source.title ?? "";
	push(fields.origin.title, titleCountry(title));
	push(fields.process.title, findProcesses(title));
	const titleRoast = ROAST_IN_TITLE.exec(title)?.[0];
	push(fields.roast.title, titleRoast === undefined ? [] : [titleRoast]);
	readBody(source.blockText ?? "", fields);
	push(fields.origin.vendor, findCountries(source.vendor ?? ""));

	const attributes: LotAttributes = {};
	const resolved: [keyof LotAttributes, string | undefined][] = [
		["origin", resolve(fields.origin, true)],
		["process", resolve(fields.process, true)],
		["roastLevel", resolve(fields.roast, false)],
		["variety", resolve(fields.variety, false)],
		["region", resolve(fields.region, false)],
		["elevation", resolve(fields.elevation, false)],
		["producer", resolve(fields.producer, false)],
	];
	for (const [key, value] of resolved) {
		if (value !== undefined) {
			attributes[key] = value;
		}
	}
	return attributes;
};

/**
 * Trailing connectives left behind when a clause capture stops at a block
 * boundary: ", and", " &", " -", and bare punctuation or whitespace.
 */
const TRIM_TAIL = /(?:\s+and|[\s,&-])+$/iu;

/** Anything after the last letter, digit or closing paren: " .", " 🌑", "," */
const NON_WORD_TAIL = /[^\p{L}\p{N})]+$/u;

/**
 * Descriptor-clause patterns over the roaster's prose, tried in order. Each
 * captures `clause`; the lead-in words are anchored on a word boundary so
 * "Footnotes of the harvest" is not a `notes of` match.
 */
const NOTES_PATTERNS: readonly { needsList: boolean; pattern: RegExp }[] = [
	// A labelled field line ("Tasting Notes: a, b, & c", "Notes: a, b, c") at
	// the start of a block, the way Proud Mary and PT's write every product.
	// It is the roaster's structured field, so it comes before the prose
	// lead-ins: the same copy often mentions "notes of" later in the story.
	// "Brewing notes:" is guidance, not descriptors; the label must open the
	// line. The value may sit on the next line (a <br> inside the label), but
	// a next line that is itself a "Label:" field means the notes are empty.
	// A same-line value keeps a colon inside it ("caramel (12 oz: whole
	// bean)"); only a value that opens with its own "Label:" ("Espresso:
	// 1:2.5") is rejected. A number with a unit ("86 points") is a score.
	{
		needsList: false,
		pattern:
			/^(?:(?:tasting|flavou?r|cup(?:ping)?) )?notes?[^\S\n]*:[^\S\n]*(?:\n[^\S\n]*(?![^\n]{0,40}:)|(?!\p{L}[\p{L} '’/-]{0,30}:))(?<clause>(?!\s)(?!\d[\d.,]*\s*\p{L}+[^\S\n]*$)[^\n]{3,200})/imu,
	},
	// Ruby lists descriptors dash-separated in their own block; the newline
	// (not the boilerplate that follows) ends the capture. Blossom writes the
	// same lead-in as prose, which boundProse() cuts at the sentence end.
	{
		needsList: true,
		pattern: /\bwe\s+taste\b:?\s*(?<clause>[^\n]{5,200})/iu,
	},
	{
		needsList: false,
		pattern:
			/\bin\s+the\s+cup,?\s+we\s+(?:find|taste|get)\s+(?<clause>[^.!?\n]{5,200})/iu,
	},
	{
		needsList: false,
		pattern:
			/\b(?:tasting\s+)?notes\s+of\s+(?<clause>[^\u2014\u2013.!?\n]{5,160})/iu,
	},
	{
		needsList: false,
		pattern: /\bflavors\s+of\s+(?<clause>[^\u2014\u2013.!?\n]{5,160})/iu,
	},
	// Sey varies the subject ("In this cup we find", "In this year's cup we
	// find", "In this Red Gesha separation we find"); "we find" is also
	// prose ("the best coffees we find anywhere"), so a list is required and
	// a clause that opens with a function word ("we find that this coffee,
	// grown at 1900m, is") is narrative. It sits after the "notes of" family
	// so a real "notes of" list later in the same copy wins.
	{
		needsList: true,
		pattern:
			/\bwe\s+find\s+(?!(?:that|this|it|the|these|those|our|ourselves)\b)(?<clause>[^.!?\n]{5,200})/iu,
	},
];

/** A `we taste` line without Ruby's ` - ` separators is prose: stop at the sentence end. */
const boundProse = (clause: string): string =>
	clause.includes(" - ") ? clause : (clause.split(/\s*[.!?]/u)[0] ?? clause);

/**
 * "we taste" is also ordinary prose (Sey: "one of the most dynamic we taste
 * each season"), so its clause has to read as a list of at least two items
 * before it counts; otherwise the later patterns get their turn.
 */
const LOOKS_LIKE_LIST = /,|\s(?:and|&|-)\s/iu;

/**
 * Cut the prose that rides after a descriptor list: "..., and berries,
 * Gradient is the perfect choice" keeps "berries". The list's final item
 * starts at the last Oxford conjunction (", and C" / ", & C"), else at the
 * bare "and"; after that point, a comma followed by a clause-starting word
 * or a capitalised subject ends the list. A bare "and" can sit inside an
 * item ("intense and complex profile of ..."), and a capitalised item can
 * precede the conjunction ("rose, Meyer lemon, and bergamot"), so the
 * capital-letter test only runs after a conjunction. With no conjunction at
 * all, only the clause words cut, so a Title Case list stays whole.
 */
const OXFORD_CONJUNCTION = /,\s*(?:and|&)\s+/giu;
const BARE_CONJUNCTION = /\s+(?:and|&)\s+/iu;
const CLAUSE_WORDS =
	"this|these|that|it|making|reflecting|creating|resulting|giving|offering|leaving|while|which|ideal|perfect";
const CLAUSE_AFTER_COMMA = new RegExp(`,\\s*(?:${CLAUSE_WORDS})\\b`, "iu");
// Case-sensitive on purpose: under the `i` flag \p{Lu} matches every letter.
const SUBJECT_AFTER_COMMA = /,\s*\p{Lu}/u;

const firstSeam = (text: string, patterns: RegExp[]): number | null => {
	const indexes = patterns
		.map((pattern) => pattern.exec(text)?.index)
		.filter((index): index is number => index !== undefined);
	return indexes.length === 0 ? null : Math.min(...indexes);
};

/** Where the list's final item starts: after the last Oxford conjunction, else the bare one. */
const finalItemStart = (clause: string): number | null => {
	let start: number | null = null;
	for (const match of clause.matchAll(OXFORD_CONJUNCTION)) {
		start = match.index + match[0].length;
	}
	if (start !== null) {
		return start;
	}
	const bare = BARE_CONJUNCTION.exec(clause);
	return bare === null ? null : bare.index + bare[0].length;
};

const cutAfterList = (clause: string): string => {
	const tailStart = finalItemStart(clause);
	if (tailStart === null) {
		const seam = CLAUSE_AFTER_COMMA.exec(clause);
		return seam === null ? clause : clause.slice(0, seam.index);
	}
	const seam = firstSeam(clause.slice(tailStart), [
		CLAUSE_AFTER_COMMA,
		SUBJECT_AFTER_COMMA,
	]);
	return seam === null ? clause : clause.slice(0, tailStart + seam);
};

/**
 * Merit (and others) open the copy with the notes as a separator list in
 * its own block: "Prunes • Fig Danish • Nutmeg". Three to six short items
 * on the first line; two could as easily be an origin ("Ethiopia • Guji").
 */
const BULLET_SEPARATOR = /\s+[•·|]\s+/u;
const BULLET_ITEM = /^[\p{L}][\p{L}\s'’-]{0,29}$/u;
const MAX_BULLET_ITEM_WORDS = 3;

const matchBulletLine = (description: string): string | null => {
	const firstLine = description.split("\n")[0]?.trim() ?? "";
	const items = firstLine.split(BULLET_SEPARATOR);
	const isList =
		items.length >= 3 &&
		items.length <= 6 &&
		items.every(
			(item) =>
				BULLET_ITEM.test(item) &&
				item.split(/\s+/u).length <= MAX_BULLET_ITEM_WORDS
		);
	return isList ? firstLine : null;
};

const matchClause = (description: string): string | null => {
	const bulletLine = matchBulletLine(description);
	if (bulletLine !== null) {
		return bulletLine;
	}
	for (const { needsList, pattern } of NOTES_PATTERNS) {
		const raw = pattern.exec(description)?.groups?.clause;
		if (raw === undefined) {
			continue;
		}
		const clause = cutAfterList(boundProse(raw))
			.replace(TRIM_TAIL, "")
			.replace(NON_WORD_TAIL, "")
			.trim();
		if (clause === "") {
			continue;
		}
		if (needsList && !LOOKS_LIKE_LIST.test(clause)) {
			continue;
		}
		return clause;
	}
	return null;
};

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
	const matched = matchClause(description);
	if (matched !== null) {
		return capAtWord(matched, ROASTER_NOTES_MAX_LENGTH);
	}
	// Intelligentsia puts descriptors in a structured tag when the prose has
	// none ("Flavor Profile: Caramel + Stone Fruit").
	for (const tag of tags) {
		const { key, value } = splitTag(tag);
		if (FLAVOR_PROFILE_TAG.test(key) && value !== "") {
			return capAtWord(value, ROASTER_NOTES_MAX_LENGTH);
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

/** The `www.` form of a shop origin, or null when the host already has it. */
export const wwwOrigin = (websiteUrl: string): string | null => {
	const url = new URL(websiteUrl);
	if (url.hostname.startsWith("www.")) {
		return null;
	}
	url.hostname = `www.${url.hostname}`;
	return url.origin;
};

export interface FeedPageResponse {
	/** HTTP status, or 0 when the request itself failed. */
	status: number;
	/** Body text, or null when the page is unavailable. */
	text: string | null;
}

export interface FirstFeedPageInput {
	fetchPage: (url: string) => Promise<FeedPageResponse>;
	websiteUrl: string;
}

export interface FirstFeedPageResult {
	text: string | null;
	/** The origin that answered; later pages and the market check use it. */
	websiteUrl: string;
}

/**
 * Fetch page 1 of the feed. A headless storefront can leave the apex with no
 * products.json while the Shopify shop lives on `www.` (Passenger: apex 404,
 * `www.drinkpassenger.com` a full feed), so an apex 404 earns one retry on
 * `www.`. Any other failure returns as-is for the Firecrawl fallback.
 */
export const fetchFirstFeedPage = async (
	input: FirstFeedPageInput
): Promise<FirstFeedPageResult> => {
	const first = await input.fetchPage(shopifyProductsUrl(input.websiteUrl));
	if (first.status !== 404) {
		return { text: first.text, websiteUrl: input.websiteUrl };
	}
	const www = wwwOrigin(input.websiteUrl);
	if (www === null) {
		return { text: null, websiteUrl: input.websiteUrl };
	}
	const retry = await input.fetchPage(shopifyProductsUrl(www));
	if (retry.text === null) {
		return { text: null, websiteUrl: input.websiteUrl };
	}
	return { text: retry.text, websiteUrl: www };
};

/**
 * A product_type or title that says wholesale: Ruby "Wholesale Coffee",
 * "Ethiopia Reko - Wholesale"; Madcap "Karinga (WS)". `wholesale` has no
 * trailing boundary on purpose (Ruby's "- WholesaleMerch"), so it also takes
 * a title like "Retail & Wholesale Blend"; none of the seed feeds has one.
 */
const WHOLESALE_TEXT = /\bwholesale|\bws\b|\bcafes?\s+only\b/iu;

/**
 * Tags whose whole value marks a wholesale-only or cafe-only SKU. Exact match
 * on purpose: Sweet Bloom tags every retail coffee `wholesale-coffee`, Merit
 * `Normal Wholesale`, Heart and Blossom a bare `wholesale`, all meaning "also
 * sold wholesale". The substring rule this replaces hid 48 of Sweet Bloom's
 * 53 coffees.
 */
const WHOLESALE_TAG_VALUE =
	/^(?:wholesale[\s-]only|hide[\s-]from[\s-]retail|cafe[\s-]only)$/iu;

/**
 * Some feeds mix wholesale-only SKUs (Madcap, Ruby, Onyx's cafe-only lots).
 * They are not customer-purchasable lots, so they never enter the catalog.
 */
export const isWholesale = (
	productType: string | null | undefined,
	tags: string[] | string | null | undefined,
	title?: string | null,
	vendor?: string | null
): boolean => {
	// Merit publishes each coffee once per sales channel and names the
	// channel in `vendor` ("Ecommerce", "Merit", "Wholesale"). Only the
	// wholesale word counts: La Colombe puts cafes there, Regalia the
	// origin, Sightglass the producer.
	if (
		WHOLESALE_TEXT.test(productType ?? "") ||
		WHOLESALE_TEXT.test(title ?? "") ||
		WHOLESALE_TEXT.test(vendor ?? "")
	) {
		return true;
	}
	// Tags arrive as an array from /products.json but as a comma-separated
	// string from other Shopify surfaces; both must hit the filter.
	return parseTags(tags).some((tag) => WHOLESALE_TAG_VALUE.test(tag));
};

// ---------------------------------------------------------------------------
// Lot classifier (build spec §16). A lot is one roasted coffee; everything
// else a shop sells is a non-lot and never enters the catalog. Every pattern
// below was drawn from the 20 seed feeds sampled 2026-09-10; the test file
// carries the real titles that motivated each one.
// ---------------------------------------------------------------------------

/**
 * Title words that mean "not one roasted coffee" whatever the type says:
 * subscriptions and memberships, bundles and samplers, capsules and pods,
 * count-packs ("12 Pack", "6pk": cans or sachets), bulk and add-on SKUs,
 * test products. A bare "pack" is not enough: bundles carry a `bundle` tag.
 * Counter Culture files gift subscriptions under `Coffee`; Coava lists
 * "Kilenso (Subscription)" next to "Kilenso". No `cold brew` here: Blossom
 * sells a whole-bean "Cold Brew Blend" typed `Coffee` (12 oz to 5 lb bags);
 * the drinkable kind is caught by its type, an RTD tag, a count-pack, or
 * NON_LOT_RTD_TITLE.
 */
const NON_LOT_FORMAT_TITLE =
	/\b(?:gift\s*cards?|e-?gift|subscriptions?|prepaid|memberships?|bundles?|samplers?|samples?|tester|tasting\s+set|sets?|gift\s+box(?:es)?|box(?:es)?|variety\s+packs?|filter\s+packs?|\d+\s*-?\s*(?:pk|packs?)|trio|duo|k-?cups?|capsules?|pods?|nespresso|lattes?|ready[\s-]to[\s-]drink|rtd|concentrate|flash[\s-]chilled|bulk|quick\s+order|monthly|weekly|recurring|installments?|add[\s-]on|test\s+(?:product|coffee)|do\s+not\s+buy)\b/iu;

/**
 * A title that names the drinkable container, whatever the type says:
 * stubbies, nitro, kegs, canned or bottled, "4 Cans", "12oz Can". A bare
 * `can` or `bottle` is not enough; roasters do sell beans in tins.
 */
const NON_LOT_RTD_TITLE =
	/\b(?:stubbies|nitro|kegs?|canned|bottled|\d+\s*(?:fl\.?\s*)?oz\.?\s+cans?|\d+\s*(?:cans?|bottles?)|cans?\s+of|on\s+tap)\b/iu;

/**
 * Hard goods in the title, applied whatever the type says: Proud Mary files a
 * Comandante grinder under `coffee-archive`. Only nouns that never name a
 * coffee. `filters` is plural on purpose: Proud Mary's coffee titles end in
 * "| Filter" (the brew method). Brewer brands (AeroPress, Chemex) are not
 * here: "Aeropress Championship Blend" is a coffee, so they only count on
 * untyped items (NON_LOT_UNTYPED_TITLE). `water` is brewing water (JBC
 * sells Third Wave Water under Coffee) unless it is the Swiss Water or
 * Mountain Water decaf process.
 */
const NON_LOT_GOODS_TITLE =
	/\b(?:(?<!(?:swiss|mountain)\s)water|mugs?|tees?|t-?shirts?|shirts?|hoodies?|sweatshirts?|crewnecks?|beanies?|snapbacks?|caps?|hats?|totes?|stickers?|scales?|grinders?|kettles?|drippers?|tampers?|canisters?|tumblers?|koozies?|socks|aprons?|candles?|posters?|drinkware|apparel|merch(?:andise)?|equipment|gear|filters)\b/iu;

/**
 * Title words that settle an untyped item as a non-lot on their own: other
 * drinks and consumables (tea, matcha, syrup), books ("The Physics of
 * Espresso", "World Atlas of Coffee"), brewers, and cold brew (untyped,
 * "Cold Brew Coffee 32oz" is a bottle far more often than a bag). Checked
 * only when nothing typed the item, so a `Coffee`-typed "Cold Brew Blend"
 * still lands. Beats a place word too: "Kenya Black Tea" is tea.
 */
const NON_LOT_UNTYPED_TITLE =
	/\b(?:teas?|matcha|syrup|cascara|physics|atlas|books?|cold\s+brew|aeropress|chemex|french\s+press|v60|kalita|hario|brewers?)\b/iu;

/**
 * Title words an untyped non-lot and an untyped coffee share: `honey` is a
 * jar (Ruby "Bird And The Bees Honey") or a process ("Las Lajas Black
 * Honey"), `cup` is drinkware or "Cup of Excellence", `chocolate` a bar or a
 * flavor. A place or craft word in the same title (LOT_TITLE_PLACE,
 * LOT_TITLE_CRAFT) says coffee; otherwise the item is a non-lot.
 */
const NON_LOT_AMBIGUOUS_TITLE = /\b(?:chocolate|honey|cups?)\b/iu;

/**
 * A tag whose whole value names a non-lot. Exact match, not substring:
 * Stumptown's real coffees carry "Filter: Subscription Eligible" while its
 * subscription SKUs carry "Coffee Type: Subscription Only". `Shopify
 * Collective` marks dropshipped third-party goods; `white-label` marks
 * Onyx's contract roasts for other brands.
 */
const NON_LOT_TAG_VALUE =
	/^(?:subscription\s+only|gift\s+subscriptions?|bundles?|gift\s+sets?|variety\s+packs?|white-?label|shopify\s+collective|internalsupplies|equipment|merch(?:andise)?|apparel|drinkware|teaware|accessories|gear|rtd)$/iu;

/**
 * A `Key: Value` tag whose value is the word subscription names a
 * subscription product (Intelligentsia "Badge: Rotating Subscription"). The
 * bare tag is only eligibility (see NON_LOT_WEAK_TAG_VALUE), and a
 * subscription key with another value ("Subscription: Enabled") says nothing.
 */
const NON_LOT_KEYED_SUBSCRIPTION = /^(?:rotating\s+)?subscriptions?$/iu;

/**
 * Like NON_LOT_TAG_VALUE, but only trusted when nothing typed the item. A
 * bare `subscription` or `recharge` tag marks a coffee as subscription-
 * eligible on Counter Culture, Madcap, Heart and Sightglass; on Sey's
 * untyped "2lb Decaffeinated" SKUs it marks the subscription itself.
 */
const NON_LOT_WEAK_TAG_VALUE =
	/^(?:subscriptions?|recharge|gifts?|teas?|collectibles?|tour|education|equip-access|cafe-supplies|single-use)$/iu;

/**
 * A product_type segment that is a non-lot. Runs before the coffee match so
 * "Coffee Grinder" is a grinder and "Lattes + Cold Coffee" is a latte.
 * `brew(?:ing|ers?)` leaves Coava's "Brewed Coffee" (their whole-bean type)
 * alone.
 */
const NON_LOT_TYPE =
	/\b(?:equipment|gear|brew(?:ing|ers?)|scales?|grinders?|kettles?|filters?|accessor(?:y|ies)|merch(?:andise)?|apparel|drinkware|wares?|warehouse|mugs?|tees?|t-?shirts?|gifts?|cards?|subscriptions?|clubs?|bundles?|sets?|box(?:es)?|teas?|chocolate|food|rtd|cold\s+brew|lattes?|alt\s+beverage|supplies|collateral|packaging|signage|events?|tickets?|gratuity|goods|other|series)\b/iu;

/**
 * A product_type segment that is roasted coffee. Includes the roaster-specific
 * names seen on the seed feeds: Sweet Bloom "Coffee Offerings", PT's "Past
 * Offerings Collection", Heart "Beans", Proud Mary "coffee-archive",
 * Passenger "Archival Release" (frozen back-catalog lots, #31).
 */
const LOT_TYPE =
	/\b(?:coffees?|beans?|blends?|single[\s-]origin|espresso|decaf|gei?sha|offerings|instant|roasts?|whole[\s-]bean|archival)\b/iu;

/**
 * Bare tags only coffee carries (Onyx `coffee`, Coava `Instant Craft Coffee`,
 * Ruby `Washed` and `Medium Roast`). A bare place tag counts too (Ruby
 * `Peru`); see LOT_TITLE_PLACE.
 */
const LOT_BARE_TAG =
	/^(?:coffees?|single[\s-]origin|blends?|instant|instant\s+craft\s+coffee|whole\s+bean|decaf|espresso|drip|washed|natural|honey|anaerobic|(?:light|medium|dark)(?:[\s-](?:light|dark))?[\s-]roast)$/iu;

/** `Key: Value` keys only coffee carries, whatever the value ("From: Ethiopia", "Coffee Type: Blend"). */
const LOT_TAG_KEY =
	/^(?:coffee\s+type|origin|from|country|process|roast|roast\s+level)$/iu;

/** `Type: Single Origin` / `type:blend` (Proud Mary, Onyx); a bare `Type:` says nothing. */
const LOT_TYPE_TAG_VALUE = /^(?:single[\s-]origin|blends?)$/iu;

/**
 * Coffee vocabulary in a title: what the coffee is, how it was processed.
 * No `honey`: on an untyped item it is as likely the jar (Ruby "Bird And The
 * Bees Honey") as the process.
 */
const LOT_TITLE_WORD =
	/\b(?:coffees?|blends?|espresso|decaf\w*|single[\s-]origin|instant|roasts?|roasted|gei?sha|bourbon|typica|caturra|catuai|pacamara|maragogype|heirloom|sl-?28|sl-?34|washed|natural|anaerobic|carbonic|omni|wet[\s-]process|dry[\s-]process|wet[\s-]hulled|cup\s+of\s+excellence|coe)\b/iu;

/**
 * The subset of LOT_TITLE_WORD that names the coffee itself (a variety, a
 * process, a format like blend or espresso) rather than the word "coffee",
 * which a mug or a book carries just as well. Resolves NON_LOT_AMBIGUOUS_TITLE.
 */
const LOT_TITLE_CRAFT =
	/\b(?:blends?|espresso|decaf\w*|single[\s-]origin|gei?sha|bourbon|typica|caturra|catuai|pacamara|maragogype|heirloom|sl-?28|sl-?34|washed|natural|anaerobic|carbonic|omni|wet[\s-]process|dry[\s-]process|wet[\s-]hulled|cup\s+of\s+excellence|coe)\b/iu;

/** Producing countries and the regions that stand alone in coffee names. */
const LOT_TITLE_PLACE =
	/\b(?:ethiopia|kenya|colombia|brazil|guatemala|costa\s+rica|honduras|el\s+salvador|nicaragua|peru|mexico|panama|rwanda|burundi|uganda|tanzania|yemen|indonesia|sumatra|sulawesi|java|bali|papua\s+new\s+guinea|bolivia|ecuador|congo|malawi|zambia|india|vietnam|thailand|myanmar|laos|yunnan|china|hawaii|kona|jamaica|dominican|haiti|timor|philippines|nepal|cameroon|venezuela|huila|nari[nñ]o|cauca|tolima|antioquia|yirgacheffe|sidama|sidamo|guji|gedeb|kochere|nyeri|kirinyaga|huehuetenango|antigua|tarraz[uú]|chiapas|oaxaca|boquete|cajamarca)\b/iu;

export type LotRule = "wholesale" | "title" | "tag" | "type" | "default";

export interface LotClassification {
	isLot: boolean;
	/** Which signal decided, for tests and feed audits. */
	rule: LotRule;
}

export interface LotClassifierInput {
	productType: string | null | undefined;
	tags: string[] | string | null | undefined;
	title: string | null | undefined;
	vendor?: string | null | undefined;
}

/**
 * A bare `wholesale` tag usually means "also sold wholesale" (Sweet Bloom,
 * Heart, Blossom tag every retail coffee with it), so it is not a marker on
 * its own. Ruby's wholesale-only blends are the exception: untyped, and that
 * tag is the only one (#31). Both conditions, or the tag says nothing.
 */
const LONE_WHOLESALE_TAG = /^wholesale$/iu;

const isLoneTag = (tags: string[], pattern: RegExp): boolean =>
	tags.length === 1 && pattern.test(tags[0]);

type Verdict = "lot" | "non_lot" | "unknown";

/** Verdict over the product_type segments (Stumptown lists several, comma-separated). */
const typeVerdict = (productType: string): Verdict => {
	let sawNonLot = false;
	for (const segment of productType.split(",")) {
		if (NON_LOT_TYPE.test(segment)) {
			sawNonLot = true;
		} else if (LOT_TYPE.test(segment)) {
			// A coffee segment outranks a "Gifts" segment on the same product.
			return "lot";
		}
	}
	return sawNonLot ? "non_lot" : "unknown";
};

const tagMatches = (tags: string[], pattern: RegExp): boolean =>
	tags.some((tag) => {
		const { key, value } = splitTag(tag);
		return pattern.test(value === "" ? key : value);
	});

const keyedTagMatches = (tags: string[], pattern: RegExp): boolean =>
	tags.some((tag) => {
		const { value } = splitTag(tag);
		return value !== "" && pattern.test(value);
	});

const tagSaysLot = (tags: string[]): boolean =>
	tags.some((tag) => {
		const { key, value } = splitTag(tag);
		if (value === "") {
			return LOT_BARE_TAG.test(key) || LOT_TITLE_PLACE.test(key);
		}
		if (LOT_TAG_KEY.test(key)) {
			return true;
		}
		return key.toLowerCase() === "type" && LOT_TYPE_TAG_VALUE.test(value);
	});

const titleSaysLot = (title: string): boolean =>
	LOT_TITLE_WORD.test(title) || LOT_TITLE_PLACE.test(title);

/** A place or craft word: enough to read an ambiguous title word as coffee. */
const titleNamesCoffee = (title: string): boolean =>
	LOT_TITLE_PLACE.test(title) || LOT_TITLE_CRAFT.test(title);

/**
 * The untyped path (§16 steps 5 and 6): nothing typed the item, so tags and
 * title carry the decision. A weak non-lot tag (`subscription`, `recharge`,
 * `tea`) decides only when no other tag says coffee: a bare `tea` next to
 * `Ethiopia` is a tasting note. In the title, hard non-lot words win over
 * everything; ambiguous ones (`honey`, `cup`, `chocolate`) lose to a place
 * or craft word in the same title.
 */
const classifyUntyped = (tags: string[], title: string): LotClassification => {
	const coffeeTag = tagSaysLot(tags);
	if (!coffeeTag && tagMatches(tags, NON_LOT_WEAK_TAG_VALUE)) {
		return { isLot: false, rule: "tag" };
	}
	if (coffeeTag) {
		return { isLot: true, rule: "tag" };
	}
	if (NON_LOT_UNTYPED_TITLE.test(title)) {
		return { isLot: false, rule: "title" };
	}
	if (NON_LOT_AMBIGUOUS_TITLE.test(title) && !titleNamesCoffee(title)) {
		return { isLot: false, rule: "title" };
	}
	if (titleSaysLot(title)) {
		return { isLot: true, rule: "title" };
	}
	return { isLot: false, rule: "default" };
};

/**
 * Decide whether a shop item is a lot (§16). Signals in order, first decisive
 * wins: wholesale; a title that names a non-lot format, a drinkable container
 * or a hard good; a tag whose value names a non-lot; the product_type; then,
 * for untyped items, tags and title with coffee vocabulary. Untyped,
 * untagged, unnamed items are not lots: the seed roasters all type their
 * coffees, and a false lot pollutes the feed while a missed one costs a
 * sold-out archive row.
 */
/** One ambiguous-tail item as the parsers hand it to the Jev shadow check. */
export interface ShadowCandidate {
	/** The item's own description, stripped and capped, as Jev context. */
	description?: string;
	externalId: string;
	productType?: string;
	/** The shop's own tags, capped: a long tag list is context rot, not signal. */
	tags?: string[];
	title: string;
}

const SHADOW_DESCRIPTION_MAX_LENGTH = 300;
const SHADOW_TAGS_MAX = 12;

/**
 * A candidate for the Jev shadow check (§16): a `default` verdict is a
 * guess, not a decision — the feed paths reject the item while the page path
 * accepts it. Only that rule qualifies: a title or tag rejection named its
 * reason, and Jev would not add one. Everything the candidate carries is the
 * shop's own words; nothing is invented.
 */
export const shadowCandidateFrom = (
	verdict: LotClassification,
	input: {
		bodyHtml?: string | null;
		externalId: string;
		productType?: string | null;
		tags?: string[] | string | null;
		title?: string | null;
	}
): ShadowCandidate | null => {
	if (verdict.isLot || verdict.rule !== "default") {
		return null;
	}
	if (input.externalId === "") {
		return null;
	}
	const title = (input.title ?? "").trim();
	if (title === "") {
		return null;
	}
	const candidate: ShadowCandidate = { externalId: input.externalId, title };
	const productType = (input.productType ?? "").trim();
	if (productType !== "") {
		candidate.productType = productType.slice(0, PRODUCT_TYPE_MAX_LENGTH);
	}
	const tags = parseTags(input.tags).slice(0, SHADOW_TAGS_MAX);
	if (tags.length > 0) {
		candidate.tags = tags;
	}
	if (typeof input.bodyHtml === "string") {
		const description = capAtWord(
			stripHtml(input.bodyHtml).replaceAll("\n", " "),
			SHADOW_DESCRIPTION_MAX_LENGTH
		);
		if (description !== null) {
			candidate.description = description;
		}
	}
	return candidate;
};

export const classifyLot = (input: LotClassifierInput): LotClassification => {
	const title = input.title ?? "";
	const tags = parseTags(input.tags);
	if (
		isWholesale(input.productType, input.tags, title, input.vendor) ||
		((input.productType ?? "").trim() === "" &&
			isLoneTag(tags, LONE_WHOLESALE_TAG))
	) {
		return { isLot: false, rule: "wholesale" };
	}
	if (
		NON_LOT_FORMAT_TITLE.test(title) ||
		NON_LOT_RTD_TITLE.test(title) ||
		NON_LOT_GOODS_TITLE.test(title)
	) {
		return { isLot: false, rule: "title" };
	}
	if (
		tagMatches(tags, NON_LOT_TAG_VALUE) ||
		keyedTagMatches(tags, NON_LOT_KEYED_SUBSCRIPTION)
	) {
		return { isLot: false, rule: "tag" };
	}
	const byType = typeVerdict(input.productType ?? "");
	if (byType !== "unknown") {
		return { isLot: byType === "lot", rule: "type" };
	}
	return classifyUntyped(tags, title);
};

export const toCents = (price: unknown): number => {
	const n = typeof price === "number" ? price : Number(String(price));
	if (!Number.isFinite(n)) {
		return 0;
	}
	return Math.round(n * 100);
};

interface ShopifyVariant {
	available?: boolean | null;
	grams?: number | null;
	id?: number | null;
	option1?: string | null;
	option2?: string | null;
	option3?: string | null;
	price?: string | number;
	title?: string | null;
}

// A size in a variant name, with an optional pack count in front ("2 x 250g",
// "2x 8oz", Counter Culture "12 - 4oz bags"). Longer unit spellings come
// first so "250gms" is not read as "g".
const SIZE_TOKEN =
	/(?:(?<count>\d+)\s*[x-]\s*)?(?<qty>\d*\.?\d+)\s*-?\s*(?<unit>kilos?|kg|pounds?|lbs?|ounces?|oz|grams?|gms|gm|gr|g)\b/iu;
const CASE_PACK = /case\s*pack\s*\((?<count>\d+)\)/iu;
const GRAMS_PER_OZ = 28.3495;
const GRAMS_PER_LB = 453.592;

const unitGrams = (unit: string): number => {
	const u = unit.toLowerCase();
	if (u.startsWith("k")) {
		return 1000;
	}
	if (u.startsWith("l") || u.startsWith("p")) {
		return GRAMS_PER_LB;
	}
	if (u.startsWith("o")) {
		return GRAMS_PER_OZ;
	}
	return 1;
};

const gramsFromText = (text: string): number | undefined => {
	const groups = SIZE_TOKEN.exec(text)?.groups;
	if (groups === undefined) {
		return;
	}
	const qty = Number(groups.qty);
	if (!(Number.isFinite(qty) && qty > 0)) {
		return;
	}
	const count = Number(
		groups.count ?? CASE_PACK.exec(text)?.groups?.count ?? 1
	);
	return Math.round(qty * unitGrams(groups.unit ?? "g") * count);
};

/**
 * Bag size in grams from the variant name, then any option value, then
 * Shopify's `grams` when it is positive. Shopify `grams` is the shipping
 * weight (East Pole "12 oz." carries 397; every Blossom bag carries 0), while
 * the name is right essentially always (#28). Multi-packs ("2 x 250g",
 * "10oz Case Pack (6)") weigh count times size.
 */
export const parseVariantGrams = (
	name: string,
	optionValues: string[],
	shopifyGrams?: number | null
): number | undefined => {
	for (const text of [name, ...optionValues]) {
		const grams = gramsFromText(text);
		if (grams !== undefined) {
			return grams;
		}
	}
	return typeof shopifyGrams === "number" && shopifyGrams > 0
		? shopifyGrams
		: undefined;
};

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
	vendor?: string | null;
}

export interface ProductsJsonPage {
	/**
	 * Raw feed length before the lot classifier. A full page
	 * (PRODUCTS_JSON_PAGE_SIZE) means the next page may hold more products.
	 */
	feedCount: number;
	products: ExtractedProduct[];
	/**
	 * externalIds the classifier rejected (§16). The crawl hands them to
	 * finalizeCrawl, which purges any that are still in the catalog.
	 */
	rejectedExternalIds: string[];
	/**
	 * The classifier's ambiguous tail (default rejections), for the Jev
	 * shadow check, which records a second opinion without acting on it.
	 */
	shadowCandidates: ShadowCandidate[];
}

export interface LotCopyInput {
	/** The roaster's description, HTML or plain text. */
	bodyHtml?: string | null;
	imageUrl?: string | null;
	/** The shop's own type or category for the item, raw. */
	productType?: string | null;
	tags?: string[] | string | null;
	title?: string | null;
	vendor?: string | null;
}

/**
 * The roaster's published copy for one shop item (§14.4), from whatever the
 * platform exposes: Shopify's body_html, tags and product_type; a WooCommerce
 * description and categories; the description and category Firecrawl's
 * product format reads off a page. Always returned, even empty: every source
 * that calls this is authoritative for the copy, so an empty object means
 * "the roaster publishes none" and clears stale values.
 */
export const buildLotCopy = (input: LotCopyInput): LotCopy => {
	const tags = parseTags(input.tags);
	// The block-structured text drives the notes regex (blocks end clause
	// captures); the stored description is the same copy flattened to one
	// line.
	const blockText =
		typeof input.bodyHtml === "string" ? stripHtml(input.bodyHtml) : "";
	const description = capAtWord(
		blockText.replaceAll("\n", " "),
		DESCRIPTION_MAX_LENGTH
	);
	const roasterNotes = extractRoasterNotes(blockText, tags);
	const copy: LotCopy = parseLotAttributes({
		blockText,
		tags,
		title: input.title,
		vendor: input.vendor,
	});
	if (description !== null) {
		copy.description = description;
	}
	if (typeof input.imageUrl === "string" && input.imageUrl !== "") {
		copy.imageUrl = input.imageUrl;
	}
	if (tags.length > 0) {
		copy.tags = tags.slice(0, MAX_TAGS);
	}
	if (roasterNotes !== null) {
		const notes = splitNotes(roasterNotes);
		if (notes.length > 0) {
			copy.roasterNotes = notes;
		}
	}
	const productType =
		typeof input.productType === "string" ? input.productType.trim() : "";
	if (productType !== "") {
		copy.productType = productType.slice(0, PRODUCT_TYPE_MAX_LENGTH);
	}
	return copy;
};

const parseLotCopy = (raw: ShopifyProduct): LotCopy =>
	buildLotCopy({
		bodyHtml: raw.body_html,
		imageUrl:
			raw.image?.src ??
			raw.images?.find((image) => typeof image.src === "string")?.src,
		productType: raw.product_type,
		tags: raw.tags,
		title: raw.title,
		vendor: raw.vendor,
	});

/**
 * A line past this is prose, not an element Jev can pick (ADR-0010; the
 * probe sent lines up to 160 characters and every spec line fit).
 */
const MAX_ELEMENT_LENGTH = 160;
/** A bare note list line ("Prunes • Fig Danish • Nutmeg") past this is prose. */
const MAX_NOTE_LINE_LENGTH = 120;
/**
 * A notes lead with a list after it: "Tasting notes: Prunes", "Notes of Red
 * Fruit, Citrus", "Flavor Notes - Cherry". A bare header ("Tasting Notes",
 * "NOTES") has no list and is not a note line.
 */
const NOTES_LEAD =
	/^(?:(?:tasting|flavou?r|cupping)\s+notes?|notes?|flavou?rs)\b\s*(?:[:|–—-]|of\b)\s*(?=\S)/iu;
/**
 * The label vocabulary a page line can lead with, in any case, with or
 * without a colon (Regalia writes "Process Washed"; La Colombe "COOP/FARM :
 * Lacador"). A run of labels joined by a slash or a space is one lead.
 */
const PAGE_LABEL_WORD =
	"process(?:ing)?(?:\\s+method)?|roast(?:\\s+level|\\s+profile)?|variet(?:y|al|ies|als)|cultivar|growing\\s+region|sub-?region|micro-?region|region|location|zone|district|woreda|appellation|origins?|elevation|altitude?|producers?|farms?|farmers?|washing\\s+station|mill|co-?op(?:erative)?|estate|growers?|produced\\s+by";
const PAGE_LABEL_LEAD = new RegExp(
	`^(?:(?:${PAGE_LABEL_WORD})\\b\\s*[/&]?\\s*)+(?:[:|–—-]\\s*)?(?=\\S)`,
	"iu"
);
/** Sentence punctuation with more text after it marks prose, never a note list. */
const SENTENCE_PUNCTUATION = /[.!?]./u;

/** The page as Jev's options: its distinct lines, and the note-shaped ones among them. */
export interface PageElements {
	/** Every distinct line up to MAX_ELEMENT_LENGTH, in page order. */
	lines: string[];
	/** The lines shaped like a notes list; each gets one Noul. */
	noteLines: string[];
}

/**
 * Whether a line is shaped like a tasting-notes list: a notes lead with a
 * list after it, or a bare list with a separator, and no sentence
 * punctuation either way. Loose on purpose: the probe found Jev's line
 * Noul passes headers and prose without this filter. A line that leads
 * with another field's label ("Altitude: 1,900 - 2,100 masl") is that
 * field's, never notes.
 */
const isNoteLine = (line: string): boolean => {
	if (SENTENCE_PUNCTUATION.test(line) || PAGE_LABEL_LEAD.test(line)) {
		return false;
	}
	if (NOTES_LEAD.test(line)) {
		return true;
	}
	return line.length <= MAX_NOTE_LINE_LENGTH && NOTE_SEPARATOR.test(line);
};

/**
 * The reduced page text as elements (ADR-0010): every distinct line up to
 * the element cap, in page order, is an option on each field's Choice; the
 * note-shaped lines among them each get a Noul. No cap on the count: the
 * probe sent 227 options and Jev answered; the state limit bounds it.
 */
export const pageElements = (pageText: string): PageElements => {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const raw of pageText.split(/\n+/u)) {
		const line = raw.trim();
		if (line !== "" && line.length <= MAX_ELEMENT_LENGTH && !seen.has(line)) {
			seen.add(line);
			lines.push(line);
		}
	}
	return { lines, noteLines: lines.filter(isNoteLine) };
};

/**
 * Over-find elevation spans anywhere on a page: the unanchored twin of the
 * ELEVATION shape lotFacts verifies against. "1500-1730masl",
 * "1,900 - 2,100 masl", "1900 to 2100 metres".
 */
const ELEVATION_SPAN =
	/\b\d[\d,.]*(?:\s*(?:-|–|—|to)\s*\d[\d,.]*)?\s*(?:masl|mamsl|meters|metres|fasl|feet|ft|m)\b\.?/giu;

/**
 * The variety vocabulary for over-finding: the names a roaster writes in
 * prose ("a SL28 and SL34 blend") where no label line helps. Deliberately
 * without country-sized ambiguity ("Colombia" is also a country): the label
 * lines and the Jev pick cover those.
 */
const VARIETY_TERM =
	/\b(?:gesha|geisha|sl\s?\d\d|ruiru\s*11|batian|heirloom|landrace|74\d\d\d|(?:pink|red|yellow|orange)\s+bourbon|bourbon|typica|caturra|catuai|pacamara|pacas|maragogype|maragogipe|sidra|wush\s*wush|wolisho|dega|kurume|tekisic|villalobos|villa\s+sarchi|catimor|sarchimor|parainema|laurina|eugenioides|castillo|tabi|jackson|blue\s+mountain|mokka)\b/giu;

/** A notes lead mid-line: "look for notes of red plum, brown sugar" (Coava). */
const NOTES_LEAD_ANYWHERE = /\b(?:notes?|flavou?rs?|hints?|aromas?)\s+of\s+/iu;

/** The picked line without its label lead. */
const stripLabel = (line: string): string =>
	line.replace(PAGE_LABEL_LEAD, "").trim();

/** The roast level on the line: a labelled or bare level, else "light roast" in prose. */
const cutRoast = (line: string): string | undefined => {
	const [level] = roastFromValue(stripLabel(line));
	return level ?? ROAST_IN_TITLE.exec(line)?.[0].trim();
};

/**
 * The variety on the line: the labelled list whole when it verifies
 * ("Caturra, Typica, Marsellesa"), else the vocabulary terms it names,
 * because a long list fails the shape as a whole and would lose every term
 * (PTS: "Typica, Pacas, Caturra, Catuaí, and San Salvador").
 */
const cutVariety = (line: string): string | undefined => {
	const value = stripLabel(line);
	if (verifyVariety(value) !== null) {
		return value;
	}
	const terms: string[] = [];
	for (const match of value.matchAll(VARIETY_TERM)) {
		if (!terms.some((seen) => seen.toLowerCase() === match[0].toLowerCase())) {
			terms.push(match[0]);
		}
	}
	return terms.length === 0 ? undefined : terms.join(", ");
};

/** ELEVATION_SPAN without the global flag: the first span on a line. */
const FIRST_ELEVATION_SPAN = new RegExp(ELEVATION_SPAN.source, "iu");

/** The first elevation span on the line ("Altitud 2050 MASL" carries one). */
const cutElevation = (line: string): string | undefined =>
	FIRST_ELEVATION_SPAN.exec(line)?.[0];

/**
 * The producer on the line, unless the line is the lot's name. Lot names
 * pass the producer shape at high confidence ("Kenya Karumandi", "Rwanda -
 * Rulindo Murambi - Washed"), and a lot named after its producer is common
 * (Madcap "Irvin Izaguirre"), so equality with the name separates nothing.
 * What does: a producer's name has no country and no process term in it.
 */
const cutProducer = (line: string): string | undefined => {
	const value = stripLabel(line);
	return findCountries(value).length > 0 || findProcesses(value).length > 0
		? undefined
		: value;
};

/** A notes header with nothing after it ("Tasting Notes", "NOTES"). */
const NOTES_HEADER =
	/^(?:(?:tasting|flavou?r|cupping)\s+notes?|notes?|flavou?rs)$/iu;

/** The notes on the line: the list after its lead, split; a bare header has none. */
const cutNotes = (line: string): string[] => {
	if (NOTES_HEADER.test(line.trim())) {
		return [];
	}
	const list = line.replace(PAGE_LABEL_LEAD, "").replace(NOTES_LEAD, "");
	const mid = NOTES_LEAD_ANYWHERE.exec(list);
	return splitNotes(
		mid === null ? list : list.slice(mid.index + mid[0].length)
	);
};

/**
 * The values cut from one product page, verified through the same
 * per-field shapes the feed path applies (ADR-0005). Every value is verbatim
 * on the page by construction (it is cut from a line Jev picked), so the
 * letter-for-letter gate has no work left; what remains is shape. So "Not
 * specified" fails a field's shape, Merit's `roastLevel: "Espresso"` (the
 * page's recommended use) fails the roast shape, and a country under region
 * is an origin, not a region. An empty object means the page said nothing
 * usable.
 */
export const verifyPageFacts = (picks: PageFacts): PageFacts => {
	const facts: PageFacts = {};
	const processTerms =
		picks.process === undefined ? [] : findProcesses(picks.process);
	if (processTerms.length > 0) {
		facts.process = processTerms.join(", ");
	}
	const [roastLevel] =
		picks.roastLevel === undefined ? [] : roastFromValue(picks.roastLevel);
	if (roastLevel !== undefined) {
		facts.roastLevel = roastLevel;
	}
	const verifiedVariety =
		picks.variety === undefined ? null : verifyVariety(picks.variety);
	if (verifiedVariety !== null) {
		facts.variety = verifiedVariety;
	}
	const verifiedRegion =
		picks.region === undefined ? null : verifyRegion(picks.region);
	// A country is an origin, not a region (Onyx returns "Kenya" here).
	if (
		verifiedRegion !== null &&
		!CANONICAL_COUNTRY.has(verifiedRegion.toLowerCase())
	) {
		facts.region = verifiedRegion;
	}
	const verifiedElevation =
		picks.elevation === undefined ? null : verifyElevation(picks.elevation);
	if (verifiedElevation !== null) {
		facts.elevation = verifiedElevation;
	}
	const verifiedProducer =
		picks.producer === undefined ? null : verifyProducer(picks.producer);
	if (verifiedProducer !== null) {
		facts.producer = verifiedProducer;
	}
	if (picks.tastingNotes !== undefined) {
		const notes = verifyNotes(picks.tastingNotes);
		if (notes.length > 0) {
			facts.tastingNotes = notes;
		}
	}
	return facts;
};

/**
 * The facts on the lines Jev picked (ADR-0010): each field's cutter takes
 * its value from the line, then verifyPageFacts gates the result. Jev
 * locates, code cuts, the verifier decides; a line is never stored whole.
 */
export const pageFactsFromPicks = (picks: PageFacts): PageFacts => {
	const cut: PageFacts = {};
	const processTerms =
		picks.process === undefined ? [] : findProcesses(picks.process);
	if (processTerms.length > 0) {
		cut.process = processTerms.join(", ");
	}
	const roastLevel =
		picks.roastLevel === undefined ? undefined : cutRoast(picks.roastLevel);
	if (roastLevel !== undefined) {
		cut.roastLevel = roastLevel;
	}
	const variety =
		picks.variety === undefined ? undefined : cutVariety(picks.variety);
	if (variety !== undefined) {
		cut.variety = variety;
	}
	const elevation =
		picks.elevation === undefined ? undefined : cutElevation(picks.elevation);
	if (elevation !== undefined) {
		cut.elevation = elevation;
	}
	if (picks.region !== undefined) {
		cut.region = stripLabel(picks.region);
	}
	const producer =
		picks.producer === undefined ? undefined : cutProducer(picks.producer);
	if (producer !== undefined) {
		cut.producer = producer;
	}
	if (picks.tastingNotes !== undefined) {
		cut.tastingNotes = picks.tastingNotes.flatMap(cutNotes);
	}
	return verifyPageFacts(cut);
};

/**
 * Parse one page of a Shopify /products.json body. Throws when the body is
 * not a Shopify products feed (caller falls back to HTML mode). Applies the
 * lot classifier (§16); a first page with no lots yields no products so the
 * caller can treat an empty catalog as a failed crawl (build spec: empty
 * catalog -> crawl-failed -> HTML mode).
 */
export const parseProductsJson = (text: string): ProductsJsonPage => {
	const body: unknown = JSON.parse(text);
	const feed = (body as { products?: ShopifyProduct[] }).products;
	if (!Array.isArray(feed)) {
		throw new TypeError("Not a Shopify products.json feed");
	}
	const products: ExtractedProduct[] = [];
	const rejectedExternalIds: string[] = [];
	const shadowCandidates: ShadowCandidate[] = [];
	for (const raw of feed) {
		const externalId = String(raw.id ?? raw.handle ?? "");
		const verdict = classifyLot({
			productType: raw.product_type,
			tags: raw.tags,
			title: raw.title,
			vendor: raw.vendor,
		});
		if (!verdict.isLot) {
			// An item with neither id nor handle has nothing to purge by; an
			// empty id would match any catalog row that fell back to "".
			if (externalId !== "") {
				rejectedExternalIds.push(externalId);
			}
			const candidate = shadowCandidateFrom(verdict, {
				bodyHtml: raw.body_html,
				externalId,
				productType: raw.product_type,
				tags: raw.tags,
				title: raw.title,
			});
			if (candidate !== null) {
				shadowCandidates.push(candidate);
			}
			continue;
		}
		const variants: ExtractedVariant[] = (raw.variants ?? []).map((variant) => {
			const name = variant.title ?? "Default";
			const grams = parseVariantGrams(
				name,
				[variant.option1, variant.option2, variant.option3].filter(
					(value): value is string => typeof value === "string"
				),
				variant.grams
			);
			return {
				available: variant.available === true,
				// Shopify variant ids are numeric; stored as the id-string the
				// deep link needs.
				...(typeof variant.id === "number"
					? { externalId: String(variant.id) }
					: {}),
				...(grams === undefined ? {} : { grams }),
				name,
				priceCents: toCents(variant.price),
			};
		});
		products.push({
			externalId,
			handle: raw.handle ?? "",
			lotCopy: parseLotCopy(raw),
			name: raw.title ?? "",
			variants,
		});
	}
	return {
		feedCount: feed.length,
		products,
		rejectedExternalIds,
		shadowCandidates,
	};
};

/** Stop walking products.json pages here even if the feed is still full
 * (4 x 250 = 1000 products; the biggest seeded roasters sit around 300). */
export const MAX_PRODUCTS_JSON_PAGES = 4;

export interface FeedWalkResult {
	pageError: string | null;
	products: ExtractedProduct[];
	/** Union of every page's rejected ids (§16); empty when the walk fails. */
	rejectedExternalIds: string[];
	/** Union of every page's shadow candidates, deduped by externalId. */
	shadowCandidates: ShadowCandidate[];
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
	const rejected = new Set<string>(input.firstPage.rejectedExternalIds);
	const shadow = new Map<string, ShadowCandidate>();
	for (const product of input.firstPage.products) {
		collected.set(product.externalId, product);
	}
	for (const candidate of input.firstPage.shadowCandidates) {
		shadow.set(candidate.externalId, candidate);
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
				rejectedExternalIds: [],
				shadowCandidates: [],
			};
		}
		for (const product of parsed.products) {
			collected.set(product.externalId, product);
		}
		for (const id of parsed.rejectedExternalIds) {
			rejected.add(id);
		}
		for (const candidate of parsed.shadowCandidates) {
			shadow.set(candidate.externalId, candidate);
		}
		({ feedCount } = parsed);
	}
	if (feedCount === PRODUCTS_JSON_PAGE_SIZE) {
		console.warn(
			`${input.websiteUrl}: products.json still full at page ${page}; catalog may exceed the crawl cap`
		);
	}
	return {
		pageError: null,
		products: [...collected.values()],
		rejectedExternalIds: [...rejected],
		shadowCandidates: [...shadow.values()],
	};
};
