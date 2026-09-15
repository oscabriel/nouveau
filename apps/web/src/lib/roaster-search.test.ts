import { describe, expect, test } from "vitest";

import { matchesRoaster } from "./roaster-search";

const sey = { city: "Brooklyn", name: "Sey", state: "NY" };
const heart = { city: "Portland", name: "Heart", state: "OR" };
const cafeLuna = { city: "São Paulo", name: "Café Luna", state: "SP" };

describe("matchesRoaster", () => {
	test("empty or whitespace search matches everything", () => {
		expect(matchesRoaster(sey, "")).toBe(true);
		expect(matchesRoaster(sey, "   ")).toBe(true);
	});

	test("matches name, city or state, ignoring case", () => {
		expect(matchesRoaster(sey, "SEY")).toBe(true);
		expect(matchesRoaster(sey, "brook")).toBe(true);
		expect(matchesRoaster(sey, "ny")).toBe(true);
		expect(matchesRoaster(heart, "sey")).toBe(false);
	});

	test("every term must hit", () => {
		expect(matchesRoaster(heart, "portland or")).toBe(true);
		expect(matchesRoaster(heart, "portland ny")).toBe(false);
	});

	test("ignores accents both ways", () => {
		expect(matchesRoaster(cafeLuna, "cafe")).toBe(true);
		expect(matchesRoaster(cafeLuna, "sao")).toBe(true);
	});
});
