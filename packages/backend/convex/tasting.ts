// The tasting-note vocabulary (ADR-0016): the SCA Coffee Taster's Flavor
// Wheel, cut to its top two levels: the nine published categories and their
// twenty-eight second-level terms. Two of those terms ("floral",
// "green/vegetative") repeat their category name, so the cut is thirty-five
// distinct pickable descriptors. Level
// three (the ~100 leaf attributes) stays out: a picker that asks for four
// picks cannot browse a hundred leaves, and "fruity" alone is too coarse a
// descriptor to be worth a pick.
//
// One module for both apps. The web picker renders TASTING_CATEGORIES and
// WHEEL; the schema and every log row validate against tastingNoteValidator,
// so a pick is the same literal-union type from the picker through the
// schema to the query results. Vocabulary source: the published SCA wheel
// (SCA + World Coffee Research, 2016), term spellings as published.

import { v } from "convex/values";

/**
 * The nine top-level wheel categories, in the published wheel's order. The
 * categories themselves are pickable descriptors: "floral" is a thing a
 * taster can mean without settling on jasmine.
 */
export const TASTING_CATEGORIES = [
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

export type TastingCategory = (typeof TASTING_CATEGORIES)[number];

/**
 * Each category's second-level terms, in the wheel's order. The self-named
 * members ("floral" under Floral, "green/vegetative" under Green/Vegetative)
 * are the published wheel's middle ring, which lists the category name as
 * its own second-level wedge.
 */
const WHEEL = {
	floral: ["black tea", "floral"],
	fruity: ["berry", "citrus fruit", "dried fruit", "other fruit"],
	"green/vegetative": ["olive oil", "raw", "green/vegetative", "beany"],
	"nutty/cocoa": ["nutty", "cocoa"],
	other: ["chemical", "papery/musty"],
	roasted: ["pipe tobacco", "tobacco", "burnt", "cereal"],
	"sour/fermented": ["sour", "alcohol/fermented"],
	spices: ["pungent", "pepper", "brown spice"],
	sweet: [
		"brown sugar",
		"vanilla",
		"vanillin",
		"overall sweet",
		"sweet aromatics",
	],
} as const satisfies Record<TastingCategory, readonly string[]>;

export type TastingCategoryNote = (typeof WHEEL)[TastingCategory][number];

/** Everything a log can carry: a category or one of its level-2 terms. */
export type TastingNote = TastingCategory | TastingCategoryNote;

const CATEGORY_NOTES = (
	Object.values(WHEEL) as readonly (readonly TastingCategoryNote[])[]
).flat();

export const tastingNoteValidator = v.union(
	...TASTING_CATEGORIES.map((category) => v.literal(category)),
	...CATEGORY_NOTES.map((note) => v.literal(note))
);

/**
 * The picker's cut: category first, its second-level terms beside it. A term
 * that repeats its category name is dropped here; the category chip already
 * toggles that value, and two chips for one value would both read pressed.
 */
export const TASTING_PICKER = TASTING_CATEGORIES.map((category) => ({
	category,
	notes: (WHEEL[category] as readonly TastingCategoryNote[]).filter(
		(note) => note !== category
	),
}));

/** How many tasting notes one log may carry (ADR-0016: "capped at four"). */
export const MAX_TASTING_NOTES = 4;

/** True when the string is a wheel term; the picker's type guard on the web. */
export const isTastingNote = (value: string): value is TastingNote =>
	(TASTING_CATEGORIES as readonly string[]).includes(value) ||
	(CATEGORY_NOTES as readonly string[]).includes(value);
