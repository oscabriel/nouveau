import { describe, expect, test } from "vitest";

import {
	familiesOf,
	familyOf,
	normalizeTastingNote,
	TASTING_FAMILIES,
} from "./tasting";

describe("the tasting wheel as classifier (ADR-0016, amended 2026-09-21)", () => {
	test("nine families in the published order", () => {
		expect(TASTING_FAMILIES).toHaveLength(9);
		expect(TASTING_FAMILIES[0]).toBe("fruity");
		expect(TASTING_FAMILIES[8]).toBe("other");
	});

	test("every level of the wheel resolves, whatever the case or spacing", () => {
		expect(familyOf("fruity")).toBe("fruity");
		expect(familyOf("Berry")).toBe("fruity");
		expect(familyOf("  Dark   Chocolate ")).toBe("nutty/cocoa");
		expect(familyOf("alcohol/fermented")).toBe("sour/fermented");
		expect(familyOf("green/vegetative")).toBe("green/vegetative");
		expect(familyOf("Brown Spice")).toBe("spices");
		expect(familyOf("papery/musty")).toBe("other");
	});

	test("plurals and everyday spellings resolve; unknown words have no family", () => {
		expect(familyOf("Prunes")).toBe("fruity");
		expect(familyOf("cherries")).toBe("fruity");
		expect(familyOf("peaches")).toBe("fruity");
		expect(familyOf("chocolatey")).toBe("nutty/cocoa");
		expect(familyOf("caramel")).toBe("sweet");
		expect(familyOf("stone fruit")).toBe("fruity");
		expect(familyOf("Fig Danish")).toBeNull();
		expect(familyOf("")).toBeNull();
	});

	test("familiesOf dedupes and keeps the wheel's order", () => {
		expect(familiesOf(["Nutmeg", "Prunes", "raspberry", "Fig Danish"])).toEqual(
			["fruity", "spices"]
		);
		expect(familiesOf([])).toEqual([]);
	});

	test("normalizeTastingNote is the stored shape", () => {
		expect(normalizeTastingNote("  Milk   Chocolate ")).toBe("milk chocolate");
	});
});
