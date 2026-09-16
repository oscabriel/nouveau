/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

const MINUTE_MS = 60_000;

interface Fixture {
	crawlSourceId: Id<"crawlSources">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
	userId: Id<"users">;
}

// Fake timers keep the scheduled crawler action from firing (it needs the
// Firecrawl component); every test asserts the schedule itself.
beforeEach(() => {
	vi.useFakeTimers();
	// commitExtractedCatalog confirms the shop market with a homepage fetch;
	// a page without Shopify globals fails closed and leaves market absent.
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			const response = new Response("<html></html>", {
				headers: { "content-type": "text/html" },
				status: 200,
			});
			Object.defineProperty(response, "url", {
				value: "https://sey.example.com/",
			});
			return response;
		})
	);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const setup = async (
	overrides: Partial<Doc<"crawlSources">> = {}
): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	const ids = await t.run(async (ctx) => {
		const userId = await ctx.db.insert("users", {
			email: "one@example.com",
			name: "One",
			providerAccountId: "one",
		});
		const roasterId = await ctx.db.insert("roasters", {
			city: "Brooklyn",
			claimed: false,
			domain: "sey.example.com",
			name: "Sey",
			productPageUrl: "https://sey.example.com/collections/coffee",
			slug: "sey",
			source: "curated",
			state: "NY",
			status: "active",
			websiteUrl: "https://sey.example.com",
		});
		const crawlSourceId = await ctx.db.insert("crawlSources", {
			cadenceMinutes: 60,
			consecutiveFailures: 0,
			health: "watching",
			lastSuccessAt: Date.now() - 30 * MINUTE_MS,
			mode: "products_json",
			nextCrawlDueAt: Date.now() + 30 * MINUTE_MS,
			roasterId,
			...overrides,
		});
		return { crawlSourceId, roasterId, userId };
	});
	return { ...ids, t };
};

const scheduledCrawls = (fx: Fixture) =>
	fx.t.run(async (ctx) => {
		const all = await ctx.db.system.query("_scheduled_functions").collect();
		return all.filter((job) => job.name === "crawler:crawlSource");
	});

const readSource = (fx: Fixture) =>
	fx.t.run((ctx) => ctx.db.get(fx.crawlSourceId));

describe("requestCheck", () => {
	test("a signed-in user starts one crawl on a quiet source", async () => {
		const fx = await setup();
		const now = Date.now();

		const result = await asUser(fx.t, fx.userId).mutation(
			api.checkNow.requestCheck,
			{ roasterId: fx.roasterId }
		);

		expect(result).toEqual({ status: "started" });
		const scheduled = await scheduledCrawls(fx);
		expect(scheduled).toHaveLength(1);
		expect(scheduled[0]?.args).toEqual([{ crawlSourceId: fx.crawlSourceId }]);
		const source = await readSource(fx);
		expect(source?.runningSince).toBe(now);
	});

	test("an anonymous call throws and schedules nothing", async () => {
		const fx = await setup();
		await expect(
			fx.t.mutation(api.checkNow.requestCheck, { roasterId: fx.roasterId })
		).rejects.toThrow("Sign in required");
		expect(await scheduledCrawls(fx)).toHaveLength(0);
	});

	test("a source already running answers running and schedules nothing", async () => {
		const fx = await setup({ runningSince: Date.now() - MINUTE_MS });
		const result = await asUser(fx.t, fx.userId).mutation(
			api.checkNow.requestCheck,
			{ roasterId: fx.roasterId }
		);
		expect(result).toEqual({ status: "running" });
		expect(await scheduledCrawls(fx)).toHaveLength(0);
	});

	test("a source checked under two minutes ago answers fresh without crawling", async () => {
		const lastSuccessAt = Date.now() - MINUTE_MS;
		const fx = await setup({ lastSuccessAt });
		const result = await asUser(fx.t, fx.userId).mutation(
			api.checkNow.requestCheck,
			{ roasterId: fx.roasterId }
		);
		expect(result).toEqual({ lastSuccessAt, status: "fresh" });
		expect(await scheduledCrawls(fx)).toHaveLength(0);
	});

	test("a second request inside the source's two-minute window is limited, not a second crawl", async () => {
		const fx = await setup();
		const otherUserId = await fx.t.run((ctx) =>
			ctx.db.insert("users", { name: "Two", providerAccountId: "two" })
		);
		await asUser(fx.t, fx.userId).mutation(api.checkNow.requestCheck, {
			roasterId: fx.roasterId,
		});
		// The first crawl finished at once and cleared the running stamp, but
		// left lastSuccessAt old: only the per-source window stands in the way.
		await fx.t.run((ctx) =>
			ctx.db.patch(fx.crawlSourceId, { runningSince: undefined })
		);

		const result = await asUser(fx.t, otherUserId).mutation(
			api.checkNow.requestCheck,
			{ roasterId: fx.roasterId }
		);

		expect(result).toMatchObject({ status: "limited" });
		expect(await scheduledCrawls(fx)).toHaveLength(1);
	});

	test("a user's fourth check in ten minutes is limited with a retry time", async () => {
		const fx = await setup();
		const user = asUser(fx.t, fx.userId);
		const roasterIds: Id<"roasters">[] = [fx.roasterId];
		for (const slug of ["heart", "onyx", "sey-two"]) {
			// eslint-disable-next-line no-await-in-loop
			const roasterId = await fx.t.run(async (ctx) => {
				const id = await ctx.db.insert("roasters", {
					city: "Portland",
					claimed: false,
					domain: `${slug}.example.com`,
					name: slug,
					productPageUrl: `https://${slug}.example.com/collections/coffee`,
					slug,
					source: "curated",
					state: "OR",
					status: "active",
					websiteUrl: `https://${slug}.example.com`,
				});
				await ctx.db.insert("crawlSources", {
					cadenceMinutes: 60,
					consecutiveFailures: 0,
					health: "watching",
					lastSuccessAt: Date.now() - 30 * MINUTE_MS,
					mode: "products_json",
					nextCrawlDueAt: Date.now() + 30 * MINUTE_MS,
					roasterId: id,
				});
				return id;
			});
			roasterIds.push(roasterId);
		}

		const results: { status: string; retryAfter?: number }[] = [];
		for (const roasterId of roasterIds) {
			// eslint-disable-next-line no-await-in-loop
			const result = await user.mutation(api.checkNow.requestCheck, {
				roasterId,
			});
			results.push(result);
		}

		expect(results.slice(0, 3).map((r) => r.status)).toEqual([
			"started",
			"started",
			"started",
		]);
		expect(results[3]?.status).toBe("limited");
		expect(results[3]?.retryAfter).toBeGreaterThan(0);
		expect(await scheduledCrawls(fx)).toHaveLength(3);
	});
});

describe("crawlNow", () => {
	test("bypasses the per-source window and the fresh rule", async () => {
		const fx = await setup({ lastSuccessAt: Date.now() - 10_000 });
		await asUser(fx.t, fx.userId).mutation(api.checkNow.requestCheck, {
			roasterId: fx.roasterId,
		});
		await fx.t.run((ctx) =>
			ctx.db.patch(fx.crawlSourceId, { runningSince: undefined })
		);

		const result = await fx.t.mutation(internal.checkNow.crawlNow, {
			crawlSourceId: fx.crawlSourceId,
		});

		expect(result).toEqual({ started: true });
		expect(await scheduledCrawls(fx)).toHaveLength(1);
	});

	test("refuses a running source", async () => {
		const fx = await setup({ runningSince: Date.now() - MINUTE_MS });
		const result = await fx.t.mutation(internal.checkNow.crawlNow, {
			crawlSourceId: fx.crawlSourceId,
		});
		expect(result).toEqual({ started: false });
		expect(await scheduledCrawls(fx)).toHaveLength(0);
	});

	test("treats a stamp older than ten minutes as a dead crawl and starts", async () => {
		const fx = await setup({ runningSince: Date.now() - 11 * MINUTE_MS });
		const result = await fx.t.mutation(internal.checkNow.crawlNow, {
			crawlSourceId: fx.crawlSourceId,
		});
		expect(result).toEqual({ started: true });
		expect(await scheduledCrawls(fx)).toHaveLength(1);
	});
});

describe("runningSince lifecycle", () => {
	test("finalizeCrawl clears the stamp on success and on failure", async () => {
		const fx = await setup({ runningSince: Date.now() });
		await fx.t.mutation(internal.crawlSources.finalizeCrawl, {
			crawlSourceId: fx.crawlSourceId,
			fetchedAt: Date.now(),
			success: false,
		});
		const afterFailure = await readSource(fx);
		expect(afterFailure?.runningSince).toBeUndefined();

		await fx.t.run((ctx) =>
			ctx.db.patch(fx.crawlSourceId, { runningSince: Date.now() })
		);
		await fx.t.mutation(internal.crawlSources.finalizeCrawl, {
			crawlSourceId: fx.crawlSourceId,
			fetchedAt: Date.now(),
			fetchedExternalIds: [],
			success: true,
		});
		const afterSuccess = await readSource(fx);
		expect(afterSuccess?.runningSince).toBeUndefined();
	});

	test("a check on a never-succeeded source is a baseline: no events", async () => {
		const fx = await setup({ lastSuccessAt: undefined });
		await asUser(fx.t, fx.userId).mutation(api.checkNow.requestCheck, {
			roasterId: fx.roasterId,
		});

		// Drive the commit the scheduled crawl would run.
		await fx.t.action(internal.crawler.commitExtractedCatalog, {
			crawlSourceId: fx.crawlSourceId,
			fetchedAt: Date.now(),
			products: [
				{
					externalId: "1",
					handle: "lot-1",
					name: "Lot 1",
					variants: [
						{ available: true, grams: 250, name: "250g", priceCents: 1800 },
					],
				},
			],
		});

		const after = await fx.t.run(async (ctx) => ({
			events: await ctx.db.query("dropEvents").collect(),
			products: await ctx.db.query("products").collect(),
			source: await ctx.db.get(fx.crawlSourceId),
		}));
		expect(after.products).toHaveLength(1);
		expect(after.events).toEqual([]);
		expect(after.source?.runningSince).toBeUndefined();
	});
});
