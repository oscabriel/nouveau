import { expect, test } from "vitest";

import { nextFreeSuffix } from "./suffix";

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
