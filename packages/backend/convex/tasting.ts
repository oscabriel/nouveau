// The tasting-note vocabulary (ADR-0016, amended 2026-09-21). A log's
// tasting notes are the taster's own words, free text, up to
// MAX_TASTING_NOTES of them. The SCA Coffee Taster's Flavor Wheel (SCA +
// World Coffee Research, 2016) stays as the classifier: every wheel term,
// all three levels plus a short list of the words tasters type that the
// wheel spells differently, maps to one of the nine top-level families.
// familyOf() is that lookup; a word the wheel does not know has no family
// and renders uncolored. No model is involved: the wheel's own structure
// gives the assignment for free.
//
// One module for both apps. The web renders TASTING_FAMILIES for the pill
// colors and the /drops filter; the schema stores strings; feed cards and
// log cards carry the families their notes resolve to.

import { v } from "convex/values";

/**
 * The nine top-level wheel families, in the published wheel's order.
 */
export const TASTING_FAMILIES = [
	"fruity",
	"floral",
	"sweet",
	"nutty/cocoa",
	"spices",
	"roasted",
	"sour/fermented",
	"green/vegetative",
	"other",
] as const;

export type TastingFamily = (typeof TASTING_FAMILIES)[number];

export const tastingFamilyValidator = v.union(
	...TASTING_FAMILIES.map((family) => v.literal(family))
);

/** A stored tasting note: the taster's word, trimmed and lowercased. */
export const tastingNoteValidator = v.string();

/** How many tasting notes one log may carry. Was four with the picker. */
export const MAX_TASTING_NOTES = 8;

/** The longest stored note; "alcohol/fermented" is 17, "meaty brothy" 12. */
export const MAX_TASTING_NOTE_LENGTH = 32;

/**
 * Every wheel term under its family: the second-level wedges, their
 * leaves, and the everyday spellings tasters use for them (chocolatey,
 * caramel, stone fruit, tropical). Spellings as published where the wheel
 * has one.
 */
const WHEEL: Record<TastingFamily, readonly string[]> = {
	floral: [
		"floral",
		"black tea",
		"chamomile",
		"rose",
		"jasmine",
		"tea",
		"tea-like",
		"lavender",
		"hibiscus",
		"elderflower",
		"honeysuckle",
		"orange blossom",
		"bergamot",
		"perfume",
	],
	fruity: [
		"fruity",
		"fruit",
		"berry",
		"berries",
		"blackberry",
		"raspberry",
		"blueberry",
		"strawberry",
		"dried fruit",
		"raisin",
		"prune",
		"other fruit",
		"coconut",
		"cherry",
		"pomegranate",
		"pineapple",
		"grape",
		"apple",
		"peach",
		"pear",
		"citrus fruit",
		"citrus",
		"grapefruit",
		"orange",
		"lemon",
		"lime",
		"stone fruit",
		"tropical",
		"tropical fruit",
		"mango",
		"passion fruit",
		"passionfruit",
		"lychee",
		"plum",
		"apricot",
		"nectarine",
		"fig",
		"date",
		"tangerine",
		"mandarin",
		"clementine",
		"black currant",
		"blackcurrant",
		"currant",
		"cranberry",
		"guava",
		"papaya",
		"banana",
		"melon",
		"watermelon",
		"kiwi",
		"green apple",
		"red apple",
		"rhubarb",
		"jammy",
		"jam",
		"juicy",
		"cola",
	],
	"green/vegetative": [
		"green/vegetative",
		"green",
		"vegetative",
		"vegetal",
		"olive oil",
		"raw",
		"under-ripe",
		"underripe",
		"peapod",
		"fresh",
		"dark green",
		"hay-like",
		"hay",
		"herb-like",
		"herbal",
		"herbaceous",
		"grassy",
		"grass",
		"beany",
		"cucumber",
		"tomato",
	],
	"nutty/cocoa": [
		"nutty/cocoa",
		"nutty",
		"nuts",
		"nut",
		"peanuts",
		"peanut",
		"hazelnut",
		"almond",
		"walnut",
		"pecan",
		"cashew",
		"marzipan",
		"cocoa",
		"cacao",
		"chocolate",
		"chocolatey",
		"chocolaty",
		"dark chocolate",
		"milk chocolate",
		"baker's chocolate",
		"bakers chocolate",
		"cocoa nib",
		"cocoa nibs",
		"nutella",
	],
	other: [
		"other",
		"chemical",
		"bitter",
		"salty",
		"medicinal",
		"petroleum",
		"skunky",
		"rubber",
		"papery/musty",
		"papery",
		"stale",
		"cardboard",
		"woody",
		"wood",
		"cedar",
		"moldy/damp",
		"moldy",
		"musty/dusty",
		"musty/earthy",
		"musty",
		"earthy",
		"animalic",
		"meaty brothy",
		"meaty",
		"brothy",
		"savory",
		"umami",
		"phenolic",
		"mineral",
		"minerally",
	],
	roasted: [
		"roasted",
		"roasty",
		"pipe tobacco",
		"tobacco",
		"burnt",
		"acrid",
		"ashy",
		"smoky",
		"smokey",
		"smoke",
		"brown roast",
		"cereal",
		"grain",
		"graham",
		"graham cracker",
		"malt",
		"malty",
		"toast",
		"toasty",
		"bread",
		"biscuit",
		"oat",
		"oats",
	],
	"sour/fermented": [
		"sour/fermented",
		"sour",
		"sour aromatics",
		"acetic acid",
		"acetic",
		"butyric acid",
		"isovaleric acid",
		"citric acid",
		"citric",
		"malic acid",
		"malic",
		"tart",
		"tangy",
		"alcohol/fermented",
		"alcohol",
		"fermented",
		"fermenty",
		"funky",
		"funk",
		"winey",
		"winy",
		"wine",
		"red wine",
		"whiskey",
		"whisky",
		"bourbon",
		"rum",
		"boozy",
		"overripe",
		"yogurt",
		"lactic",
		"kombucha",
		"cider",
	],
	spices: [
		"spices",
		"spice",
		"spicy",
		"pungent",
		"pepper",
		"black pepper",
		"peppery",
		"brown spice",
		"anise",
		"star anise",
		"licorice",
		"nutmeg",
		"cinnamon",
		"clove",
		"cloves",
		"cardamom",
		"ginger",
		"allspice",
		"baking spice",
		"baking spices",
		"chai",
	],
	sweet: [
		"sweet",
		"sweetness",
		"brown sugar",
		"molasses",
		"maple syrup",
		"maple",
		"caramelized",
		"caramelised",
		"caramel",
		"honey",
		"vanilla",
		"vanillin",
		"overall sweet",
		"sweet aromatics",
		"toffee",
		"butterscotch",
		"brown butter",
		"butter",
		"buttery",
		"cream",
		"creamy",
		"sugar",
		"sugar cane",
		"candy",
		"candied",
		"marshmallow",
		"nougat",
		"praline",
		"dulce de leche",
		"panela",
		"demerara",
		"syrup",
		"syrupy",
		"honeyed",
		"cake",
		"pastry",
		"custard",
		"milk",
	],
};

const FAMILY_BY_TERM = new Map<string, TastingFamily>();
for (const family of TASTING_FAMILIES) {
	for (const term of WHEEL[family]) {
		FAMILY_BY_TERM.set(term, family);
	}
}

/** Trim, lowercase, collapse inner whitespace: the stored shape of a note. */
export const normalizeTastingNote = (note: string): string =>
	note.trim().toLowerCase().replaceAll(/\s+/gu, " ");

/**
 * The wheel family a note belongs to, or null when the wheel does not know
 * the word. Exact match on the normalized note first, then the singular
 * ("cherries" to "cherry", "plums" to "plum").
 */
export const familyOf = (note: string): TastingFamily | null => {
	const term = normalizeTastingNote(note);
	const exact = FAMILY_BY_TERM.get(term);
	if (exact !== undefined) {
		return exact;
	}
	if (term.endsWith("ies")) {
		const singular = FAMILY_BY_TERM.get(`${term.slice(0, -3)}y`);
		if (singular !== undefined) {
			return singular;
		}
	}
	if (term.endsWith("es")) {
		const singular = FAMILY_BY_TERM.get(term.slice(0, -2));
		if (singular !== undefined) {
			return singular;
		}
	}
	if (term.endsWith("s")) {
		return FAMILY_BY_TERM.get(term.slice(0, -1)) ?? null;
	}
	return null;
};

/** The distinct families a list of notes resolves to, in wheel order. */
export const familiesOf = (notes: readonly string[]): TastingFamily[] => {
	const found = new Set<TastingFamily>();
	for (const note of notes) {
		const family = familyOf(note);
		if (family !== null) {
			found.add(family);
		}
	}
	return TASTING_FAMILIES.filter((family) => found.has(family));
};
