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
// on the next cycle — no migration). Every field is optional: a lot with no
// tasting prose has no roasterNotes, and that absence is meaningful (see
// ExtractedProduct.lotCopy).
export const lotCopyValidator = v.object({
	description: v.optional(v.string()),
	imageUrl: v.optional(v.string()),
	origin: v.optional(v.string()),
	process: v.optional(v.string()),
	roastLevel: v.optional(v.string()),
	roasterNotes: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
});

export const extractedProduct = v.object({
	externalId: v.string(),
	handle: v.string(),
	lotCopy: v.optional(lotCopyValidator),
	name: v.string(),
	variants: v.array(extractedVariant),
});

export interface ExtractedVariant {
	available: boolean;
	grams?: number;
	name: string;
	priceCents: number;
}

export interface LotCopy {
	description?: string;
	imageUrl?: string;
	origin?: string;
	process?: string;
	roastLevel?: string;
	roasterNotes?: string;
	tags?: string[];
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
/**
 * A place name: letters and light punctuation, a few words at most.
 * `From:` is the loosest origin key (Proud Mary), so the value has to look
 * like a place — "From: our friends at the co-op" is not an origin.
 */
const ORIGIN_VALUE = /^[\p{L}][\p{L}\s,.'’()-]*$/u;
const MAX_ORIGIN_WORDS = 4;
const PROCESS_TAG = /^process$/iu;
const ROAST_TAG = /^(?:roast|roast level)$/iu;
/** Anchored: "Light", "Medium-Light", "Light Roast"; not "Lightly sweet". */
const ROAST_VALUE = /^(?:light|medium|dark)\b/iu;
const BARE_PROCESS_TAG = /^(?:washed|natural|honey|anaerobic)$/iu;
const FLAVOR_PROFILE_TAG = /^flavor profile$/iu;

const looksLikeOrigin = (value: string): boolean =>
	ORIGIN_VALUE.test(value) && value.split(/\s+/u).length <= MAX_ORIGIN_WORDS;

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
		const { key, value } = splitTag(tag);
		if (ORIGIN_TAG.test(key) && looksLikeOrigin(value)) {
			attributes.origin ??= value;
		} else if (PROCESS_TAG.test(key) && value !== "") {
			attributes.process ??= value;
		} else if (ROAST_TAG.test(key) && ROAST_VALUE.test(value)) {
			attributes.roastLevel ??= value;
		} else if (BARE_PROCESS_TAG.test(key)) {
			attributes.process ??= key;
		}
	}
	return attributes;
};

/**
 * Trailing connectives left behind when a clause capture stops at a block
 * boundary: ", and", " &", " -", and bare punctuation or whitespace.
 */
const TRIM_TAIL = /(?:\s+and|[\s,&-])+$/iu;

/**
 * Descriptor-clause patterns over the roaster's prose, tried in order. Each
 * captures `clause`; the lead-in words are anchored on a word boundary so
 * "Footnotes of the harvest" is not a `notes of` match.
 */
const NOTES_PATTERNS: readonly RegExp[] = [
	// Ruby lists descriptors dash-separated in their own block; the newline
	// (not the boilerplate that follows) ends the capture.
	/\bwe\s+taste:?\s*(?<clause>[^\n]{5,200})/iu,
	/\bin\s+the\s+cup,?\s+we\s+(?:find|taste|get)\s+(?<clause>[^.!?\n]{5,200})/iu,
	/\b(?:tasting\s+)?notes\s+of\s+(?<clause>[^\u2014\u2013.!?\n]{5,160})/iu,
	/\bflavors\s+of\s+(?<clause>[^\u2014\u2013.!?\n]{5,160})/iu,
];

const matchClause = (description: string): string | null => {
	for (const pattern of NOTES_PATTERNS) {
		const clause = pattern
			.exec(description)
			?.groups?.clause.replace(TRIM_TAIL, "")
			.trim();
		if (clause !== undefined && clause !== "") {
			return clause;
		}
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
	title?: string | null
): boolean => {
	if (
		WHOLESALE_TEXT.test(productType ?? "") ||
		WHOLESALE_TEXT.test(title ?? "")
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
 * untyped items (NON_LOT_UNTYPED_TITLE).
 */
const NON_LOT_GOODS_TITLE =
	/\b(?:mugs?|tees?|t-?shirts?|shirts?|hoodies?|sweatshirts?|crewnecks?|beanies?|snapbacks?|caps?|hats?|totes?|stickers?|scales?|grinders?|kettles?|drippers?|tampers?|canisters?|tumblers?|koozies?|socks|aprons?|candles?|posters?|drinkware|apparel|merch(?:andise)?|equipment|gear|filters)\b/iu;

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
	/\b(?:equipment|gear|brew(?:ing|ers?)|scales?|grinders?|kettles?|filters?|accessor(?:y|ies)|merch(?:andise)?|apparel|drinkware|wares?|warehouse|mugs?|tees?|t-?shirts?|gifts?|cards?|subscriptions?|clubs?|bundles?|sets?|box(?:es)?|teas?|chocolate|food|rtd|cold\s+brew|lattes?|alt\s+beverage|supplies|events?|tickets?|gratuity|goods|other|series)\b/iu;

/**
 * A product_type segment that is roasted coffee. Includes the roaster-specific
 * names seen on the seed feeds: Sweet Bloom "Coffee Offerings", PT's "Past
 * Offerings Collection", Heart "Beans", Proud Mary "coffee-archive".
 */
const LOT_TYPE =
	/\b(?:coffees?|beans?|blends?|single[\s-]origin|espresso|decaf|gei?sha|offerings|instant|roasts?|whole[\s-]bean)\b/iu;

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
	/\b(?:coffees?|blends?|espresso|decaf\w*|single[\s-]origin|instant|roasts?|roasted|gei?sha|bourbon|typica|caturra|catuai|pacamara|maragogype|heirloom|sl-?28|sl-?34|washed|natural|anaerobic|carbonic|omni)\b/iu;

/**
 * The subset of LOT_TITLE_WORD that names the coffee itself (a variety, a
 * process, a format like blend or espresso) rather than the word "coffee",
 * which a mug or a book carries just as well. Resolves NON_LOT_AMBIGUOUS_TITLE.
 */
const LOT_TITLE_CRAFT =
	/\b(?:blends?|espresso|decaf\w*|single[\s-]origin|gei?sha|bourbon|typica|caturra|catuai|pacamara|maragogype|heirloom|sl-?28|sl-?34|washed|natural|anaerobic|carbonic|omni)\b/iu;

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
}

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
export const classifyLot = (input: LotClassifierInput): LotClassification => {
	const title = input.title ?? "";
	if (isWholesale(input.productType, input.tags, title)) {
		return { isLot: false, rule: "wholesale" };
	}
	if (
		NON_LOT_FORMAT_TITLE.test(title) ||
		NON_LOT_RTD_TITLE.test(title) ||
		NON_LOT_GOODS_TITLE.test(title)
	) {
		return { isLot: false, rule: "title" };
	}
	const tags = parseTags(input.tags);
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
	shopifyGrams: number | null | undefined
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
}

/**
 * The roaster's published copy for one products.json product (§14.4). Always
 * returned, even empty: products.json is authoritative for this copy, so an
 * empty object means "the roaster publishes none" and clears stale values.
 */
const parseLotCopy = (raw: ShopifyProduct): LotCopy => {
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
		raw.images?.find((image) => typeof image.src === "string")?.src;
	const roasterNotes = extractRoasterNotes(blockText, tags);
	const copy: LotCopy = parseLotAttributes(tags);
	if (description !== null) {
		copy.description = description;
	}
	if (typeof imageUrl === "string") {
		copy.imageUrl = imageUrl;
	}
	if (tags.length > 0) {
		copy.tags = tags.slice(0, MAX_TAGS);
	}
	if (roasterNotes !== null) {
		copy.roasterNotes = roasterNotes;
	}
	return copy;
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
	for (const raw of feed) {
		const externalId = String(raw.id ?? raw.handle ?? "");
		const verdict = classifyLot({
			productType: raw.product_type,
			tags: raw.tags,
			title: raw.title,
		});
		if (!verdict.isLot) {
			// An item with neither id nor handle has nothing to purge by; an
			// empty id would match any catalog row that fell back to "".
			if (externalId !== "") {
				rejectedExternalIds.push(externalId);
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
	return { feedCount: feed.length, products, rejectedExternalIds };
};

/** Stop walking products.json pages here even if the feed is still full
 * (4 x 250 = 1000 products; the biggest seeded roasters sit around 300). */
export const MAX_PRODUCTS_JSON_PAGES = 4;

export interface FeedWalkResult {
	pageError: string | null;
	products: ExtractedProduct[];
	/** Union of every page's rejected ids (§16); empty when the walk fails. */
	rejectedExternalIds: string[];
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
				rejectedExternalIds: [],
			};
		}
		for (const product of parsed.products) {
			collected.set(product.externalId, product);
		}
		for (const id of parsed.rejectedExternalIds) {
			rejected.add(id);
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
	};
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
