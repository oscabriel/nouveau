import { describe, expect, test } from "vitest";

import {
	FLAVOR_TERMS,
	MAX_SCANNED_TERMS,
	scanFlavorTerms,
} from "./flavorVocabulary";

describe("scanFlavorTerms", () => {
	test("distinct terms in page order, as the page spells them, longest match first", () => {
		expect(
			scanFlavorTerms(
				"Black Cherry, cocoa and a little cherry. Cocoa again, then Brown Sugar."
			)
		).toEqual(["Black Cherry", "cocoa", "cherry", "Brown Sugar"]);
	});

	test("a term inside another word is not a note: cherry-picked, and citrusy", () => {
		expect(
			scanFlavorTerms("Our cherry-picked lots are citrusy and honeyed.")
		).toEqual([]);
		expect(scanFlavorTerms("cherry-picked cherry")).toEqual(["cherry"]);
	});

	test("the everyday words every description uses are not in the vocabulary", () => {
		for (const word of ["sweet", "clean", "rich", "bright", "balanced"]) {
			expect(FLAVOR_TERMS).not.toContain(word);
		}
		expect(new Set(FLAVOR_TERMS).size).toBe(FLAVOR_TERMS.length);
	});

	test("capped at MAX_SCANNED_TERMS", () => {
		expect(scanFlavorTerms(FLAVOR_TERMS.join(". "))).toHaveLength(
			MAX_SCANNED_TERMS
		);
	});
});
