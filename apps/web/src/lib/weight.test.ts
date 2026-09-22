import { describe, expect, test } from "vitest";

import { formatWeight } from "./weight";

describe("formatWeight", () => {
	test("metric is grams under a kilo and kilos above", () => {
		expect(formatWeight(340, "metric")).toBe("340 g");
		expect(formatWeight(1000, "metric")).toBe("1 kg");
		expect(formatWeight(2268, "metric")).toBe("2.27 kg");
		expect(formatWeight(null, "metric")).toBeNull();
	});

	test("imperial snaps to the typical bag sizes", () => {
		expect(formatWeight(57, "imperial")).toBe("2 oz");
		expect(formatWeight(227, "imperial")).toBe("8 oz");
		expect(formatWeight(340, "imperial")).toBe("12 oz");
		expect(formatWeight(510, "imperial")).toBe("18 oz");
		expect(formatWeight(454, "imperial")).toBe("1 lb");
		expect(formatWeight(680, "imperial")).toBe("1.5 lb");
		expect(formatWeight(907, "imperial")).toBe("2 lb");
		expect(formatWeight(2268, "imperial")).toBe("5 lb");
	});

	test("imperial prints a metric-native size to one decimal", () => {
		expect(formatWeight(250, "imperial")).toBe("8.8 oz");
		expect(formatWeight(1000, "imperial")).toBe("35.3 oz");
		expect(formatWeight(null, "imperial")).toBeNull();
	});
});
