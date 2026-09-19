import type { Infer } from "convex/values";
import { ConvexError, v } from "convex/values";
import { z } from "zod";

export const CANDIDATE_LIMIT = 20;
// Total lots inspected per request, across every roaster.
export const CATALOG_SCAN_LIMIT = 160;
// Eligible sources considered and lots read from each of them.
export const SOURCE_SCAN_LIMIT = 40;
export const PRODUCTS_PER_ROASTER = 16;
// Sizes x grinds x subscriptions rarely exceed this; larger sets are skipped.
export const MAX_VARIANTS_PER_PRODUCT = 16;
export const FRESHNESS_MS = 60 * 60 * 1000;
export const EVIDENCE_TTL_MS = 24 * FRESHNESS_MS;
// A failed or empty scrape blocks retries for an hour, not a day.
export const EMPTY_EVIDENCE_TTL_MS = FRESHNESS_MS;
export const MAX_ATTEMPTS = 2;
export const MAX_ENRICHMENTS = 2;
export const RUN_TIMEOUT_MS = 5 * 60 * 1000;
// A reasoning model at low effort. The run stores the model string the API
// returns, so the build log records the exact snapshot behind this alias.
export const OPENAI_MODEL = "gpt-5.6-luna";
export const OPENAI_REASONING_EFFORT = "low";
// Reasoning tokens count against this cap, so it is well above the JSON size.
export const OPENAI_MAX_OUTPUT_TOKENS = 4000;

export const recommendationInput = v.object({
	includeNotes: v.boolean(),
	logIds: v.array(v.id("logs")),
	maxPriceCents: v.optional(v.number()),
	minGrams: v.optional(v.number()),
	preferences: v.string(),
});
export type RecommendationInput = Infer<typeof recommendationInput>;

export const preferenceValidator = v.object({
	id: v.string(),
	text: v.string(),
});
export const evidenceValidator = v.object({
	id: v.string(),
	observedAt: v.number(),
	passage: v.string(),
	source: v.union(v.literal("catalog"), v.literal("firecrawl")),
	url: v.string(),
});
export const candidateValidator = v.object({
	confirmedAt: v.number(),
	currency: v.literal("USD"),
	evidence: v.array(evidenceValidator),
	// No page read is due for the lot (every page fact known, or at the read
	// cap, or inside the retry window; ADR-0008), so the run does not spend
	// one on it. Absent on runs from before the field.
	factsKnown: v.optional(v.boolean()),
	grams: v.number(),
	market: v.literal("US"),
	name: v.string(),
	priceCents: v.number(),
	productId: v.id("products"),
	roasterName: v.string(),
	url: v.string(),
	variantId: v.id("productVariants"),
	variantName: v.string(),
});
export type Candidate = Infer<typeof candidateValidator>;
export type Preference = Infer<typeof preferenceValidator>;
export type Evidence = Infer<typeof evidenceValidator>;

export const selectionValidator = v.object({
	evidenceId: v.string(),
	preferenceId: v.string(),
	productId: v.id("products"),
	quote: v.string(),
	// One model sentence comparing the quote with the preference. Empty when
	// the sentence failed the fact filter; the quote and label still stand.
	reason: v.string(),
	relation: v.union(
		v.literal("similar"),
		v.literal("contrast"),
		v.literal("explore")
	),
});
export type Selection = Infer<typeof selectionValidator>;

export const validateInput = (input: RecommendationInput): void => {
	if (
		input.logIds.length > 5 ||
		new Set(input.logIds).size !== input.logIds.length
	) {
		throw new ConvexError("Choose up to five different logs.");
	}
	if (
		input.preferences.length > 500 ||
		(!input.preferences.trim() && input.logIds.length === 0)
	) {
		throw new ConvexError(
			"Choose a coffee from your history or describe what you want in up to 500 characters."
		);
	}
	for (const value of [input.maxPriceCents, input.minGrams]) {
		if (
			value !== undefined &&
			(!Number.isSafeInteger(value) || value <= 0 || value > 100_000)
		) {
			throw new ConvexError(
				"Budget and bag size must be positive numbers within the form limits."
			);
		}
	}
};

// The quote is extractive and checked byte for byte. The reason is the one
// generated sentence, and it may only compare; anything that looks like a
// fact (numbers, money, stock, shipping) or a promise is dropped, not shown.
const modelSelection = z
	.object({
		evidenceId: z.string(),
		preferenceId: z.string(),
		productId: z.string(),
		quote: z.string().min(8).max(350),
		reason: z.string().max(240),
		relation: z.enum(["similar", "contrast", "explore"]),
	})
	.strict();
const modelOutput = z
	.object({ selections: z.array(modelSelection).max(3) })
	.strict();

const REASON_FACT_CLAIM =
	/[\d$€£%]|https?:|\b(?:price|cost|cheap|expensive|stock|available|availability|sold out|shipping|ships?|delivery|tax|discount|sale|guarantee[ds]?|certainly|definitely|you will|you'll|you are going to)\b/iu;

/** Keep a comparison sentence; drop anything asserting facts or outcomes. */
export const filterReason = (reason: string): string => {
	const text = reason.replaceAll(/\s+/gu, " ").trim();
	if (text.length < 12 || text.length > 240 || REASON_FACT_CLAIM.test(text)) {
		return "";
	}
	return text;
};

export const validateSelections = (
	value: unknown,
	candidates: Candidate[],
	preferences: Preference[]
): Selection[] => {
	const parsed = modelOutput.safeParse(value);
	if (!parsed.success) {
		throw new Error("Invalid recommendation output");
	}
	const seen = new Set<string>();
	return parsed.data.selections.map((selection) => {
		const candidate = candidates.find(
			(item) => item.productId === selection.productId
		);
		const evidence = candidate?.evidence.find(
			(item) => item.id === selection.evidenceId
		);
		if (
			!candidate ||
			!evidence ||
			seen.has(selection.productId) ||
			evidence.passage !== selection.quote ||
			!preferences.some((item) => item.id === selection.preferenceId)
		) {
			throw new Error("Unsupported recommendation output");
		}
		seen.add(selection.productId);
		return {
			...selection,
			productId: candidate.productId,
			reason: filterReason(selection.reason),
		};
	});
};

const STOP_WORDS = new Set([
	"about",
	"coffee",
	"coffees",
	"from",
	"have",
	"like",
	"more",
	"most",
	"prefer",
	"really",
	"some",
	"something",
	"than",
	"that",
	"them",
	"then",
	"they",
	"this",
	"want",
	"what",
	"when",
	"which",
	"with",
	"would",
]);

/** Lowercase words of four or more letters, minus filler. */
export const preferenceTokens = (text: string): string[] => [
	...new Set(
		text
			.toLowerCase()
			.split(/[^a-z]+/u)
			.filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
	),
];

/**
 * Ranks, never filters: a request can ask for a change of direction, so a
 * lot that mentions none of the words still qualifies. Higher first.
 */
export const preferenceScore = (haystack: string, tokens: string[]): number => {
	const text = haystack.toLowerCase();
	let score = 0;
	for (const token of tokens) {
		if (text.includes(token)) {
			score += 1;
		}
	}
	return score;
};

const COFFEE_PROSE =
	/\b(?:tast(?:e|es|ing)|notes?|process(?:ed|ing)?|washed|natural|honey|ferment(?:ed|ation)|variet(?:y|ies)|cultivar|altitude|elevation|producer|harvest|roast(?:ed|ing)?|grown)\b/iu;
const UNSUITABLE_PROSE =
	/(?:https?:|\$|\b(?:USD|price|stock|shipping|subscribe|cart|ignore|instruction|system prompt|assistant)\b)/iu;

// Shop-wide copy speaks for the roaster ("we source", "our offerings") and
// sits on every product page; lot prose speaks about the coffee.
const SHOP_VOICE = /\b(?:we|we're|we've|our|ours|us)\b/iu;
// Customer reviews sit on the product page too, pass the verbatim check, and
// speak as one drinker ("one of my go to coffees", "I've had a tough time").
// Producer prose in the first person singular is rare enough to lose.
const REVIEWER_VOICE = /\bI(?:['’](?:ve|m|d|ll))?\b|\b(?:my|me)\b/iu;
// Any first-person line: the roaster talking about itself or a reviewer.
const isFirstPerson = (line: string): boolean =>
	SHOP_VOICE.test(line) || REVIEWER_VOICE.test(line);
// Tables, inline HTML and image/link syntax are layout, not prose.
const MARKUP = /[|<>]|!\[|\]\(/u;
// Sentence end, but not after a unit or common abbreviation ("12 oz. bag").
const SENTENCE_END =
	/(?<=[.!?])(?<!\b(?:oz|lb|lbs|kg|g|ft|m|no|vs|etc|approx|st|mt)\.)(?<!\d\.)\s+/iu;
const MIN_PASSAGE_WORDS = 5;

const wordCount = (text: string): number =>
	text.split(/\s+/u).filter((word) => /[a-z]/iu.test(word)).length;

/**
 * Drop heading markers, emphasis, list bullets and link syntax. Images go
 * entirely: their alt text is a caption, not prose, and must be removed
 * before link stripping would otherwise turn `![alt](url)` into `!alt`.
 */
export const stripMarkdown = (text: string): string =>
	text
		.replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/u, "")
		.replaceAll(/!\[[^\]]*\]\([^)]*\)/gu, "")
		.replaceAll(/\[(?<label>[^\]]+)\]\([^)]*\)/gu, "$<label>")
		.replaceAll(/(?<mark>\*\*|__)(?<inner>.+?)\k<mark>/gu, "$<inner>")
		.replaceAll(
			/(?<![a-z0-9])[*_](?=[a-z0-9])|(?<=[a-z0-9])[*_](?![a-z0-9])/giu,
			""
		)
		.replaceAll(/\s+/gu, " ")
		.trim();

const MAX_PASSAGE_LENGTH = 350;
const MIN_FACT_LETTERS = 3;

const readablePassage = (line: string, minLength: number): boolean =>
	line.length >= minLength &&
	line.length <= MAX_PASSAGE_LENGTH &&
	wordCount(line) >= MIN_PASSAGE_WORDS &&
	!(MARKUP.test(line) || UNSUITABLE_PROSE.test(line));

// Server-owned labels, in a fixed order. The model never sees or writes them.
const FACT_LABELS = [
	["process", "Process"],
	["variety", "Variety"],
	["region", "Region"],
	["elevation", "Elevation"],
	["producer", "Producer"],
	["roastLevel", "Roast level"],
] as const;

type CatalogFactKey = (typeof FACT_LABELS)[number][0] | "tastingNotes";

// A body_html table flattened by the extractor arrives as one line of
// ALL-CAPS header cells with their values. Known coffee labels map onto the
// fixed fact labels the structured page path uses, so catalog and page
// evidence look the same. Unknown headers (AMOUNT, layout cells) drop out
// with their values; an all-caps value is indistinguishable from a header
// and is lost with them.
const CATALOG_LABEL_KEYS: Record<string, CatalogFactKey> = {
	ALTITUDE: "elevation",
	ELEVATION: "elevation",
	NOTES: "tastingNotes",
	ORIGIN: "region",
	PROCESS: "process",
	PRODUCER: "producer",
	REGION: "region",
	ROAST: "roastLevel",
	VARIETAL: "variety",
	VARIETY: "variety",
};
// Two-word header cells, mapped like the single-word ones.
const PAIR_LABEL_KEYS: Record<string, CatalogFactKey> = {
	"ROAST LEVEL": "roastLevel",
	"TASTING NOTES": "tastingNotes",
};
// Two-word layout cells seen on live colon sheets ("Relationship Since:
// 2020", "Washing Station: Moplaco"). Only the second word carries the
// colon, so without this the first word would ride along as a value.
const PAIR_LAYOUT_CELLS = new Set([
	"COE SCORE",
	"RELATIONSHIP SINCE",
	"WASHING STATION",
]);
// All-caps tokens that are part of a value, not a header cell. Elevations
// are written "1900 MASL" on many pages; losing the unit leaves a bare number.
const VALUE_UNITS = new Set(["FASL", "MAMSL", "MASL"]);
// Punctuation that rides on a header cell ("NOTES:") or trails a value.
const HEADER_EDGE = /[.:,;]+$/u;
const VALUE_EDGE = /[.:,;!\s]+$/u;
// Shop prose glued to the LAST value ("... Brown Sugar We are thrilled to
// bring on this Washed Ethiopian!") ends the facts there. The extractor
// flattens table and following sentence into one paragraph with no boundary,
// so the seam is found inside that value: a closed-class word that starts a
// clause (including first-person shop voice), a capitalised word directly
// after an all-lowercase one ("finish Traffic is one of ..."), or a
// capitalised word followed by a lowercase closed-class word ("Butterscotch
// Located in the ..."). A comma or a capitalised neighbour ("Huila,
// Colombia", "Stone Fruit") does not cut.
// Only the last value is cut: every other value ends where the next header
// begins, so a function word inside it ("Smallholders of the Gedeb district")
// is the roaster's own phrasing and stays.
// Known blind spot: a capitalised prose word after a capitalised last note
// and before an open-class word ("Brown Sugar Traffic flows ...") shows no
// seam and rides along until the next closed-class word.
const VALUE_FUNCTION_WORD =
	/^(?:a|an|the|this|that|these|those|it|its|is|are|was|were|has|have|had|will|we|we're|we've|our|ours|us|i|i've|i'm|my|me|you|they|in|of|on|at|from|with|by|for|into|through)$/iu;

const isUpperToken = (token: string): boolean =>
	token.length > 0 && token === token.toUpperCase();

// A header cell is a bare all-caps word of four or more letters that is not
// a known unit. Shorter caps ("USA", "12", "&") are value tokens.
const isHeaderCell = (bare: string): boolean =>
	/^[A-Z]{4,}$/u.test(bare) && !VALUE_UNITS.has(bare);

// A colon-marked cell ("Region:", "Tasting Notes:") in any case. Mixed-case
// sheets have no all-caps headers, so the colon is the only header signal.
const COLON_CELL = /^[A-Za-z]+:$/u;
const isColonCell = (token: string): boolean => COLON_CELL.test(token);
// Unknown colon cells ("Recipe:", "About:") are headers only when they look
// like one: a capitalised word. A lowercase "farm:" mid-sentence is prose.
const isUnknownColonCell = (token: string): boolean =>
	isColonCell(token) && /^[A-Z]/u.test(token);

// A known label ending in a colon, alone ("Process:") or as the second word of
// a pair ("Tasting Notes:"). Case-insensitive; only the colon marks it.
const isKnownColonCell = (previous: string, token: string): boolean => {
	if (!isColonCell(token)) {
		return false;
	}
	const bare = token.replace(HEADER_EDGE, "").toUpperCase();
	return (
		CATALOG_LABEL_KEYS[bare] !== undefined ||
		PAIR_LABEL_KEYS[`${previous.toUpperCase()} ${bare}`] !== undefined
	);
};

const MIN_RUN_HEADERS = 3;

// Whitespace split, with a spaced colon ("Recipes : Espresso") glued back
// onto its label so it reads as one cell.
const tokenize = (line: string): string[] =>
	line
		.replaceAll(/\s+:(?=\s|$)/gu, ":")
		.split(/\s+/u)
		.filter(Boolean);

// Two signals: three all-caps header cells (#21), or three known colon-marked
// labels in any case (#24). One colon in a real sentence ("Notes: chocolate up
// front, then citrus.") is one label, so the threshold keeps it as prose.
const isLabelRun = (line: string): boolean => {
	const tokens = tokenize(line);
	let capsHeaders = 0;
	let colonHeaders = 0;
	for (const [index, token] of tokens.entries()) {
		if (isHeaderCell(token.replace(HEADER_EDGE, ""))) {
			capsHeaders += 1;
		}
		if (isKnownColonCell(tokens[index - 1] ?? "", token)) {
			colonHeaders += 1;
		}
	}
	return (
		capsHeaders >= MIN_RUN_HEADERS ||
		colonHeaders >= MIN_RUN_HEADERS ||
		/\bnew column\b/iu.test(line)
	);
};

interface HeaderCell {
	key: CatalogFactKey | null;
	width: number;
	// A colon marks the cell explicitly ("Weight:"), so the value before it
	// is bounded and nothing is glued to it. A bare caps word could as well be
	// an acronym inside trailing prose ("the Iyenga AMCOS"), so it does not.
	bounds: boolean;
}

/**
 * The header cell starting at `index`, or null when the token is a value.
 * `key` is null for a header that maps to nothing ("AMOUNT", a "New Column"
 * corner cell), whose value is layout, not coffee data.
 */
const headerAt = (tokens: string[], index: number): HeaderCell | null => {
	const token = tokens[index];
	const nextToken = tokens[index + 1] ?? "";
	const bare = token.replace(HEADER_EDGE, "");
	const next = nextToken.replace(HEADER_EDGE, "");
	const pair = `${bare} ${next}`.toUpperCase();
	if (pair === "NEW COLUMN") {
		return { bounds: false, key: null, width: 2 };
	}
	if (PAIR_LAYOUT_CELLS.has(pair) && isColonCell(nextToken)) {
		return { bounds: true, key: null, width: 2 };
	}
	const pairKey = PAIR_LABEL_KEYS[pair];
	// "TASTING NOTES" in caps, or "Tasting Notes:" with the colon on the
	// second word and none on the first.
	if (
		pairKey !== undefined &&
		((isUpperToken(bare) && isUpperToken(next)) ||
			(isColonCell(nextToken) && !isColonCell(token)))
	) {
		return { bounds: isColonCell(nextToken), key: pairKey, width: 2 };
	}
	if (isColonCell(token)) {
		const colonKey = CATALOG_LABEL_KEYS[bare.toUpperCase()];
		if (colonKey !== undefined) {
			return { bounds: true, key: colonKey, width: 1 };
		}
		return isUnknownColonCell(token)
			? { bounds: true, key: null, width: 1 }
			: null;
	}
	if (!isUpperToken(bare)) {
		return null;
	}
	const singleKey = CATALOG_LABEL_KEYS[bare];
	if (singleKey !== undefined) {
		return { bounds: false, key: singleKey, width: 1 };
	}
	return isHeaderCell(bare) ? { bounds: false, key: null, width: 1 } : null;
};

interface LabelRun {
	values: Map<CatalogFactKey, string>;
	// The key whose value ends the run; the only one prose can be glued to.
	// Null when an explicit colon header (even an unmapped one) follows it.
	last: CatalogFactKey | null;
}

const scanLabelRun = (tokens: string[]): LabelRun => {
	const values = new Map<CatalogFactKey, string>();
	let key: CatalogFactKey | null = null;
	let last: CatalogFactKey | null = null;
	let skipping = false;
	let index = 0;
	while (index < tokens.length) {
		const header = headerAt(tokens, index);
		if (header !== null) {
			({ key } = header);
			// A repeated label's second value is layout, not a correction.
			skipping = key === null || values.has(key);
			if (header.bounds) {
				last = null;
			}
			index += header.width;
			continue;
		}
		if (key !== null && !skipping) {
			const token = tokens[index];
			const current = values.get(key);
			values.set(key, current === undefined ? token : `${current} ${token}`);
			last = key;
		}
		index += 1;
	}
	return { last, values };
};

// Trailing punctuation goes so the joined line keeps the server's own
// sentence ends; a value with fewer than three letters or digits is noise.
const trimValue = (raw: string): string => {
	const text = raw.replace(VALUE_EDGE, "").trim();
	return text.replaceAll(/[^a-z0-9]/giu, "").length < MIN_FACT_LETTERS
		? ""
		: text;
};

const isFunctionWord = (word: string): boolean =>
	VALUE_FUNCTION_WORD.test(word.replace(HEADER_EDGE, ""));

const startsClause = (previous: string, word: string, next: string): boolean =>
	isFunctionWord(word) ||
	(/^[A-Z]/u.test(word) &&
		(/^[a-z]+$/u.test(previous.replace(VALUE_EDGE, "")) ||
			(/^[a-z]/u.test(next) && isFunctionWord(next))));

// Cut glued prose from the last value at the first clause seam, then trim.
const cutValue = (raw: string): string => {
	const tokens = raw.split(/\s+/u).filter(Boolean);
	const seam = tokens.findIndex(
		(word, index) =>
			index > 0 &&
			startsClause(tokens[index - 1], word, tokens[index + 1] ?? "")
	);
	const kept = seam === -1 ? tokens : tokens.slice(0, seam);
	// A cut that leaves only a function word ("This is a sweet cup" -> "This")
	// found prose where the value should be, not a value.
	if (seam !== -1 && kept.length === 1 && VALUE_FUNCTION_WORD.test(kept[0])) {
		return "";
	}
	return trimValue(kept.join(" "));
};

/**
 * Joins mapped values under the fixed labels; null when nothing usable
 * maps, because a flattened sheet that stays a sheet is layout, not prose.
 * Same bar as the structured path: one roast label alone says little.
 */
const joinLabelFacts = ({ values, last }: LabelRun): string | null => {
	const clean = (key: CatalogFactKey, raw: string): string =>
		key === last ? cutValue(raw) : trimValue(raw);
	const facts: string[] = [];
	for (const [field, label] of FACT_LABELS) {
		const raw = values.get(field);
		if (raw === undefined) {
			continue;
		}
		const value = clean(field, raw);
		if (value.length > 0) {
			facts.push(`${label}: ${value}.`);
		}
	}
	const rawNotes = values.get("tastingNotes");
	const notes = rawNotes === undefined ? "" : clean("tastingNotes", rawNotes);
	if (notes.length === 0 && facts.length < 2) {
		return null;
	}
	if (notes.length > 0) {
		facts.push(`Tasting notes: ${notes}.`);
	}
	const passage = facts.join(" ");
	if (
		passage.length === 0 ||
		passage.length > MAX_PASSAGE_LENGTH ||
		MARKUP.test(passage) ||
		UNSUITABLE_PROSE.test(passage)
	) {
		return null;
	}
	return passage;
};

const labelRunFacts = (line: string): string | null =>
	joinLabelFacts(scanLabelRun(tokenize(line)));

export const catalogPassages = (text: string): string[] => {
	const passages: string[] = [];
	for (const paragraph of text.split(/\n+/u)) {
		for (const sentence of paragraph.split(SENTENCE_END)) {
			const line = stripMarkdown(sentence);
			if (isLabelRun(line)) {
				const facts = labelRunFacts(line);
				if (facts !== null) {
					passages.push(facts);
				}
				continue;
			}
			if (readablePassage(line, 8)) {
				passages.push(line);
			}
		}
	}
	return [...new Set(passages)].slice(0, 3);
};

// Markdown rendering of the same body_html changes emphasis, spacing and
// punctuation. Compare letters and digits only so a restyled duplicate of
// the feed text does not pass as new information from the page.
export const normalizeProse = (text: string): string =>
	text
		.toLowerCase()
		.replaceAll(/[^a-z0-9]+/gu, " ")
		.trim();

/**
 * Description-sentence candidates a page read sends to Jev: one Noul per
 * candidate decides whether it describes the coffee, so this over-finds and
 * the model cuts. The regex path alone (slice(0, 3)) stays as the fallback
 * when Jev is unavailable.
 */
export const SENTENCE_CANDIDATES = 12;

/**
 * Regex fallback when structured extraction returns nothing. Keeps public
 * coffee prose only. These passages remain untrusted model input.
 */
export const sentenceCandidates = (
	pageText: string,
	existing: string
): string[] => {
	const known = normalizeProse(existing);
	// One block per line: the reducer's block text (pageTextFromHtml), and
	// markdown paragraphs separated by a blank line split the same way.
	const passages = pageText
		.slice(0, 30_000)
		.split(/\n+/gu)
		.map((line) => stripMarkdown(line))
		.filter((line) => {
			if (
				!(readablePassage(line, 30) && COFFEE_PROSE.test(line)) ||
				isFirstPerson(line)
			) {
				return false;
			}
			const normalized = normalizeProse(line);
			return normalized.length >= 20 && !known.includes(normalized);
		});
	return [...new Set(passages)].slice(0, SENTENCE_CANDIDATES);
};

/** Candidate sentences the regex alone trusts, for a run without Jev. */
export const enrichmentPassages = (
	markdown: string,
	existing: string
): string[] => sentenceCandidates(markdown, existing).slice(0, 3);

const MAX_PAGE_SENTENCES = 3;

/**
 * Page evidence: the description sentences the page read's Jev questions
 * approved (each was a regex candidate verbatim on the page, and the Noul
 * cut the shop-wide copy). Falls back to the regex path when Jev was
 * unavailable or approved nothing. Still untrusted model input downstream.
 */
export const pagePassages = (
	page: { markdown?: string; sentences?: string[] },
	known: string
): string[] => {
	const sentences = (page.sentences ?? []).slice(0, MAX_PAGE_SENTENCES);
	return sentences.length > 0
		? sentences
		: enrichmentPassages(page.markdown ?? "", known);
};

export const recommendationOutputSchema = {
	additionalProperties: false,
	properties: {
		selections: {
			items: {
				additionalProperties: false,
				properties: {
					evidenceId: { type: "string" },
					preferenceId: { type: "string" },
					productId: { type: "string" },
					quote: { type: "string" },
					reason: { type: "string" },
					relation: {
						enum: ["similar", "contrast", "explore"],
						type: "string",
					},
				},
				required: [
					"productId",
					"evidenceId",
					"quote",
					"preferenceId",
					"relation",
					"reason",
				],
				type: "object",
			},
			type: "array",
		},
	},
	required: ["selections"],
	type: "object",
} as const;
