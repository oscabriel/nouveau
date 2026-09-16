// The roaster's facts about a lot (ADR-0005): one shape per field, shared by
// the feed path (extraction.ts) and the page path (pageFacts.ts), so a
// `process` from a tag and a `process` from a scraped page pass the same
// gate. Pure: nothing here touches ctx. Process and roast level shapes stay
// in extraction.ts with their vocabularies; this module owns the rest.

import type { Infer } from "convex/values";
import { v } from "convex/values";

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

/** A lot has at most this many descriptors; the rest is prose. */
export const MAX_NOTES = 8;
/** "bittersweet chocolate" is a note; "this classic Dark Roast tastes" is not. */
export const MAX_NOTE_WORDS = 4;
export const MAX_NOTE_LENGTH = 60;
const MAX_FACT_LENGTH = 80;
const MAX_VARIETY_WORDS = 6;
const MAX_REGION_WORDS = 5;
const MAX_PRODUCER_WORDS = 8;

/** A failed or empty page read is retried no sooner than this. */
export const PAGE_FACTS_RETRY_MS = 24 * 60 * 60 * 1000;

/** Lower-case letters and digits with single spaces: the verbatim-check form. */
export const normalizeText = (text: string): string =>
	text
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

const wordCount = (text: string): number => text.split(/\s+/u).length;

/** Placeholders an extractor or a roaster writes for "no value". */
const NOT_A_VALUE =
	/^(?:not\s+(?:specified|available|listed|stated)|n\/?a|none|unknown|tbd|various|blend)$/iu;

const cleanFact = (raw: string): string | null => {
	const text = raw.trim().replaceAll(/\s+/gu, " ").replace(/\.$/u, "");
	return text === "" || text.length > MAX_FACT_LENGTH || NOT_A_VALUE.test(text)
		? null
		: text;
};

const NOTE_SEPARATOR =
	/\s*(?:,|;|•|·|\||\/|\s[-–—]\s|\s\+\s|\s&\s|\band\b)\s*/iu;
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
	copyFetchedAt?: number;
	elevation?: string;
	origin?: string;
	pageFacts?: PageFacts;
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
 * the lot has none.
 */
export const factPassage = (facts: LotFacts): string | null => {
	const parts: string[] = [];
	for (const [key, label] of FACT_LABELS) {
		const value = facts[key];
		if (value !== null) {
			parts.push(`${label}: ${value}.`);
		}
	}
	if (facts.notes.length > 0) {
		parts.push(`Tasting notes: ${facts.notes.join(", ")}.`);
	}
	return parts.length === 0 ? null : parts.join(" ");
};

/** The feed left the fields a card leans on empty. */
export const isThin = (product: FactSource): boolean => {
	const facts = mergedFacts(product);
	return (
		facts.process === null || facts.variety === null || facts.notes.length === 0
	);
};

/**
 * Whether a look at this lot should read its page (ADR-0005, option C): thin
 * after the merge, no page facts yet, and no attempt inside the retry window.
 */
export const needsPageFacts = (product: FactSource, now: number): boolean => {
	if (product.pageFacts !== undefined) {
		return false;
	}
	if (
		product.copyFetchedAt !== undefined &&
		now - product.copyFetchedAt < PAGE_FACTS_RETRY_MS
	) {
		return false;
	}
	return isThin(product);
};
