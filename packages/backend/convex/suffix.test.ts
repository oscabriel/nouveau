import { expect, test } from "vitest";

import {
	assertSuffixScanBounded,
	nextFreeSuffix,
	SUFFIX_SCAN_LIMIT,
	suffixRangeEnd,
} from "./suffix";

test("nextFreeSuffix counts only exact base-<n> names as used", () => {
	expect(nextFreeSuffix("ada", [])).toBe("ada");
	expect(nextFreeSuffix("ada", ["ada"])).toBe("ada-2");
	expect(nextFreeSuffix("ada", ["ada", "ada-2", "ada-3"])).toBe("ada-4");
	// A gap is filled before the count grows.
	expect(nextFreeSuffix("ada", ["ada", "ada-3"])).toBe("ada-2");
	// Longer names that start with the base are not its suffixes.
	expect(nextFreeSuffix("ada", ["ada", "ada-lovelace-2", "adam-2"])).toBe(
		"ada-2"
	);
	// A year stem: the stem itself is the base, so its digits are not a count.
	expect(nextFreeSuffix("guji-2024", ["guji-2024"])).toBe("guji-2024-2");
	// Blocked forces the numbered form for a free base.
	expect(nextFreeSuffix("settings", [], true)).toBe("settings-2");
});

test("suffixRangeEnd bounds the family of base and base-<digits>", () => {
	const end = suffixRangeEnd("ada");
	const inRange = (name: string) => name >= "ada" && name < end;
	expect(inRange("ada")).toBe(true);
	expect(inRange("ada-2")).toBe(true);
	expect(inRange("ada-10")).toBe(true);
	expect(inRange("ada-lovelace-2")).toBe(false);
	expect(inRange("adam")).toBe(false);
	expect(inRange("ada2")).toBe(false);
});

test("assertSuffixScanBounded throws only when the scan filled its bound", () => {
	expect(() =>
		assertSuffixScanBounded(
			Array.from({ length: SUFFIX_SCAN_LIMIT - 1 }),
			"ada"
		)
	).not.toThrow();
	expect(() =>
		assertSuffixScanBounded(Array.from({ length: SUFFIX_SCAN_LIMIT }), "ada")
	).toThrow(/ada/u);
});
