/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { classifyLot, shadowCandidateFrom } from "./extraction";
import type { ShadowCandidate } from "./extraction";
import {
	CANDIDATES_PER_CRAWL,
	isLotQuestion,
	judge,
} from "./lotClassifierShadow";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = 1_800_000_000_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

/** A /v1/systemone Choice response body, as the API returns it. */
const jevBody = (
	choice: string,
	coffeeProbability: number,
	extra: { confidence?: number } = {}
): unknown => ({
	answers: {
		is_lot: {
			choice,
			confidence: 0.9,
			probabilities: {
				coffee: coffeeProbability,
				not_coffee: 1 - coffeeProbability,
			},
			type: "choice",
			...extra,
		},
	},
	model: "jev-1.13.0",
	usage: { input_tokens: 300, output_tokens: 10 },
});

/**
 * An untyped, untagged item the feed classifier rejects on `default`: the
 * shadow's subject matter. Throws, never asserts, when the classifier
 * changes out from under the fixture.
 */
const tailCandidate = (): ShadowCandidate => {
	const candidate = shadowCandidateFrom(
		classifyLot({ productType: "", tags: [], title: "Special Release" }),
		{
			bodyHtml: "<p>Sun-dried Sidamo, roasted last Tuesday.</p>",
			externalId: "42",
			productType: "",
			tags: [],
			title: "Special Release",
		}
	);
	if (candidate === null) {
		throw new Error("fixture candidate");
	}
	return candidate;
};

const stubJev = (
	choice: string,
	coffeeProbability: number
): ReturnType<typeof vi.fn> =>
	vi.fn(() =>
		Promise.resolve(
			Response.json(jevBody(choice, coffeeProbability), { status: 200 })
		)
	);

/** One roaster row, valid against the schema, for the evaluate tests. */
const insertRoaster = (
	t: ReturnType<typeof convexTest>
): Promise<Id<"roasters">> =>
	t.run(
		async (ctx) =>
			await ctx.db.insert("roasters", {
				city: "Brooklyn",
				claimed: false,
				domain: "coffee.example.com",
				name: "Fixture roaster",
				productPageUrl: "https://coffee.example.com/collections/coffee",
				slug: "fixture",
				source: "curated",
				state: "NY",
				status: "active",
				websiteUrl: "https://coffee.example.com",
			})
	);

test("isLotQuestion is a Choice over the fixed lot vocabulary", () => {
	const question = isLotQuestion();
	expect(question.is_lot.type).toBe("choice");
	expect(Object.keys(question.is_lot.criteria)).toEqual(["coffee", "not_coffee"]);
	// The instructions name the state path Jev reads.
	expect(question.is_lot.instructions).toContain("`item`");
});

test("shadowCandidateFrom captures the default tail and nothing else", () => {
	expect(tailCandidate()).toEqual({
		description: "Sun-dried Sidamo, roasted last Tuesday.",
		externalId: "42",
		title: "Special Release",
	});
	// A named reject carries its reason; no second opinion needed.
	expect(
		shadowCandidateFrom(
			classifyLot({
				productType: "Merch",
				tags: [],
				title: "Tote",
			}),
			{ externalId: "43", title: "Tote" }
		)
	).toBeNull();
	// A lot is never a candidate.
	expect(
		shadowCandidateFrom(
			classifyLot({ productType: "Coffee", tags: [], title: "Lot" }),
			{
				externalId: "44",
			}
		)
	).toBeNull();
	// Nothing to judge without a title or an id.
	expect(
		shadowCandidateFrom(classifyLot({ productType: "", tags: [], title: "" }), {
			externalId: "45",
		})
	).toBeNull();
	expect(
		shadowCandidateFrom(
			classifyLot({ productType: "", tags: [], title: "Tote" }),
			{
				externalId: "",
			}
		)
	).toBeNull();
});

test("judge reads a well-formed Choice answer, model string included", async () => {
	const fetchMock = stubJev("not_coffee", 0.04);
	vi.stubGlobal("fetch", fetchMock);
	const verdict = await judge("key", tailCandidate());
	expect(fetchMock.mock.calls[0]?.[0]).toBe(
		"https://api.typesafe.ai/v1/systemone"
	);
	const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
	const payload = JSON.parse(String(init.body)) as {
		model: string;
		questions: Record<string, unknown>;
		state: { item: Record<string, unknown> };
	};
	expect(payload.model).toBe("jev-1.13.0");
	expect(Object.keys(payload.questions)).toEqual(["is_lot"]);
	expect(payload.state.item.title).toBe("Special Release");
	expect(payload.state.item.description).toContain("Sun-dried Sidamo");
	expect(verdict).toEqual({
		coffeeProbability: 0.04,
		confidence: 0.9,
		jevChoice: "not_coffee",
		model: "jev-1.13.0",
	});
});

test("judge returns null on an API error and an out-of-set answer", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.resolve(new Response("nope", { status: 500 })))
	);
	expect(await judge("key", tailCandidate())).toBeNull();
	vi.stubGlobal(
		"fetch",
		vi.fn(() =>
			Promise.resolve(Response.json(jevBody("maybe", 0.5), { status: 200 }))
		)
	);
	expect(await judge("key", tailCandidate())).toBeNull();
});

test("evaluate is a no-op without TYPESAFE_API_KEY, and stores verdicts with it", async () => {
	const t = convexTest(schema, modules);
	const roasterId = await insertRoaster(t);
	const candidate = tailCandidate();

	// No key: nothing stored, nothing fetched.
	const fetchMock = stubJev("not_coffee", 0.04);
	vi.stubGlobal("fetch", fetchMock);
	await t.action(internal.lotClassifierShadow.evaluate, {
		candidates: [candidate],
		roasterId,
	});
	expect(fetchMock).not.toHaveBeenCalled();
	expect(await t.query(internal.lotClassifierShadow.agreement)).toEqual({
		agreed: 0,
		coffee: 0,
		disagreements: [],
		sampled: 0,
	});

	// With a key, the verdict lands and agrees with the regex's rejection.
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
	await t.action(internal.lotClassifierShadow.evaluate, {
		candidates: [candidate],
		roasterId,
	});
	const tally = await t.query(internal.lotClassifierShadow.agreement);
	expect(tally.sampled).toBe(1);
	expect(tally.agreed).toBe(1);
	expect(tally.coffee).toBe(0);
});

test("evaluate skips candidates that already have a verdict", async () => {
	const t = convexTest(schema, modules);
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
	const fetchMock = stubJev("coffee", 0.86);
	vi.stubGlobal("fetch", fetchMock);
	const roasterId = await insertRoaster(t);
	const candidate = tailCandidate();
	await t.action(internal.lotClassifierShadow.evaluate, {
		candidates: [candidate],
		roasterId,
	});
	await t.action(internal.lotClassifierShadow.evaluate, {
		candidates: [candidate],
		roasterId,
	});
	// One request, one row, even though the crawl ran twice.
	expect(fetchMock).toHaveBeenCalledTimes(1);
	const tally = await t.query(internal.lotClassifierShadow.agreement);
	expect(tally.sampled).toBe(1);
	expect(tally.coffee).toBe(1);
	expect(tally.agreed).toBe(0);
	// The disagreement sample names the title so it can be read by hand.
	expect(tally.disagreements).toEqual([
		{ coffeeProbability: 0.86, title: "Special Release" },
	]);
});

test("a failed Jev call stores nothing and the next crawl retries", async () => {
	const t = convexTest(schema, modules);
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.reject(new Error("boom")))
	);
	const roasterId = await insertRoaster(t);
	await t.action(internal.lotClassifierShadow.evaluate, {
		candidates: [tailCandidate()],
		roasterId,
	});
	expect(await t.query(internal.lotClassifierShadow.agreement)).toEqual({
		agreed: 0,
		coffee: 0,
		disagreements: [],
		sampled: 0,
	});
});

test("evaluate bounds one crawl's spend at CANDIDATES_PER_CRAWL requests", async () => {
	const t = convexTest(schema, modules);
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
	const fetchMock = stubJev("not_coffee", 0.04);
	vi.stubGlobal("fetch", fetchMock);
	const roasterId = await insertRoaster(t);
	const candidates = Array.from(
		{ length: CANDIDATES_PER_CRAWL + 10 },
		(_, i) => ({
			...tailCandidate(),
			externalId: String(i),
		})
	);
	await t.action(internal.lotClassifierShadow.evaluate, {
		candidates,
		roasterId,
	});
	expect(fetchMock).toHaveBeenCalledTimes(CANDIDATES_PER_CRAWL);
});
