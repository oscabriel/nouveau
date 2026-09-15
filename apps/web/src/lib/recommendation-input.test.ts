import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { expect, test } from "vitest";

import {
	buildRecommendationInput,
	DEFAULT_MIN_GRAMS,
} from "./recommendation-input";

const base = {
	budget: "",
	includeNotes: false,
	logIds: ["log1" as Id<"logs">],
	preferences: "  something floral ",
};

test("an untouched bag size sends the 200 g default", () => {
	expect(DEFAULT_MIN_GRAMS).toBe(200);
	expect(
		buildRecommendationInput({ ...base, grams: String(DEFAULT_MIN_GRAMS) })
	).toEqual({
		includeNotes: false,
		logIds: ["log1"],
		minGrams: 200,
		preferences: "something floral",
	});
});

test("a cleared bag size means any confirmed size and is omitted", () => {
	const input = buildRecommendationInput({ ...base, grams: "" });
	expect(input).not.toHaveProperty("minGrams");
	expect(input).not.toHaveProperty("maxPriceCents");
});

test("a typed bag size and budget are sent as grams and cents", () => {
	expect(
		buildRecommendationInput({ ...base, budget: "18.5", grams: "340" })
	).toMatchObject({ maxPriceCents: 1850, minGrams: 340 });
});
