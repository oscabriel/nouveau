// The roaster's facts about a lot (ADR-0005): one shape per field, shared by
// the feed path (extraction.ts) and the page path (pageFacts.ts), so a
// `process` from a tag and a `process` from a scraped page pass the same
// gate. Pure: nothing here touches ctx. Process and roast level shapes stay
// in extraction.ts with their vocabularies; this module owns the rest.

import type { Infer } from "convex/values";
import { v } from "convex/values";

import {
	ALTITUDE_BAND_OPTIONS,
	ORIGIN_COUNTRY_OPTIONS,
	optionLabel,
	PROCESS_FAMILY_OPTIONS,
	ROAST_LEVEL_BAND_OPTIONS,
} from "./factVocabulary";

/**
 * Facts read off the roaster's rendered product page, owned by the page
 * scrape. The feed write never touches this object, so the next hourly crawl
 * cannot clear what the page said (audit D13).
 */
export const pageFactsValidator = v.object({
	elevation: v.optional(v.string()),
	process: v.optional(v.string()),
	producer: v.optional(v.string()),
	region: v.optional(v.string()),
	roastLevel: v.optional(v.string()),
	tastingNotes: v.optional(v.array(v.string())),
	variety: v.optional(v.string()),
});
export type PageFacts = Infer<typeof pageFactsValidator>;

/**
 * Jev's probability for the line it picked per page fact, kept only beside
 * a stored fact (a field the cut and the verifier dropped keeps none). It is
 * Jev's certainty that the line is the right line, before the cut and the
 * verifier; not that the cut value is right. Sibling of `pageFacts`, so
 * every reader of the facts stays untouched. Tasting notes get an
 * index-aligned array, one probability per stored note.
 */
export const pageFactConfidenceValidator = v.object({
	elevation: v.optional(v.number()),
	process: v.optional(v.number()),
	producer: v.optional(v.number()),
	region: v.optional(v.number()),
	roastLevel: v.optional(v.number()),
	tastingNotes: v.optional(v.array(v.number())),
	variety: v.optional(v.number()),
});
export type PageFactConfidence = Infer<typeof pageFactConfidenceValidator>;

/** A union of one literal per option key, so the stored field is the vocabulary's type. */
const optionUnion = <const T extends readonly [string, string, ...string[]]>(
	options: T
) =>
	v.union(
		...(options.map((option) => v.literal(option)) as {
			[K in keyof T]: ReturnType<typeof v.literal<T[K]>>;
		})
	);

/**
 * The canonical facts (ADR-0010, amended 2026-09-21): one enum per closed
 * field, chosen by Jev from factVocabulary's lists in the same request as
 * the line picks. `not_stated` is never stored; it leaves the field unset.
 * The verbatim page fact stays the display value; this is what a filter or
 * the recommendation prompt relies on.
 */
export const canonicalFactsValidator = v.object({
	altitudeBand: v.optional(optionUnion(ALTITUDE_BAND_OPTIONS)),
	originCountry: v.optional(optionUnion(ORIGIN_COUNTRY_OPTIONS)),
	processFamily: v.optional(optionUnion(PROCESS_FAMILY_OPTIONS)),
	roastLevelBand: v.optional(optionUnion(ROAST_LEVEL_BAND_OPTIONS)),
});
export type CanonicalFacts = Infer<typeof canonicalFactsValidator>;

/** Jev's probability for the chosen option, per stored canonical fact. */
export const canonicalFactConfidenceValidator = v.object({
	altitudeBand: v.optional(v.number()),
	originCountry: v.optional(v.number()),
	processFamily: v.optional(v.number()),
	roastLevelBand: v.optional(v.number()),
});
export type CanonicalFactConfidence = Infer<
	typeof canonicalFactConfidenceValidator
>;

/** The canonical facts on a stored product, empty when the page has not been read. */
export const canonicalOf = (product: {
	canonicalFacts?: CanonicalFacts;
}): CanonicalFacts => product.canonicalFacts ?? {};

/** A lot has at most this many descriptors; the rest is prose. */
export const MAX_NOTES = 8;
/** "bittersweet chocolate" is a note; "this classic Dark Roast tastes" is not. */
export const MAX_NOTE_WORDS = 4;
export const MAX_NOTE_LENGTH = 60;
const MAX_FACT_LENGTH = 80;
const MAX_VARIETY_WORDS = 6;
const MAX_REGION_WORDS = 5;
const MAX_PRODUCER_WORDS = 8;

/** A page read that left facts missing is repeated no sooner than this. */
export const PAGE_FACTS_RETRY_MS = 24 * 60 * 60 * 1000;
/**
 * Reads one lot gets before it is left as it is (ADR-0008 amendment). A
 * page that stated nothing three times apart will not state it on the
 * fourth; the cap is what stops a noteless catalog (Heart, East Pole) from
 * costing one Jev request per lot per day forever.
 */
export const MAX_PAGE_READS = 3;

/** Lower-case letters and digits with single spaces: the verbatim-check form. */
export const normalizeText = (text: string): string =>
	text
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const wordCount = (text: string): number => text.split(/\s+/u).length;

/** Placeholders an extractor or a roaster writes for "no value". */
const NOT_A_VALUE =
	/^(?:not\s+(?:specified|available|listed|stated)|n\/?a|none|unknown|tbd|varied|various(?:\s+\p{L}+)?|blend)$/iu;

const cleanFact = (raw: string): string | null => {
	const text = raw.trim().replaceAll(/\s+/gu, " ").replace(/\.$/u, "");
	return text === "" || text.length > MAX_FACT_LENGTH || NOT_A_VALUE.test(text)
		? null
		: text;
};

/** An Oxford ", &" or ", and" is one separator, so "& black tea" is never a part. */
export const NOTE_SEPARATOR =
	/\s*(?:,\s*(?:&|and\b)|,|;|•|·|\||\/|\s[-–—]\s|\s\+\s|\s&\s|\band\b)\s*/iu;
const NOTE_LEAD_IN =
	/^(?:(?:with\s+)?(?:notes?|flavou?rs?|hints?|aromas?)\s+of|tastes?\s+(?:of|like)|(?:a|an|the)\s+)+/iu;
const NOTE_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}\s'’-]*$/u;
const TRAILING_PUNCTUATION = /[.!,;:]+$/u;

/**
 * One descriptor: a lead-in ("notes of", "a") and trailing punctuation
 * stripped, then one to four words of letters. Anything sentence-shaped is
 * dropped, never stored as a note.
 */
export const verifyNote = (raw: string): string | null => {
	const text = raw
		.trim()
		.replace(NOTE_LEAD_IN, "")
		.replace(TRAILING_PUNCTUATION, "")
		.trim();
	if (
		text === "" ||
		text.length > MAX_NOTE_LENGTH ||
		!NOTE_SHAPE.test(text) ||
		wordCount(text) > MAX_NOTE_WORDS
	) {
		return null;
	}
	return text;
};

const pushDistinct = (into: string[], value: string, max: number): void => {
	if (
		into.length < max &&
		!into.some((seen) => seen.toLowerCase() === value.toLowerCase())
	) {
		into.push(value);
	}
};

/**
 * A descriptor clause ("peach, melon, and red tea", "Cherry Cola - Dried Fig",
 * "Prunes • Fig Danish • Nutmeg") as a list, each item through verifyNote.
 * A swallowed clause ("..., this classic Dark Roast tastes great") fails the
 * word cap and drops out, which is the D3 fix at the store boundary.
 */
export const splitNotes = (clause: string): string[] => {
	const notes: string[] = [];
	for (const part of clause.split(NOTE_SEPARATOR)) {
		const note = verifyNote(part);
		if (note !== null) {
			pushDistinct(notes, note, MAX_NOTES);
		}
	}
	return notes;
};

/** Verified notes from a list the page extraction returned. */
export const verifyNotes = (values: readonly string[]): string[] => {
	const notes: string[] = [];
	for (const value of values) {
		const note = verifyNote(value);
		if (note !== null) {
			pushDistinct(notes, note, MAX_NOTES);
		}
	}
	return notes;
};

/** `roasterNotes` on a stored product, empty when unset. */
export const notesList = (value?: string[]): string[] => value ?? [];

/** The notes as one display string, or null when there are none. */
export const joinNotes = (value?: string[]): string | null => {
	const notes = notesList(value);
	return notes.length === 0 ? null : notes.join(", ");
};

const ELEVATION =
	/^\d[\d,.]*(?:\s*(?:-|–|—|to)\s*\d[\d,.]*)?\s*(?:m|masl|mamsl|meters|metres|ft|feet|fasl)\b\.?$/iu;

/** "1800 MASL", "1,600 - 1,800 masl", "1500-1730masl", "1600 - 1700 m". */
export const verifyElevation = (raw: string): string | null => {
	const text = cleanFact(raw);
	return text !== null && ELEVATION.test(text) ? text : null;
};

const VARIETY_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}\s,&/'’-]*$/u;

/** "Heirloom", "SL28, SL34, Ruiru 11", "Pink Bourbon"; not a sentence. */
export const verifyVariety = (raw: string): string | null => {
	const text = cleanFact(raw);
	if (
		text === null ||
		!VARIETY_SHAPE.test(text) ||
		wordCount(text) > MAX_VARIETY_WORDS
	) {
		return null;
	}
	return text;
};

const PLACE_SHAPE = /^[\p{L}][\p{L}\s,.'’()-]*$/u;

/** A place name a few words long: "Chinacla, La Paz", "Gedeb", "Huila". */
export const verifyRegion = (raw: string): string | null => {
	const text = cleanFact(raw);
	if (
		text === null ||
		!PLACE_SHAPE.test(text) ||
		wordCount(text) > MAX_REGION_WORDS
	) {
		return null;
	}
	return text;
};

const PRODUCER_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N}\s,&'’()-]*\.?$/u;
const ARTICLE_START = /^(?:a|an|the)\s/iu;

/**
 * A name, up to eight words, no sentence punctuation, not opening with an
 * article ("a small group of producers in San Agustín, Huila" is prose).
 */
export const verifyProducer = (raw: string): string | null => {
	const text = cleanFact(raw);
	if (
		text === null ||
		!PRODUCER_SHAPE.test(text) ||
		ARTICLE_START.test(text) ||
		wordCount(text) > MAX_PRODUCER_WORDS
	) {
		return null;
	}
	return text;
};

/** The stored fields the merge reads; every one optional on `products`. */
export interface FactSource {
	canonicalFacts?: CanonicalFacts;
	copyFetchedAt?: number;
	elevation?: string;
	origin?: string;
	pageFacts?: PageFacts;
	pageReads?: number;
	process?: string;
	producer?: string;
	region?: string;
	roastLevel?: string;
	roasterNotes?: string[];
	variety?: string;
}

export interface LotFacts {
	elevation: string | null;
	notes: string[];
	origin: string | null;
	process: string | null;
	producer: string | null;
	region: string | null;
	roastLevel: string | null;
	variety: string | null;
}

/**
 * What a lot page or a candidate passage shows: feed facts win, page facts
 * fill the gaps. The feed is what the roaster publishes structurally; the
 * page is what their theme renders.
 */
export const mergedFacts = (product: FactSource): LotFacts => {
	const page: PageFacts = product.pageFacts ?? {};
	const pick = (key: Exclude<keyof PageFacts, "tastingNotes">): string | null =>
		product[key] ?? page[key] ?? null;
	const feedNotes = notesList(product.roasterNotes);
	return {
		elevation: pick("elevation"),
		notes: feedNotes.length > 0 ? feedNotes : (page.tastingNotes ?? []),
		origin: product.origin ?? null,
		process: pick("process"),
		producer: pick("producer"),
		region: pick("region"),
		roastLevel: pick("roastLevel"),
		variety: pick("variety"),
	};
};

export const FACT_LABELS = [
	["origin", "Origin"],
	["region", "Region"],
	["process", "Process"],
	["variety", "Variety"],
	["elevation", "Elevation"],
	["producer", "Producer"],
	["roastLevel", "Roast level"],
] as const;

/**
 * The facts as one evidence passage for the recommendation prompt:
 * `Process: Washed. Variety: Heirloom. Tasting notes: a, b, c.` Null when
 * the lot has none. With `canonical`, the canonical origin country and
 * process family fill in where the verbatim field is missing, labelled as
 * what they are.
 */
export const factPassage = (
	facts: LotFacts,
	canonical: CanonicalFacts = {}
): string | null => {
	const parts: string[] = [];
	for (const [key, label] of FACT_LABELS) {
		const value = facts[key];
		if (value !== null) {
			parts.push(`${label}: ${value}.`);
		}
	}
	if (facts.origin === null && canonical.originCountry !== undefined) {
		parts.push(`Origin country: ${optionLabel(canonical.originCountry)}.`);
	}
	if (facts.process === null && canonical.processFamily !== undefined) {
		parts.push(`Process family: ${optionLabel(canonical.processFamily)}.`);
	}
	if (facts.notes.length > 0) {
		parts.push(`Tasting notes: ${facts.notes.join(", ")}.`);
	}
	return parts.length === 0 ? null : parts.join(" ");
};

/**
 * A leading bag size in a variant display name ("2kg / Grind for Pour Over",
 * "250 g - Whole Bean", "12 oz"), with its separator. The weight itself lives
 * on the stored variant (grams); this only splits the grind option off the
 * name, so the size table can show the two axes separately.
 */
const VARIANT_SIZE_PREFIX =
	/^\s*\d+(?:[.,]\d+)?\s*[x×-]?\s*\d*\.?\d*\s*(?:kilo|kilos|kg|pound|pounds|lbs|lb|ounce|ounces|oz|gram|grams|gms|gm|g)\b\s*(?:[/\-–:]|\s)+/iu;

/**
 * The grind axis of a variant name: what the name says beyond its size.
 * "2kg / Grind for Pour Over" is "Grind for Pour Over"; "Whole Bean" is
 * "Whole Bean"; a plain "Default" is no grind axis at all.
 */
export const variantGrind = (name: string): string | null => {
	const text = name.trim();
	const stripped = text.replace(VARIANT_SIZE_PREFIX, "").trim();
	return stripped === "" || /^(?:default|regular)$/iu.test(stripped)
		? null
		: stripped;
};

/** The feed left the fields a card leans on empty. */
export const isThin = (product: FactSource): boolean => {
	const facts = mergedFacts(product);
	return (
		facts.process === null || facts.variety === null || facts.notes.length === 0
	);
};

/**
 * Whether the page could still add a fact: any field pageFactsValidator
 * carries is empty after the merge. This is the read rule; isThin is the
 * narrower card badge.
 */
export const hasMissingPageFacts = (product: FactSource): boolean => {
	const facts = mergedFacts(product);
	return (
		facts.elevation === null ||
		facts.process === null ||
		facts.producer === null ||
		facts.region === null ||
		facts.roastLevel === null ||
		facts.notes.length === 0 ||
		facts.variety === null
	);
};

/**
 * Whether a look at this lot should read its page (ADR-0005 option C, as
 * ADR-0008's amendment states it): a page fact is still missing after the
 * merge, the lot has been read fewer than MAX_PAGE_READS times, and no
 * attempt sits inside the retry window. Page facts already stored do not
 * settle the lot while another field is still empty.
 */
export const needsPageFacts = (product: FactSource, now: number): boolean => {
	if ((product.pageReads ?? 0) >= MAX_PAGE_READS) {
		return false;
	}
	if (
		product.copyFetchedAt !== undefined &&
		now - product.copyFetchedAt < PAGE_FACTS_RETRY_MS
	) {
		return false;
	}
	return hasMissingPageFacts(product);
};
