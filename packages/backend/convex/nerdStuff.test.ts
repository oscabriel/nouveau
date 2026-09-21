import { MINUTE } from "@convex-dev/rate-limiter";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	feedTrace,
	pickLots,
	RUN_RETENTION_MS,
	TRACE_RETENTION_MS,
} from "./nerdStuff";
import { MAX_READ_DEFERRALS } from "./pageFacts";
import { MAX_RUN_LOTS } from "./pipelineTrace";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

const SHOP = "https://sey.example.com";
const PAGE_HTML = [
	"<html><body><main><h1>Mullugeta</h1>",
	"<p>Process: Natural</p><p>Variety: Heirloom</p>",
	"<p>Altitude: 1,900 - 2,100 masl</p>",
	"<p>Tasting notes: peach, melon, red tea.</p>",
	"<p>Mullugeta Muntasha's washing station sits above Yirgacheffe town. Cherries are sorted by hand, fermented for 48 hours and dried slowly on raised beds for three weeks.</p></main>",
	"</body></html>",
].join("\n");
const PICKS: Record<string, RegExp> = {
	canon_originCountry: /^ethiopia$/u,
	canon_processFamily: /^natural$/u,
	elevation: /1,900/u,
	process: /Natural/u,
	variety: /Heirloom/u,
};
const NOTE_YES = /"(?:peach|melon|red tea)"|peach/u;

interface ProviderOptions {
	/** Firecrawl's HTTP status; 429 is its rate limit. */
	firecrawlStatus?: number;
	/** The shop's own page; null means the shop errors. */
	html?: string | null;
	jev?: boolean;
}

/** Firecrawl renders any product page of the shop; the shop serves it too; Jev picks the spec lines. */
const stubProviders = ({
	firecrawlStatus = 200,
	html = PAGE_HTML,
	jev = true,
}: ProviderOptions = {}) => {
	const fetchMock = vi.fn((url: string, init?: RequestInit) => {
		if (url.startsWith(`${SHOP}/products/`)) {
			if (html === null) {
				return new Response("shop down", { status: 500 });
			}
			const response = new Response(html, {
				headers: { "content-type": "text/html; charset=utf-8" },
				status: 200,
			});
			Object.defineProperty(response, "url", { value: url });
			return response;
		}
		if (url.includes("firecrawl")) {
			if (firecrawlStatus !== 200) {
				return new Response("Rate limit exceeded", {
					headers: { "retry-after": "0" },
					status: firecrawlStatus,
				});
			}
			const asked = (JSON.parse(String(init?.body)) as { url: string }).url;
			return Response.json({
				data: {
					html: PAGE_HTML,
					metadata: { sourceURL: asked, statusCode: 200 },
				},
				success: true,
			});
		}
		if (url.includes("typesafe")) {
			if (!jev) {
				return new Response("nope", { status: 500 });
			}
			const body = JSON.parse(String(init?.body)) as {
				questions: Record<
					string,
					{
						criteria?: Record<string, string | null>;
						instructions: string;
						type: string;
					}
				>;
			};
			const answers: Record<string, unknown> = {};
			for (const [key, question] of Object.entries(body.questions)) {
				if (question.type === "choice") {
					const wanted = PICKS[key];
					const line = Object.keys(question.criteria ?? {}).find((option) =>
						wanted === undefined ? false : wanted.test(option)
					);
					const choice =
						line ?? (key.startsWith("canon_") ? "not_stated" : "none");
					answers[key] = {
						choice,
						probabilities: { [choice]: 0.7, none: 0.3 },
						type: "choice",
					};
				} else {
					answers[key] = {
						noul: NOTE_YES.test(question.instructions) ? 0.9 : 0.1,
						type: "noul",
					};
				}
			}
			return Response.json({ answers, model: "jev-1.13.0" });
		}
		throw new Error(`Unexpected fetch ${url}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

interface Fixture {
	lotIds: Id<"products">[];
	otherId: Id<"users">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
	userId: Id<"users">;
}

const setup = async (lotCount = 2): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	registerFirecrawl(t);
	const ids = await t.run(async (ctx) => {
		const userId = await ctx.db.insert("users", {
			name: "One",
			providerAccountId: "one",
		});
		const otherId = await ctx.db.insert("users", {
			name: "Two",
			providerAccountId: "two",
		});
		const roasterId = await ctx.db.insert("roasters", {
			city: "Brooklyn",
			claimed: false,
			domain: "sey.example.com",
			name: "Sey",
			productPageUrl: `${SHOP}/collections/coffee`,
			slug: "sey",
			source: "curated",
			state: "NY",
			status: "active",
			websiteUrl: SHOP,
		});
		const lotIds: Id<"products">[] = [];
		for (let i = 0; i < lotCount; i += 1) {
			lotIds.push(
				// oxlint-disable-next-line no-await-in-loop -- fixture rows in order
				await ctx.db.insert("products", {
					description: "Notes of peach and melon. Grown in Yirgacheffe.",
					externalId: `p${i}`,
					firstSeenAt: 1000 + i,
					handle: `lot-${i}`,
					lastSeenAt: 1000,
					missedCrawls: 0,
					name: `Ethiopia Lot ${i}`,
					origin: "Ethiopia",
					roasterId,
					status: "current",
					tags: ["Natural"],
				})
			);
		}
		return { lotIds, otherId, roasterId, userId };
	});
	return { ...ids, t };
};

const getRun = (fx: Fixture, runId: Id<"pipelineRuns">) =>
	fx.t.run((ctx) => ctx.db.get(runId));
const allTraces = (fx: Fixture) =>
	fx.t.run((ctx) => ctx.db.query("pipelineTraces").collect());
const pending = (fx: Fixture) =>
	fx.t.run(async (ctx) => {
		const rows = await ctx.db.system.query("_scheduled_functions").collect();
		return rows.filter((row) => row.state.kind === "pending");
	});
/** Scheduled work other than the watchdog. */
const pendingLoop = async (fx: Fixture) => {
	const rows = await pending(fx);
	return rows.filter((row) => !row.name.endsWith(":expire"));
};
/**
 * Run the loop to its end the way the scheduler would: each step in turn,
 * the clock moved to the next one. `runAllTimers` would fire the watchdog
 * before the first lot's action had returned.
 */
const drive = async (fx: Fixture): Promise<void> => {
	for (let step = 0; step < 60; step += 1) {
		// oxlint-disable-next-line no-await-in-loop -- steps are sequential by nature
		await fx.t.finishInProgressScheduledFunctions();
		// oxlint-disable-next-line no-await-in-loop -- see above
		const next = await pendingLoop(fx);
		if (next.length === 0) {
			return;
		}
		const soonest = Math.min(...next.map((row) => row.scheduledTime));
		vi.advanceTimersByTime(Math.max(1, soonest - Date.now() + 1));
	}
	throw new Error("the loop did not end");
};

/** A product row for pickLots, outside the database. */
const lot = (i: number, extra: Partial<Doc<"products">> = {}) =>
	({
		_creationTime: 0,
		_id: `lot${i}` as Id<"products">,
		externalId: `p${i}`,
		firstSeenAt: i,
		handle: `h${i}`,
		lastSeenAt: 0,
		name: `Lot ${i}`,
		roasterId: "r" as Id<"roasters">,
		status: "current",
		...extra,
	}) as Doc<"products">;

describe("nerdStuff.start", () => {
	test("refuses signed out", async () => {
		const fx = await setup();
		await expect(
			fx.t.mutation(api.nerdStuff.start, { roasterId: fx.roasterId })
		).rejects.toThrow("Sign in required");
	});

	test("one run at a time, deployment-wide", async () => {
		const fx = await setup();
		stubProviders();
		await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		await expect(
			asUser(fx.t, fx.otherId).mutation(api.nerdStuff.start, {
				roasterId: fx.roasterId,
			})
		).rejects.toThrow("already going");
	});

	test("picks at most MAX_RUN_LOTS lots, those missing a page fact first, newest first", () => {
		const roaster = { websiteUrl: SHOP };
		const complete = {
			elevation: "1900 masl",
			process: "Washed",
			producer: "Someone",
			region: "Yirgacheffe",
			roastLevel: "Light",
			roasterNotes: ["peach"],
			variety: "Heirloom",
		};
		const lots = [
			lot(1, complete),
			lot(2),
			lot(3, complete),
			lot(4),
			...Array.from({ length: 12 }, (_, i) => lot(10 + i)),
		];
		const picked = pickLots(roaster, lots);
		expect(picked).toHaveLength(MAX_RUN_LOTS);
		// The twelve newest thin lots fill the run before either complete one.
		expect(picked[0]).toBe("lot21");
		expect(picked).not.toContain("lot1");
		expect(picked).not.toContain("lot3");
		// A lot with no page is never picked.
		expect(pickLots({ websiteUrl: "not a url" }, [lot(1)])).toEqual([]);
	});

	test("the run starts running at index 0 with a watchdog and a scheduled first lot", async () => {
		const fx = await setup();
		stubProviders();
		const runId = await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		const run = await getRun(fx, runId);
		expect(run).toMatchObject({
			commit: false,
			index: 0,
			status: "running",
			total: 2,
			userId: fx.userId,
		});
		expect(run?.expireId).toBeDefined();
		expect(await pending(fx)).toHaveLength(2);
		expect(await fx.t.query(api.nerdStuff.latestRun, {})).toMatchObject({
			_id: runId,
		});
	});
});

describe("nerdStuff.runLot", () => {
	test("reads every lot, writes one trace each with feed, picks and notes, marks the run done and cancels the watchdog", async () => {
		const fx = await setup();
		stubProviders();
		const runId = await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		await drive(fx);
		const run = await getRun(fx, runId);
		expect(run?.currentStage).toBeUndefined();
		expect(run).toMatchObject({
			deferred: 0,
			failed: 0,
			index: 2,
			jevRequests: 2,
			read: 2,
			status: "done",
		});
		expect(run?.jevQuestions).toBeGreaterThan(0);
		// The watchdog went with the run.
		expect(await pending(fx)).toHaveLength(0);
		const traces = await fx.t.query(api.nerdStuff.traces, { runId });
		expect(traces).toHaveLength(2);
		// Newest lot first (pickLots), so lot 1 was read before lot 0.
		expect(traces.map((row) => row.productId)).toEqual([
			fx.lotIds[1],
			fx.lotIds[0],
		]);
		const [first, second] = traces;
		expect(first).toMatchObject({
			feed: { isLot: true },
			model: "jev-1.13.0",
			outcome: "read",
			runId,
			source: "firecrawl",
		});
		expect(first?.feed?.attributes).toEqual(
			expect.arrayContaining([{ field: "process", value: "Natural" }])
		);
		expect(first?.gate).toBeUndefined();
		expect(first?.picks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					cut: "Natural",
					field: "process",
					kept: true,
					probability: 0.7,
					runnerUp: { option: "none", probability: 0.3 },
				}),
				expect.objectContaining({ field: "producer", kept: false }),
			])
		);
		expect(first?.canonical).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					choice: "ethiopia",
					field: "originCountry",
				}),
				expect.objectContaining({
					choice: "not_stated",
					field: "roastLevelBand",
				}),
			])
		);
		expect(first?.notes).toEqual(
			expect.arrayContaining([
				{ kept: true, note: "peach", probability: 0.9 },
				{ kept: true, note: "melon", probability: 0.9 },
			])
		);
		expect(first?.sentences.length).toBeGreaterThan(0);
		expect(first?.sentences.every((row) => row.probability >= 0)).toBe(true);
		expect(first?.stages.page).toEqual(expect.any(Number));
		expect(first?.stages.jev).toEqual(expect.any(Number));
		// The minute's one Firecrawl token went to the first lot; the second
		// came from the shop itself, no deferral.
		expect(second?.source).toBe("plain");
		// A run is a viewer: nothing stored without commit.
		for (const lotId of fx.lotIds) {
			// oxlint-disable-next-line no-await-in-loop -- two lookups
			const row = await fx.t.run((ctx) => ctx.db.get(lotId));
			expect(row?.pageFacts).toBeUndefined();
			expect(row?.pageReads).toBeUndefined();
		}
		const recent = await fx.t.query(api.nerdStuff.recentTraces, {});
		expect(recent).toHaveLength(2);
		expect(recent[0]).toMatchObject({ handle: "lot-0", roasterSlug: "sey" });
	});

	test("commit: true stores the read's facts on the product", async () => {
		const fx = await setup(1);
		stubProviders();
		await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			commit: true,
			roasterId: fx.roasterId,
		});
		await drive(fx);
		const row = await fx.t.run((ctx) =>
			ctx.db.get(fx.lotIds[0] as Id<"products">)
		);
		expect(row?.pageFacts).toMatchObject({ process: "Natural" });
		expect(row?.canonicalFacts).toMatchObject({ originCountry: "ethiopia" });
		expect(row?.pageReads).toBe(1);
	});

	test("a deferred read runs again at the same index and counts on the run; the trace waits for the end", async () => {
		const fx = await setup(1);
		stubProviders({ firecrawlStatus: 429, html: null });
		const runId = await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		// Start scheduled runLot at 0 and the watchdog; run just the lot.
		await fx.t.action(internal.nerdStuff.runLot, { index: 0, runId });
		const run = await getRun(fx, runId);
		expect(run).toMatchObject({
			currentStage: "page",
			deferred: 1,
			index: 0,
			message: "waiting for the Firecrawl budget",
			status: "running",
		});
		expect(await allTraces(fx)).toHaveLength(0);
		const loop = await pendingLoop(fx);
		const retry = loop.find(
			(row) => (row.args[0] as { deferrals?: number }).deferrals === 1
		);
		expect(retry?.args[0]).toEqual(
			expect.objectContaining({ deferrals: 1, index: 0, runId })
		);
		// Past the cap the lot is given up as deferred and the run moves on.
		await fx.t.action(internal.nerdStuff.runLot, {
			deferrals: MAX_READ_DEFERRALS,
			index: 0,
			runId,
		});
		const traces = await allTraces(fx);
		expect(traces).toHaveLength(1);
		expect(traces[0]).toMatchObject({
			deferrals: MAX_READ_DEFERRALS,
			outcome: "deferred",
		});
		expect(await getRun(fx, runId)).toMatchObject({
			deferred: 2,
			status: "done",
		});
	});

	test("a page that cannot be read is a failed trace; the run goes on", async () => {
		const fx = await setup(1);
		// Firecrawl and the shop both answer 500.
		stubProviders({ firecrawlStatus: 500, html: null });
		const runId = await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		await drive(fx);
		const traces = await allTraces(fx);
		expect(traces).toHaveLength(1);
		expect(traces[0]).toMatchObject({
			error: expect.any(String),
			outcome: "failed",
			picks: [],
		});
		expect(await getRun(fx, runId)).toMatchObject({
			failed: 1,
			read: 0,
			status: "done",
		});
	});

	test("stop halts the loop before the next lot; only the owner may stop", async () => {
		const fx = await setup(2);
		stubProviders();
		const runId = await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		await fx.t.action(internal.nerdStuff.runLot, { index: 0, runId });
		expect(await getRun(fx, runId)).toMatchObject({ index: 1, read: 1 });
		await expect(
			asUser(fx.t, fx.otherId).mutation(api.nerdStuff.stop, { runId })
		).rejects.toThrow("Not your run");
		await asUser(fx.t, fx.userId).mutation(api.nerdStuff.stop, { runId });
		await drive(fx);
		expect(await getRun(fx, runId)).toMatchObject({
			index: 1,
			status: "stopped",
		});
		expect(await allTraces(fx)).toHaveLength(1);
	});

	test("the watchdog fails a run still going", async () => {
		const fx = await setup(1);
		stubProviders();
		const runId = await asUser(fx.t, fx.userId).mutation(api.nerdStuff.start, {
			roasterId: fx.roasterId,
		});
		await fx.t.mutation(internal.nerdStuff.expire, { runId });
		expect(await getRun(fx, runId)).toMatchObject({
			message: "timed out",
			status: "failed",
		});
		// The loop sees the failed run and exits.
		await fx.t.action(internal.nerdStuff.runLot, { index: 0, runId });
		expect(await allTraces(fx)).toHaveLength(0);
	});
});

describe("nerdStuff.feedTrace", () => {
	test("replays the regex pass on the stored product", () => {
		expect(
			feedTrace({
				description: "Notes of peach and melon.",
				name: "Ethiopia Yirgacheffe Natural",
				productType: "Coffee",
				tags: ["Natural"],
			})
		).toEqual({
			attributes: expect.arrayContaining([
				{ field: "origin", value: "Ethiopia" },
				{ field: "process", value: "Natural" },
			]),
			isLot: true,
			notes: "peach and melon",
			rule: "type",
		});
	});
});

describe("pageFacts.scrape writes a trace", () => {
	test("a scheduled read records outcome read with its picks; a failed one records the error", async () => {
		const fx = await setup(1);
		stubProviders();
		const lotId = fx.lotIds[0] as Id<"products">;
		await fx.t.action(internal.pageFacts.scrape, {
			name: "Ethiopia Lot 0",
			productId: lotId,
			url: `${SHOP}/products/lot-0`,
		});
		const [trace] = await allTraces(fx);
		expect(trace).toMatchObject({
			name: "Ethiopia Lot 0",
			outcome: "read",
			productId: lotId,
			roasterId: fx.roasterId,
			source: "firecrawl",
		});
		expect(trace?.runId).toBeUndefined();
		const processPick = trace?.picks.find(
			(pick: { field: string }) => pick.field === "process"
		);
		expect(processPick?.kept).toBe(true);
		expect(trace?.feed).toBeUndefined();
		// A fresh deployment, so the minute's Firecrawl token is there to spend.
		const down = await setup(1);
		stubProviders({ firecrawlStatus: 500, html: null });
		await down.t.action(internal.pageFacts.scrape, {
			productId: down.lotIds[0] as Id<"products">,
			url: `${SHOP}/products/lot-0`,
		});
		expect(await allTraces(down)).toMatchObject([
			{ error: expect.any(String), outcome: "failed", picks: [] },
		]);
	});

	test("a deferral that runs again writes no trace; one that gives up writes deferred", async () => {
		const fx = await setup(1);
		stubProviders({ firecrawlStatus: 429, html: null });
		const lotId = fx.lotIds[0] as Id<"products">;
		await fx.t.action(internal.pageFacts.scrape, {
			productId: lotId,
			url: `${SHOP}/products/lot-0`,
		});
		expect(await allTraces(fx)).toHaveLength(0);
		await fx.t.action(internal.pageFacts.scrape, {
			deferrals: MAX_READ_DEFERRALS,
			productId: lotId,
			url: `${SHOP}/products/lot-0`,
		});
		expect(await allTraces(fx)).toMatchObject([
			{ deferrals: MAX_READ_DEFERRALS, outcome: "deferred" },
		]);
	});
});

describe("nerdStuff.prune", () => {
	test("removes traces past three days and runs past seven, nothing younger", async () => {
		const fx = await setup(1);
		const now = Date.now();
		const lotId = fx.lotIds[0] as Id<"products">;
		const trace = (startedAt: number) => ({
			canonical: [],
			name: "x",
			notes: [],
			outcome: "read" as const,
			picks: [],
			productId: lotId,
			roasterId: fx.roasterId,
			sentences: [],
			stages: {},
			startedAt,
			url: "https://x",
		});
		const run = (createdAt: number) => ({
			commit: false,
			createdAt,
			deferred: 0,
			failed: 0,
			index: 0,
			jevMs: 0,
			jevQuestions: 0,
			jevRequests: 0,
			pageMs: 0,
			productIds: [lotId],
			read: 0,
			roasterId: fx.roasterId,
			status: "done" as const,
			total: 1,
			updatedAt: createdAt,
			userId: fx.userId,
		});
		await fx.t.run(async (ctx) => {
			await ctx.db.insert(
				"pipelineTraces",
				trace(now - TRACE_RETENTION_MS - 1)
			);
			await ctx.db.insert("pipelineTraces", trace(now - MINUTE));
			await ctx.db.insert("pipelineRuns", run(now - RUN_RETENTION_MS - 1));
			await ctx.db.insert("pipelineRuns", run(now - MINUTE));
		});
		expect(await fx.t.mutation(internal.nerdStuff.prune, {})).toBe(2);
		expect(await allTraces(fx)).toHaveLength(1);
		expect(
			await fx.t.run((ctx) => ctx.db.query("pipelineRuns").collect())
		).toHaveLength(1);
	});
});
