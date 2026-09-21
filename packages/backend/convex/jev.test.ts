import { describe, expect, test } from "vitest";

import { jevChoice, pickProbability, runnerUp } from "./jev";

const LINES = ["Process: Natural", "Variety: Heirloom", "none"];

describe("jevChoice", () => {
	test("keeps a well-formed probabilities map beside the pick", () => {
		const chosen = jevChoice(
			{
				choice: "Process: Natural",
				confidence: 0.83,
				probabilities: {
					"Process: Natural": 0.83,
					"Variety: Heirloom": 0.12,
					none: 0.05,
				},
				type: "choice",
			},
			LINES
		);
		expect(chosen).toEqual({
			choice: "Process: Natural",
			confidence: 0.83,
			probabilities: {
				"Process: Natural": 0.83,
				"Variety: Heirloom": 0.12,
				none: 0.05,
			},
		});
	});

	test("drops the map when a key was never sent, and when a value is not a number", () => {
		const foreignKey = jevChoice(
			{
				choice: "none",
				probabilities: { "Roast: Light": 0.1, none: 0.9 },
			},
			LINES
		);
		expect(foreignKey).toEqual({ choice: "none" });
		const badValue = jevChoice(
			{
				choice: "none",
				confidence: 0.7,
				probabilities: { none: "0.9" },
			},
			LINES
		);
		expect(badValue).toEqual({ choice: "none", confidence: 0.7 });
		const notAMap = jevChoice({ choice: "none", probabilities: 3 }, LINES);
		expect(notAMap).toEqual({ choice: "none" });
	});

	test("a choice outside the sent options is a protocol error, whatever the map says", () => {
		expect(
			jevChoice(
				{ choice: "Roast: Light", probabilities: { "Roast: Light": 1 } },
				LINES
			)
		).toBeNull();
		expect(jevChoice(null, LINES)).toBeNull();
		expect(jevChoice({ choice: 4 }, LINES)).toBeNull();
	});
});

describe("runnerUp", () => {
	test("the highest option other than the pick", () => {
		expect(
			runnerUp(
				{ "Process: Natural": 0.83, "Variety: Heirloom": 0.12, none: 0.05 },
				"Process: Natural"
			)
		).toEqual({ option: "Variety: Heirloom", probability: 0.12 });
	});

	test("null with one option, with every other option at zero, with an empty map, and without a map", () => {
		expect(runnerUp({ none: 1 }, "none")).toBeNull();
		expect(runnerUp({ a: 1, b: 0 }, "a")).toBeNull();
		expect(runnerUp({}, "none")).toBeNull();
		expect(runnerUp(undefined, "none")).toBeNull();
	});
});

describe("pickProbability", () => {
	test("the distribution's value for the pick first, the answer's confidence second, else nothing", () => {
		expect(
			pickProbability({
				choice: "a",
				confidence: 0.5,
				probabilities: { a: 0.7, b: 0.3 },
			})
		).toBe(0.7);
		expect(pickProbability({ choice: "a", confidence: 0.5 })).toBe(0.5);
		expect(pickProbability({ choice: "a" })).toBeUndefined();
	});
});
