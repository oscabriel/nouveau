import { describe, expect, test } from "vitest";

import {
	CANONICAL_FIELDS,
	NOT_STATED,
	optionLabel,
	VOCABULARY_CHOICES,
} from "./factVocabulary";

const OPTION_KEY = /^[a-z0-9_]+$/u;

describe("factVocabulary", () => {
	test("one Choice per canonical field, each naming the coffee", () => {
		expect(new Set(VOCABULARY_CHOICES.map((choice) => choice.id))).toEqual(
			new Set(CANONICAL_FIELDS)
		);
		expect(VOCABULARY_CHOICES).toHaveLength(CANONICAL_FIELDS.length);
		for (const choice of VOCABULARY_CHOICES) {
			expect(choice.instructions).toContain("%COFFEE%");
		}
	});

	test("every criteria map ends in not_stated, which is not a storable option", () => {
		for (const choice of VOCABULARY_CHOICES) {
			const keys = Object.keys(choice.criteria);
			expect(choice.options).not.toContain(NOT_STATED);
			expect([...choice.options, NOT_STATED]).toEqual(keys);
		}
	});

	test("option keys are distinct lower-case snake_case with a description each", () => {
		for (const choice of VOCABULARY_CHOICES) {
			const keys = Object.keys(choice.criteria);
			expect(new Set(keys).size).toBe(keys.length);
			for (const key of keys) {
				expect(key).toMatch(OPTION_KEY);
				expect(choice.criteria[key]).not.toBe("");
			}
		}
	});

	test("optionLabel reads a key as words", () => {
		expect(optionLabel("papua_new_guinea")).toBe("Papua New Guinea");
		expect(optionLabel("washed")).toBe("Washed");
		expect(optionLabel("from_1400_to_1800")).toBe("From 1400 To 1800");
	});
});
