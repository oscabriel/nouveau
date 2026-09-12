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

const readablePassage = (line: string, minLength: number): boolean =>
	line.length >= minLength &&
	line.length <= 350 &&
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
const MAX_PASSAGE_LENGTH = 350;

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
// Punctuation that rides on a header cell ("NOTES:") or trails a value.
const HEADER_EDGE = /[.:,;]+$/u;
const VALUE_EDGE = /[.:,;!\s]+$/u;
// Shop prose glued to the last value ("... Brown Sugar We are thrilled to
// bring on this Washed Ethiopian!") ends the facts there.
const VALUE_PROSE = /(?<=\S)\s+(?:We|We're|We've|Our|Ours|Us)\b/u;

const isUpperToken = (token: string): boolean =>
	token.length > 0 && token === token.toUpperCase();

const isLabelRun = (line: string): boolean => {
	const tokens = line.split(/\s+/u).filter(Boolean);
	const headers = tokens.filter((token) =>
		/^[A-Z]{4,}$/u.test(token.replace(HEADER_EDGE, ""))
	).length;
	return headers >= 3 || /\bnew column\b/iu.test(line);
};

// Two-word header cells, mapped like the single-word ones.
const PAIR_LABEL_KEYS: Record<string, CatalogFactKey> = {
	"ROAST LEVEL": "roastLevel",
	"TASTING NOTES": "tastingNotes",
};

const scanLabelRun = (tokens: string[]): Map<CatalogFactKey, string> => {
	const values = new Map<CatalogFactKey, string>();
	let key: CatalogFactKey | null = null;
	let skipping = false;
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		const bare = token.replace(HEADER_EDGE, "");
		const pair = `${bare} ${(tokens[index + 1] ?? "").replace(
			HEADER_EDGE,
			""
		)}`.toUpperCase();
		if (pair === "NEW COLUMN") {
			key = null;
			skipping = true;
			index += 1;
			continue;
		}
		if (isUpperToken(token)) {
			const mapped =
				PAIR_LABEL_KEYS[pair] ?? CATALOG_LABEL_KEYS[bare.toUpperCase()];
			if (mapped !== undefined) {
				key = mapped;
				// A repeated label's second value is layout, not a correction.
				skipping = values.has(mapped);
				if (PAIR_LABEL_KEYS[pair] !== undefined) {
					index += 1;
				}
				continue;
			}
			if (bare.length >= 4 && /^[A-Z]+$/u.test(bare)) {
				// An unknown header cell: its value is layout, not coffee data.
				key = null;
				skipping = true;
				continue;
			}
		}
		if (key !== null && !skipping) {
			const current = values.get(key);
			values.set(key, current === undefined ? token : `${current} ${token}`);
		}
	}
	return values;
};

// Cut shop voice, then trailing punctuation, so the joined line keeps the
// server's own sentence ends.
const cutValue = (raw: string): string => {
	const voice = VALUE_PROSE.exec(raw);
	return (voice === null ? raw : raw.slice(0, voice.index))
		.replace(VALUE_EDGE, "")
		.trim();
};

/**
 * Joins mapped values under the fixed labels; null when nothing usable
 * maps, because a flattened sheet that stays a sheet is layout, not prose.
 * Same bar as the structured path: one roast label alone says little.
 */
const joinLabelFacts = (values: Map<CatalogFactKey, string>): string | null => {
	const facts: string[] = [];
	for (const [field, label] of FACT_LABELS) {
		const raw = values.get(field);
		if (raw === undefined) {
			continue;
		}
		const value = cutValue(raw);
		if (value.length > 0) {
			facts.push(`${label}: ${value}.`);
		}
	}
	const rawNotes = values.get("tastingNotes");
	const notes = rawNotes === undefined ? null : cutValue(rawNotes);
	if (notes === null && facts.length < 2) {
		return null;
	}
	if (notes !== null && notes.length > 0) {
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
	joinLabelFacts(scanLabelRun(line.split(/\s+/u).filter(Boolean)));

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
 * Regex fallback when structured extraction returns nothing. Keeps public
 * coffee prose only. These passages remain untrusted model input.
 */
export const enrichmentPassages = (
	markdown: string,
	existing: string
): string[] => {
	const known = normalizeProse(existing);
	const passages = markdown
		.slice(0, 30_000)
		.split(/\n\s*\n/gu)
		.map((line) => stripMarkdown(line))
		.filter((line) => {
			if (
				!(readablePassage(line, 30) && COFFEE_PROSE.test(line)) ||
				SHOP_VOICE.test(line)
			) {
				return false;
			}
			const normalized = normalizeProse(line);
			return normalized.length >= 20 && !known.includes(normalized);
		});
	return [...new Set(passages)].slice(0, 3);
};

// Firecrawl's own extraction reads the rendered page for this one coffee. It
// selects values; it does not get to write them. Every value it returns must
// appear on the page, letter for letter, or it is dropped below.
export const ENRICHMENT_PROMPT =
	"This page sells one coffee. Extract only what the roaster states about this specific coffee: its process, variety, region or origin, elevation, producer or farm, roast level, and tasting notes, plus up to five complete sentences from the product description that describe this coffee. Copy every value exactly as it appears on the page, including image captions that describe the coffee. Ignore navigation, shop-wide copy about the roaster, general coffee education, brewing guides, shipping, prices, reviews and other products. Omit a field when the page does not state it.";

export const enrichmentSchema = {
	properties: {
		elevation: { type: "string" },
		process: { type: "string" },
		producer: { type: "string" },
		region: { type: "string" },
		roastLevel: { type: "string" },
		sentences: { items: { type: "string" }, type: "array" },
		tastingNotes: { items: { type: "string" }, type: "array" },
		variety: { type: "string" },
	},
	type: "object",
} as const;

const MIN_FACT_LETTERS = 3;
const MAX_FACT_LENGTH = 120;
const MAX_NOTE_LENGTH = 60;
const MAX_NOTES = 8;
const MAX_SENTENCES = 10;

// Tolerant readers: a field of the wrong shape is ignored, not fatal.
const textField = (value: unknown, maxLength: number): string | null =>
	typeof value === "string" && value.length <= maxLength ? value : null;
const listField = (value: unknown, maxLength: number, max: number): string[] =>
	Array.isArray(value)
		? value
				.map((item) => textField(item, maxLength))
				.filter((item) => item !== null)
				.slice(0, max)
		: [];

const extractedPassages = (
	json: unknown,
	markdown: string,
	known: string
): string[] => {
	if (typeof json !== "object" || json === null) {
		return [];
	}
	const fields = json as Record<string, unknown>;
	const onPage = normalizeProse(markdown);
	const inCatalog = normalizeProse(known);
	// Verbatim on the page, new relative to the feed, and free of shop noise.
	const verified = (value: string): string | null => {
		const text = stripMarkdown(value);
		const normalized = normalizeProse(text);
		if (
			normalized.length < MIN_FACT_LETTERS ||
			!onPage.includes(normalized) ||
			inCatalog.includes(normalized) ||
			MARKUP.test(text) ||
			UNSUITABLE_PROSE.test(text)
		) {
			return null;
		}
		return text;
	};
	const facts: string[] = [];
	for (const [key, label] of FACT_LABELS) {
		const value = textField(fields[key], MAX_FACT_LENGTH);
		const text = value === null ? null : verified(value);
		if (text) {
			facts.push(`${label}: ${text}.`);
		}
	}
	const notes = listField(fields.tastingNotes, MAX_NOTE_LENGTH, MAX_NOTES)
		.map((note) => verified(note))
		.filter((note) => note !== null);
	if (notes.length > 0) {
		facts.push(`Tasting notes: ${notes.join(", ")}.`);
	}
	const passages: string[] = [];
	// One roast label alone says little; require notes or two facts.
	const factLine = facts.join(" ");
	if (
		(notes.length > 0 || facts.length >= 2) &&
		factLine.length <= MAX_PASSAGE_LENGTH
	) {
		passages.push(factLine);
	}
	for (const sentence of listField(fields.sentences, 1000, MAX_SENTENCES)) {
		const text = verified(sentence);
		if (text && readablePassage(text, 30) && !SHOP_VOICE.test(text)) {
			passages.push(text);
		}
	}
	return [...new Set(passages)].slice(0, 3);
};

/**
 * Structured page evidence. Facts are verified on the page and absent from the
 * catalog text, then joined under fixed labels into one passage; description
 * sentences follow. Falls back to the regex path when extraction yields nothing.
 */
export const pagePassages = (
	page: { json?: unknown; markdown?: string },
	known: string
): string[] => {
	const markdown = (page.markdown ?? "").slice(0, 30_000);
	const structured = extractedPassages(page.json, markdown, known);
	return structured.length > 0
		? structured
		: enrichmentPassages(markdown, known);
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
