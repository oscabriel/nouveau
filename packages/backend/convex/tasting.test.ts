import { describe, expect, test } from "vitest";

import { isTastingNote, TASTING_CATEGORIES, TASTING_PICKER } from "./tasting";

describe("the tasting wheel cut (ADR-0016)", () => {
	test("the picker lists each descriptor once", () => {
		const chips = TASTING_PICKER.flatMap(({ category, notes }) => [
			category,
			...notes,
		]);
		expect(new Set(chips).size).toBe(chips.length);
		// The wheel's middle ring names floral and green/vegetative as their
		// own second-level wedge; the category chip covers them.
		expect(isTastingNote("floral")).toBe(true);
		expect(isTastingNote("green/vegetative")).toBe(true);
	});

	test("thirty-five distinct descriptors: nine categories, twenty-six notes", () => {
		const chips = TASTING_PICKER.flatMap(({ category, notes }) => [
			category,
			...notes,
		]);
		expect(TASTING_CATEGORIES).toHaveLength(9);
		expect(chips).toHaveLength(35);
	});
});
