/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	COMMIT_BATCH_PRODUCTS,
	rawCaptureRetentionMs,
	stalenessThresholdMs,
} from "./constants";
import type { ExtractedProduct } from "./extraction";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const CADENCE_MINUTES = 60;
const CADENCE_MS = CADENCE_MINUTES * 60_000;
const T0 = 1_700_000_000_000;

interface Fixture {
	crawlSourceId: Id<"crawlSources">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
}

const setup = async (
	overrides: Partial<Doc<"crawlSources">> = {}
): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const roaster = await ctx.db.insert("roasters", {
			city: "Brooklyn",
			claimed: false,
			domain: "sey.example.com",
			name: "Sey",
			productPageUrl: "https://sey.example.com/collections/coffee",
			slug: "sey",
			source: "curated",
			state: "NY",
			status: "pending",
			websiteUrl: "https://sey.example.com",
		});
		const source = await ctx.db.insert("crawlSources", {
			cadenceMinutes: CADENCE_MINUTES,
			consecutiveFailures: 0,
			health: "watching",
			mode: "products_json",
			nextCrawlDueAt: T0,
			roasterId: roaster,
			...overrides,
		});
		return { roaster, source };
	});
	return { crawlSourceId: ids.source, roasterId: ids.roaster, t };
};

const product = (
	externalId: string,
	variants: ExtractedProduct["variants"] = [
		{ available: true, grams: 250, name: "250g", priceCents: 1800 },
	]
): ExtractedProduct => ({
	externalId,
	handle: `lot-${externalId}`,
	name: `Lot ${externalId}`,
	variants,
});

/** Drive the real commit path: batched applyProductBatch + finalizeCrawl. */
const crawl = (
	fx: Fixture,
	fetchedAt: number,
	products: ExtractedProduct[]
): Promise<null> =>
	fx.t.action(internal.crawler.commitExtractedCatalog, {
		crawlSourceId: fx.crawlSourceId,
		fetchedAt,
		products,
	});

const fail = (
	fx: Fixture,
	fetchedAt: number,
	errorMessage?: string
): Promise<null> =>
	fx.t.mutation(internal.crawlSources.finalizeCrawl, {
		crawlSourceId: fx.crawlSourceId,
		fetchedAt,
		success: false,
		...(errorMessage === undefined ? {} : { errorMessage }),
	});

const readAll = (fx: Fixture) =>
	fx.t.run(async (ctx) => ({
		events: await ctx.db.query("dropEvents").collect(),
		products: await ctx.db.query("products").collect(),
		roaster: await ctx.db.get(fx.roasterId),
		source: await ctx.db.get(fx.crawlSourceId),
		variants: await ctx.db.query("productVariants").collect(),
	}));

const readSource = async (fx: Fixture) => {
	const state = await readAll(fx);
	return state.source;
};

const readHealth = async (fx: Fixture) => {
	const source = await readSource(fx);
	return source?.health;
};

const readRoasterStatus = async (fx: Fixture) => {
	const state = await readAll(fx);
	return state.roaster?.status;
};

const readProduct = async (fx: Fixture, externalId: string) => {
	const state = await readAll(fx);
	return state.products.find((p) => p.externalId === externalId);
};

const readEvents = async (fx: Fixture) => {
	const state = await readAll(fx);
	return state.events;
};

describe("commit: baseline rule", () => {
	test("first successful crawl populates the catalog and fires no events", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a"), product("b")]);

		const state = await readAll(fx);
		expect(state.events).toEqual([]);
		expect(state.products).toHaveLength(2);
		expect(state.products.map((p) => p.status)).toEqual(["current", "current"]);
		expect(state.products[0]).toMatchObject({
			firstSeenAt: T0,
			lastSeenAt: T0,
			missedCrawls: 0,
			roasterId: fx.roasterId,
		});
		expect(state.variants).toHaveLength(2);
		expect(state.source).toMatchObject({
			consecutiveFailures: 0,
			health: "watching",
			lastCheckedAt: T0,
			lastSuccessAt: T0,
			nextCrawlDueAt: T0 + CADENCE_MS,
		});
	});

	test("a baseline crawl activates a pending roaster", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		expect(await readRoasterStatus(fx)).toBe("active");
	});

	test("a rejected roaster is not activated by data", async () => {
		const fx = await setup();
		await fx.t.run(async (ctx) => {
			await ctx.db.patch(fx.roasterId, { status: "rejected" });
		});
		await crawl(fx, T0, [product("a")]);
		expect(await readRoasterStatus(fx)).toBe("rejected");
	});

	test("the baseline is per-source: a product first seen post-baseline is a new event", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		await crawl(fx, T0 + CADENCE_MS, [product("a"), product("b")]);

		const state = await readAll(fx);
		expect(state.events).toHaveLength(1);
		const [event] = state.events;
		const b = state.products.find((p) => p.externalId === "b");
		expect(event).toMatchObject({
			detectedAt: T0 + CADENCE_MS,
			newPriceCents: 1800,
			productId: b?._id,
			roasterId: fx.roasterId,
			type: "new",
		});
		expect(event?.variantId).toBeDefined();
	});

	test("a new variant on a known product is a new event", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
			]),
		]);

		const state = await readAll(fx);
		expect(state.variants).toHaveLength(2);
		expect(state.events).toHaveLength(1);
		expect(state.events[0]).toMatchObject({ newPriceCents: 5600, type: "new" });
	});
});

describe("commit: variant diffing", () => {
	const diff = async (
		before: ExtractedProduct["variants"][number],
		after: ExtractedProduct["variants"][number]
	) => {
		const fx = await setup();
		await crawl(fx, T0, [product("a", [before])]);
		await crawl(fx, T0 + CADENCE_MS, [product("a", [after])]);
		return readAll(fx);
	};

	test("no change emits nothing", async () => {
		const variant = { available: true, name: "250g", priceCents: 1800 };
		const state = await diff(variant, variant);
		expect(state.events).toEqual([]);
	});

	test("available -> unavailable is sold_out", async () => {
		const state = await diff(
			{ available: true, name: "250g", priceCents: 1800 },
			{ available: false, name: "250g", priceCents: 1800 }
		);
		expect(state.events).toHaveLength(1);
		expect(state.events[0]).toMatchObject({
			type: "sold_out",
			variantId: state.variants[0]?._id,
		});
		expect(state.events[0]?.oldPriceCents).toBeUndefined();
		expect(state.variants[0]?.available).toBe(false);
	});

	test("unavailable -> available is back_in_stock", async () => {
		const state = await diff(
			{ available: false, name: "250g", priceCents: 1800 },
			{ available: true, name: "250g", priceCents: 1800 }
		);
		expect(state.events.map((e) => e.type)).toEqual(["back_in_stock"]);
	});

	test("a lower price is price_drop with both prices cited", async () => {
		const state = await diff(
			{ available: true, name: "250g", priceCents: 1800 },
			{ available: true, name: "250g", priceCents: 1600 }
		);
		expect(state.events).toHaveLength(1);
		expect(state.events[0]).toMatchObject({
			newPriceCents: 1600,
			oldPriceCents: 1800,
			type: "price_drop",
		});
		expect(state.variants[0]?.priceCents).toBe(1600);
	});

	test("a higher price is price_rise", async () => {
		const state = await diff(
			{ available: true, name: "250g", priceCents: 1800 },
			{ available: true, name: "250g", priceCents: 2000 }
		);
		expect(state.events[0]).toMatchObject({
			newPriceCents: 2000,
			oldPriceCents: 1800,
			type: "price_rise",
		});
	});

	test("availability outranks price: one back_in_stock event citing both prices", async () => {
		const state = await diff(
			{ available: false, name: "250g", priceCents: 1800 },
			{ available: true, name: "250g", priceCents: 1600 }
		);
		expect(state.events).toHaveLength(1);
		expect(state.events[0]).toMatchObject({
			newPriceCents: 1600,
			oldPriceCents: 1800,
			type: "back_in_stock",
		});
	});

	test("grams are updated when present and kept when omitted", async () => {
		const state = await diff(
			{ available: true, grams: 250, name: "250g", priceCents: 1800 },
			{ available: true, name: "250g", priceCents: 1800 }
		);
		expect(state.variants[0]?.grams).toBe(250);
	});

	test("repeated variant names in one feed do not double-insert (last wins)", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("a", [
				{ available: true, name: "250g", priceCents: 1800 },
				{ available: false, name: "250g", priceCents: 1900 },
			]),
		]);
		const state = await readAll(fx);
		expect(state.variants).toHaveLength(1);
		expect(state.variants[0]).toMatchObject({
			available: false,
			priceCents: 1900,
		});
	});
});

describe("commit: 3-strike archive", () => {
	test("a product absent from 3 consecutive successful crawls is archived", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a"), product("b")]);
		const only = [product("a")];

		await crawl(fx, T0 + CADENCE_MS, only);
		let b = await readProduct(fx, "b");
		expect(b).toMatchObject({ missedCrawls: 1, status: "current" });

		await crawl(fx, T0 + 2 * CADENCE_MS, only);
		b = await readProduct(fx, "b");
		expect(b).toMatchObject({ missedCrawls: 2, status: "current" });

		await crawl(fx, T0 + 3 * CADENCE_MS, only);
		b = await readProduct(fx, "b");
		expect(b).toMatchObject({
			firstSeenAt: T0,
			lastSeenAt: T0,
			missedCrawls: 2,
			status: "archived",
		});
		// Archiving fires no Drop event.
		expect(await readEvents(fx)).toEqual([]);
	});

	test("reappearing before the third strike resets the count", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a"), product("b")]);
		await crawl(fx, T0 + CADENCE_MS, [product("a")]);
		await crawl(fx, T0 + 2 * CADENCE_MS, [product("a")]);
		await crawl(fx, T0 + 3 * CADENCE_MS, [product("a"), product("b")]);

		const state = await readAll(fx);
		const b = state.products.find((p) => p.externalId === "b");
		expect(b).toMatchObject({
			lastSeenAt: T0 + 3 * CADENCE_MS,
			missedCrawls: 0,
			status: "current",
		});
		// b was already in the catalog, so no new event; its variant is unchanged.
		expect(state.events).toEqual([]);
	});

	test("an archived product resurrects as current without a new event", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a"), product("b")]);
		for (let i = 1; i <= 3; i += 1) {
			// eslint-disable-next-line no-await-in-loop
			await crawl(fx, T0 + i * CADENCE_MS, [product("a")]);
		}
		await crawl(fx, T0 + 4 * CADENCE_MS, [product("a"), product("b")]);

		const state = await readAll(fx);
		const b = state.products.find((p) => p.externalId === "b");
		expect(b).toMatchObject({ missedCrawls: 0, status: "current" });
		expect(state.products).toHaveLength(2);
		expect(state.events).toEqual([]);
	});

	test("failed crawls do not count as strikes", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a"), product("b")]);
		await fail(fx, T0 + CADENCE_MS, "boom");
		const b = await readProduct(fx, "b");
		expect(b).toMatchObject({ missedCrawls: 0, status: "current" });
	});

	test("the baseline crawl of a seeded catalog still counts strikes", async () => {
		// Products present in the table before the source's first success
		// (e.g. after a source reset) are subject to the archive rule too.
		const fx = await setup();
		await fx.t.run(async (ctx) => {
			await ctx.db.insert("products", {
				externalId: "ghost",
				firstSeenAt: T0 - CADENCE_MS,
				handle: "ghost",
				lastSeenAt: T0 - CADENCE_MS,
				missedCrawls: 2,
				name: "Ghost",
				roasterId: fx.roasterId,
				status: "current",
			});
		});
		await crawl(fx, T0, [product("a")]);
		const ghost = await readProduct(fx, "ghost");
		expect(ghost?.status).toBe("archived");
	});
});

describe("commit: failures and captures", () => {
	test("a failed crawl records the error and bumps consecutiveFailures", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		await fail(fx, T0 + CADENCE_MS, "products.json unavailable");
		await fail(fx, T0 + 2 * CADENCE_MS);

		const { source } = await readAll(fx);
		expect(source).toMatchObject({
			consecutiveFailures: 2,
			health: "crawl_failed",
			lastCheckedAt: T0 + 2 * CADENCE_MS,
			lastErrorAt: T0 + 2 * CADENCE_MS,
			lastErrorMessage: "Unknown crawl error",
			lastSuccessAt: T0,
			nextCrawlDueAt: T0 + 3 * CADENCE_MS,
		});
	});

	test("a success after failures resets health to watching", async () => {
		const fx = await setup({ consecutiveFailures: 4, health: "crawl_failed" });
		await crawl(fx, T0, [product("a")]);
		expect(await readSource(fx)).toMatchObject({
			consecutiveFailures: 0,
			health: "watching",
		});
	});

	test("a raw capture row is written on success and on failure", async () => {
		const fx = await setup();
		const storageId = await fx.t.run((ctx) =>
			ctx.storage.store(new Blob(['{"products":[]}']))
		);
		await fx.t.mutation(internal.crawlSources.finalizeCrawl, {
			crawlSourceId: fx.crawlSourceId,
			errorMessage: "empty feed",
			fetchedAt: T0,
			rawCapture: { extractionOk: false, storageId },
			success: false,
		});
		await fx.t.action(internal.crawler.commitExtractedCatalog, {
			crawlSourceId: fx.crawlSourceId,
			fetchedAt: T0 + CADENCE_MS,
			products: [product("a")],
			rawCapture: { extractionOk: true, storageId },
		});

		const captures = await fx.t.run((ctx) =>
			ctx.db.query("rawCaptures").collect()
		);
		expect(captures).toHaveLength(2);
		expect(captures.map((c) => c.extractionOk)).toEqual([false, true]);
		expect(captures[0]).toMatchObject({
			capturedAt: T0,
			roasterId: fx.roasterId,
			storageId,
		});
	});

	test("an unknown source is a no-op", async () => {
		const fx = await setup();
		await fx.t.run(async (ctx) => {
			await ctx.db.delete(fx.crawlSourceId);
		});
		await expect(crawl(fx, T0, [product("a")])).resolves.toBeNull();
		expect(await fx.t.run((ctx) => ctx.db.query("products").collect())).toEqual(
			[]
		);
	});
});

describe("commit: batching", () => {
	const bigCatalog = (count: number) =>
		Array.from({ length: count }, (_, i) =>
			product(`p${i}`, [
				{ available: true, name: "250g", priceCents: 1800 },
				{ available: true, name: "1kg", priceCents: 5600 },
			])
		);

	test("a catalog larger than one batch commits whole and finalizes once", async () => {
		const count = COMMIT_BATCH_PRODUCTS * 2 + 7;
		const fx = await setup();
		await crawl(fx, T0, bigCatalog(count));

		const state = await readAll(fx);
		expect(state.products).toHaveLength(count);
		expect(state.variants).toHaveLength(count * 2);
		expect(state.events).toEqual([]);
		expect(state.source).toMatchObject({
			health: "watching",
			lastSuccessAt: T0,
		});

		// Second crawl over the same catalog: every batch diffs to nothing, and
		// the archive rule sees every product.
		await crawl(fx, T0 + CADENCE_MS, bigCatalog(count));
		const after = await readAll(fx);
		expect(after.events).toEqual([]);
		expect(after.products.every((p) => p.missedCrawls === 0)).toBe(true);
	});

	test("a failing batch ends the crawl as crawl_failed without touching lastSuccessAt", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		// Two stored rows for one externalId make the per-product lookup throw
		// inside the second batch, after the first batch has committed.
		await fx.t.run(async (ctx) => {
			for (const _ of [0, 1]) {
				// eslint-disable-next-line no-await-in-loop
				await ctx.db.insert("products", {
					externalId: "dup",
					firstSeenAt: T0,
					handle: "dup",
					lastSeenAt: T0,
					missedCrawls: 0,
					name: "Dup",
					roasterId: fx.roasterId,
					status: "current",
				});
			}
		});
		await crawl(fx, T0 + CADENCE_MS, [
			...bigCatalog(COMMIT_BATCH_PRODUCTS),
			product("dup"),
		]);

		const state = await readAll(fx);
		expect(state.source).toMatchObject({
			consecutiveFailures: 1,
			health: "crawl_failed",
			lastSuccessAt: T0,
		});
		expect(state.source?.lastErrorMessage).toContain("catalog commit failed");
		// The first batch landed (idempotent against the next crawl); the
		// archive rule did not run, so "a" was not struck.
		expect(state.products.length).toBeGreaterThan(1);
		const a = await readProduct(fx, "a");
		expect(a?.missedCrawls).toBe(0);
	});
});

describe("rebaselineSource", () => {
	test("makes the next crawl a silent baseline", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		await fx.t.mutation(internal.crawlSources.rebaselineSource, {
			crawlSourceId: fx.crawlSourceId,
		});
		const reset = await readSource(fx);
		expect(reset?.lastSuccessAt).toBeUndefined();

		// Coverage expands (b appears) but fires nothing.
		await crawl(fx, T0 + CADENCE_MS, [product("a"), product("b")]);
		expect(await readEvents(fx)).toEqual([]);
		const rebaselined = await readSource(fx);
		expect(rebaselined?.lastSuccessAt).toBe(T0 + CADENCE_MS);

		// Alerts resume from the crawl after.
		await crawl(fx, T0 + 2 * CADENCE_MS, [
			product("a"),
			product("b"),
			product("c"),
		]);
		const events = await readEvents(fx);
		expect(events.map((e) => e.type)).toEqual(["new"]);
	});
});

describe("sweepStale", () => {
	test("flips a quiet watching source to stale and leaves fresh ones alone", async () => {
		const now = Date.now();
		const threshold = stalenessThresholdMs(CADENCE_MINUTES);
		const fx = await setup({ lastSuccessAt: now - threshold - 1 });
		const freshId = await fx.t.run((ctx) =>
			ctx.db.insert("crawlSources", {
				cadenceMinutes: CADENCE_MINUTES,
				consecutiveFailures: 0,
				health: "watching",
				lastSuccessAt: now - threshold + 60_000,
				mode: "products_json",
				nextCrawlDueAt: now,
				roasterId: fx.roasterId,
			})
		);
		const failedId = await fx.t.run((ctx) =>
			ctx.db.insert("crawlSources", {
				cadenceMinutes: CADENCE_MINUTES,
				consecutiveFailures: 1,
				health: "crawl_failed",
				lastSuccessAt: now - threshold * 10,
				mode: "products_json",
				nextCrawlDueAt: now,
				roasterId: fx.roasterId,
			})
		);

		await fx.t.mutation(internal.crawlSources.sweepStale, {});

		const health = await fx.t.run(async (ctx) => {
			const failed = await ctx.db.get(failedId);
			const fresh = await ctx.db.get(freshId);
			const quiet = await ctx.db.get(fx.crawlSourceId);
			return {
				failed: failed?.health,
				fresh: fresh?.health,
				quiet: quiet?.health,
			};
		});
		// crawl_failed already says what happened; the sweep only touches watching.
		expect(health).toEqual({
			failed: "crawl_failed",
			fresh: "watching",
			quiet: "stale",
		});
	});

	test("a watching source that never succeeded is stale", async () => {
		const fx = await setup();
		await fx.t.mutation(internal.crawlSources.sweepStale, {});
		expect(await readHealth(fx)).toBe("stale");
	});

	test("a successful crawl brings a stale source back to watching", async () => {
		const fx = await setup({
			health: "stale",
			lastSuccessAt: T0 - 10 * CADENCE_MS,
		});
		await crawl(fx, T0, [product("a")]);
		expect(await readHealth(fx)).toBe("watching");
	});
});

describe("pruneRawCaptures", () => {
	test("deletes captures past retention (blob and row), keeps recent ones", async () => {
		const now = Date.now();
		const fx = await setup();
		const { oldStorageId, recentStorageId } = await fx.t.run(async (ctx) => {
			const old = await ctx.storage.store(new Blob(["old"]));
			const recent = await ctx.storage.store(new Blob(["recent"]));
			await ctx.db.insert("rawCaptures", {
				capturedAt: now - rawCaptureRetentionMs() - 1,
				extractionOk: true,
				roasterId: fx.roasterId,
				storageId: old,
			});
			await ctx.db.insert("rawCaptures", {
				capturedAt: now - 60_000,
				extractionOk: true,
				roasterId: fx.roasterId,
				storageId: recent,
			});
			return { oldStorageId: old, recentStorageId: recent };
		});

		await fx.t.mutation(internal.crawlSources.pruneRawCaptures, {});

		const after = await fx.t.run(async (ctx) => ({
			captures: await ctx.db.query("rawCaptures").collect(),
			oldBlobExists: (await ctx.storage.get(oldStorageId)) !== null,
			recentBlobExists: (await ctx.storage.get(recentStorageId)) !== null,
			scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
		}));
		expect(after.captures).toHaveLength(1);
		expect(after.captures[0]?.storageId).toBe(recentStorageId);
		expect(after.oldBlobExists).toBe(false);
		expect(after.recentBlobExists).toBe(true);
		// A partial batch does not reschedule.
		expect(after.scheduled).toEqual([]);
	});

	test("is a no-op on an empty table", async () => {
		const fx = await setup();
		await expect(
			fx.t.mutation(internal.crawlSources.pruneRawCaptures, {})
		).resolves.toBeNull();
	});
});

describe("tick", () => {
	test("claims due sources, pushes their due date out, and schedules the crawler", async () => {
		const now = Date.now();
		const fx = await setup({ nextCrawlDueAt: now - 1 });
		const notDueId = await fx.t.run((ctx) =>
			ctx.db.insert("crawlSources", {
				cadenceMinutes: CADENCE_MINUTES,
				consecutiveFailures: 0,
				health: "watching",
				mode: "products_json",
				nextCrawlDueAt: now + CADENCE_MS,
				roasterId: fx.roasterId,
			})
		);

		await fx.t.mutation(internal.crawlSources.tick, {});

		const after = await fx.t.run(async (ctx) => ({
			due: await ctx.db.get(fx.crawlSourceId),
			notDue: await ctx.db.get(notDueId),
			scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
		}));
		expect(after.due?.nextCrawlDueAt).toBeGreaterThanOrEqual(now + CADENCE_MS);
		expect(after.notDue?.nextCrawlDueAt).toBe(now + CADENCE_MS);
		expect(after.scheduled).toHaveLength(1);
		expect(after.scheduled[0]).toMatchObject({
			args: [{ crawlSourceId: fx.crawlSourceId }],
			name: "crawler:crawlSource",
		});
	});
});
