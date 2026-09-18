/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	COMMIT_BATCH_PRODUCTS,
	PRUNE_BATCH,
	RAW_CAPTURE_SUCCESS_INTERVAL_MS,
	rawCaptureRetentionMs,
	shouldStoreRawCapture,
	stalenessThresholdMs,
} from "./constants";
import type { ExtractedProduct } from "./extraction";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const CADENCE_MINUTES = 60;
const CADENCE_MS = CADENCE_MINUTES * 60_000;
const T0 = 1_700_000_000_000;

// commitExtractedCatalog confirms the shop market with a homepage fetch, so
// every commit test needs a stub. The default page carries no Shopify
// globals: market confirmation fails closed and stays absent, which is what
// all pre-existing tests assumed.
const htmlResponse = (html: string, url: string, status = 200) => {
	const response = new Response(html, {
		headers: { "content-type": "text/html" },
		status,
	});
	Object.defineProperty(response, "url", { value: url });
	return response;
};
const US_USD =
	'<script>Shopify.currency = {"active":"USD","rate":"1.0"}; Shopify.country = "US";</script>';

beforeEach(() => {
	vi.stubGlobal(
		"fetch",
		vi.fn((_url: string, _init?: RequestInit) =>
			htmlResponse("<html></html>", "https://www.sey.example.com/")
		)
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

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

describe("commit: new-event collapse (#19)", () => {
	test("a lot first seen post-baseline fires one new event citing its cheapest size", async () => {
		const fx = await setup();
		await crawl(fx, T0, []);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 500, name: "500g", priceCents: 3100 },
			]),
		]);

		const state = await readAll(fx);
		expect(state.variants).toHaveLength(3);
		expect(state.events).toHaveLength(1);
		const [event] = state.events;
		const cheapest = state.variants.find((v) => v.name === "250g");
		expect(event).toMatchObject({
			detectedAt: T0 + CADENCE_MS,
			newPriceCents: 1800,
			productId: state.products[0]?._id,
			roasterId: fx.roasterId,
			type: "new",
		});
		expect(event?.variantId).toBe(cheapest?._id);
	});

	test("sizes added to a known lot later collapse to one new event citing the cheapest", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
				{ available: true, name: "2lb", priceCents: 7200 },
			]),
		]);

		const state = await readAll(fx);
		expect(state.events).toHaveLength(1);
		const [event] = state.events;
		const oneKg = state.variants.find((v) => v.name === "1kg");
		// Only the added sizes are "new": 250g existed, so the cheapest new
		// size is 1kg at 5600.
		expect(event).toMatchObject({
			newPriceCents: 5600,
			type: "new",
		});
		expect(event?.variantId).toBe(oneKg?._id);
	});
});

describe("commit: variant burst collapse (#19 generalized)", () => {
	test("several sizes restocking in one crawl emit one back_in_stock event citing them all", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("a", [
				{ available: false, grams: 125, name: "125g", priceCents: 1400 },
				{ available: false, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
			]),
		]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{ available: true, grams: 125, name: "125g", priceCents: 1400 },
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
			]),
		]);

		const state = await readAll(fx);
		expect(state.events).toHaveLength(1);
		const [event] = state.events;
		// The headline cites the cheapest restocked size's unchanged price —
		// so no price fields at all.
		expect(event).toMatchObject({
			detectedAt: T0 + CADENCE_MS,
			type: "back_in_stock",
		});
		expect(event?.newPriceCents).toBeUndefined();
		expect(event?.variantId).toBe(
			state.variants.find((v) => v.name === "125g")?._id
		);
		expect(event?.variantIds).toHaveLength(2);
		expect(event?.variantIds).toContain(
			state.variants.find((v) => v.name === "250g")?._id
		);
	});

	test("a burst of mixed moves emits one event per kind, not one per variant", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("a", [
				{ available: false, grams: 125, name: "125g", priceCents: 1400 },
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
			]),
		]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{ available: true, grams: 125, name: "125g", priceCents: 1400 },
				{ available: true, grams: 250, name: "250g", priceCents: 1600 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5300 },
			]),
		]);

		const state = await readAll(fx);
		expect(state.events).toHaveLength(2);
		const stock = state.events.find((e) => e.type === "back_in_stock");
		const drop = state.events.find((e) => e.type === "price_drop");
		expect(stock?.variantId).toBe(
			state.variants.find((v) => v.name === "125g")?._id
		);
		// The price-drop headline is the biggest move (1kg dropped 300).
		expect(drop?.newPriceCents).toBe(5300);
		expect(drop?.oldPriceCents).toBe(5600);
		expect(drop?.variantIds).toHaveLength(2);
	});

	test("a sold-out burst stores one event citing every size that sold out", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("a", [
				{ available: true, name: "250g", priceCents: 1800 },
				{ available: true, name: "1kg", priceCents: 5600 },
			]),
		]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{ available: false, name: "250g", priceCents: 1800 },
				{ available: false, name: "1kg", priceCents: 5600 },
			]),
		]);

		const state = await readAll(fx);
		expect(state.events).toHaveLength(1);
		expect(state.events[0]).toMatchObject({ type: "sold_out" });
		expect(state.events[0]?.variantIds).toHaveLength(2);
	});

	test("a variant id backfills onto the known variant on the next crawl", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a")]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [
				{
					available: true,
					externalId: "424242",
					grams: 250,
					name: "250g",
					priceCents: 1800,
				},
			]),
		]);
		const state = await readAll(fx);
		expect(state.variants[0]).toMatchObject({ externalId: "424242" });
	});

	test("the variant rollup lands on the product in the same patch", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("a", [
				{ available: false, grams: 250, name: "250g", priceCents: 1800 },
				{ available: true, grams: 1000, name: "1kg", priceCents: 5600 },
			]),
		]);
		const state = await readAll(fx);
		expect(state.products[0]).toMatchObject({
			anyAvailable: true,
			minPriceCents: 1800,
			weightOptions: [250, 1000],
		});
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

describe("commit: lot copy (§14.4)", () => {
	test("a crawl stores the roaster-published fields", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			{
				...product("a"),
				lotCopy: {
					description: "A washed lot from Urrao.",
					imageUrl: "https://cdn.example.com/lot.png",
					origin: "Colombia",
					process: "Washed",
					roasterNotes: ["peach", "melon", "red tea"],
					tags: ["Coffee", "From: Colombia"],
				},
			},
		]);
		const state = await readAll(fx);
		expect(state.products[0]).toMatchObject({
			description: "A washed lot from Urrao.",
			imageUrl: "https://cdn.example.com/lot.png",
			origin: "Colombia",
			process: "Washed",
			roasterNotes: ["peach", "melon", "red tea"],
			tags: ["Coffee", "From: Colombia"],
		});
	});

	test("a later authoritative crawl refreshes the fields and clears the ones it no longer carries", async () => {
		// The roaster edited "old notes" out of their copy: it must not stay on
		// the lot as their verbatim words (CONTEXT.md, Roaster notes).
		const fx = await setup();
		await crawl(fx, T0, [
			{
				...product("a"),
				lotCopy: {
					description: "Old copy.",
					roasterNotes: ["old notes"],
					tags: ["Coffee"],
				},
			},
		]);
		await crawl(fx, T0 + CADENCE_MS, [
			{ ...product("a"), lotCopy: { description: "New copy." } },
		]);
		const state = await readAll(fx);
		expect(state.products[0]).toMatchObject({ description: "New copy." });
		expect(state.products[0]).not.toHaveProperty("roasterNotes");
		expect(state.products[0]).not.toHaveProperty("tags");
	});

	test("a crawl without lotCopy (HTML mode) leaves the stored copy alone", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			{
				...product("a"),
				lotCopy: { description: "Kept copy.", roasterNotes: ["kept notes"] },
			},
		]);
		await crawl(fx, T0 + CADENCE_MS, [product("a")]);
		const state = await readAll(fx);
		expect(state.products[0]).toMatchObject({
			description: "Kept copy.",
			roasterNotes: ["kept notes"],
		});
	});

	test("lot copy never emits a drop event on its own", async () => {
		const fx = await setup();
		const first = await crawl(fx, T0, [
			{
				...product("a"),
				lotCopy: { description: "First copy.", roasterNotes: ["first notes"] },
			},
		]);
		const eventsOne = await readAll(fx);
		const second = await crawl(fx, T0 + CADENCE_MS, [
			{
				...product("a"),
				lotCopy: {
					description: "Second copy.",
					roasterNotes: ["second notes"],
				},
			},
		]);
		expect(first).toBeNull();
		expect(second).toBeNull();
		expect(eventsOne.events).toHaveLength(0);
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

/** The commit path with the classifier's rejected ids attached (§16). */
const crawlRejecting = (
	fx: Fixture,
	fetchedAt: number,
	products: ExtractedProduct[],
	rejectedExternalIds: string[]
): Promise<null> =>
	fx.t.action(internal.crawler.commitExtractedCatalog, {
		crawlSourceId: fx.crawlSourceId,
		fetchedAt,
		products,
		rejectedExternalIds,
	});

describe("commit: non-lot purge (§16)", () => {
	test("a rejected id still in the catalog is deleted with its variants and events", async () => {
		const fx = await setup();
		// Before the rule: the scale entered the catalog and moved once.
		await crawl(fx, T0, [product("lot"), product("scale")]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("lot"),
			product("scale", [
				{ available: true, grams: 250, name: "250g", priceCents: 1500 },
			]),
		]);
		expect(await readEvents(fx)).toHaveLength(1);

		// After the rule: the crawl no longer sees the scale and names it rejected.
		await crawlRejecting(fx, T0 + 2 * CADENCE_MS, [product("lot")], ["scale"]);

		const state = await readAll(fx);
		expect(state.products.map((p) => p.externalId)).toEqual(["lot"]);
		expect(state.variants).toHaveLength(1);
		expect(state.events).toEqual([]);
	});

	test("a rejected product someone logged is archived, not deleted", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("lot"), product("tea")]);
		await fx.t.run(async (ctx) => {
			const products = await ctx.db.query("products").collect();
			const tea = products.find((p) => p.externalId === "tea") ?? null;
			const userId = await ctx.db.insert("users", {
				name: "Taster",
				providerAccountId: "google-1",
			});
			if (tea === null) {
				throw new Error("fixture: tea missing");
			}
			await ctx.db.insert("logs", {
				loggedAt: T0,
				productId: tea._id,
				userId,
			});
		});

		await crawlRejecting(fx, T0 + CADENCE_MS, [product("lot")], ["tea"]);

		const tea = await readProduct(fx, "tea");
		expect(tea).toMatchObject({ status: "archived" });
		const state = await readAll(fx);
		expect(state.products).toHaveLength(2);
	});

	test("a purged event takes its notification ledger rows with it", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("lot"), product("scale")]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("lot"),
			product("scale", [
				{ available: true, grams: 250, name: "250g", priceCents: 1500 },
			]),
		]);
		const [event] = await readEvents(fx);
		if (event === undefined) {
			throw new Error("fixture: expected a price_drop event");
		}
		await fx.t.run(async (ctx) => {
			const userId = await ctx.db.insert("users", {
				name: "Watcher",
				providerAccountId: "google-2",
			});
			await ctx.db.insert("notifications", {
				deliveryStatus: "sent",
				dropEventId: event._id,
				userId,
			});
		});

		await crawlRejecting(fx, T0 + 2 * CADENCE_MS, [product("lot")], ["scale"]);

		const notifications = await fx.t.run((ctx) =>
			ctx.db.query("notifications").collect()
		);
		expect(notifications).toEqual([]);
		expect(await readEvents(fx)).toEqual([]);
	});

	test("an already-archived, unlogged reject is deleted too", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("lot"), product("mug")]);
		await fx.t.run(async (ctx) => {
			const products = await ctx.db.query("products").collect();
			const mug = products.find((p) => p.externalId === "mug");
			if (mug === undefined) {
				throw new Error("fixture: mug missing");
			}
			await ctx.db.patch(mug._id, { status: "archived" });
		});

		await crawlRejecting(fx, T0 + CADENCE_MS, [product("lot")], ["mug"]);

		const state = await readAll(fx);
		expect(state.products.map((p) => p.externalId)).toEqual(["lot"]);
		expect(state.variants).toHaveLength(1);
	});

	test("the purge is capped per crawl; the next crawl takes the rest", async () => {
		const fx = await setup();
		const junk = Array.from({ length: PRUNE_BATCH + 5 }, (_, i) =>
			product(`junk-${i}`)
		);
		await crawl(fx, T0, [product("lot"), ...junk]);
		const junkIds = junk.map((p) => p.externalId);

		await crawlRejecting(fx, T0 + CADENCE_MS, [product("lot")], junkIds);
		let state = await readAll(fx);
		expect(state.products).toHaveLength(1 + 5);
		expect(state.source?.health).toBe("watching");
		// The un-purged remainder took no strike: it is a reject, not a miss.
		for (const rest of state.products.filter((p) => p.externalId !== "lot")) {
			expect(rest).toMatchObject({ missedCrawls: 0, status: "current" });
		}

		await crawlRejecting(fx, T0 + 2 * CADENCE_MS, [product("lot")], junkIds);
		state = await readAll(fx);
		expect(state.products.map((p) => p.externalId)).toEqual(["lot"]);
		expect(state.variants).toHaveLength(1);
	});

	test("a rejected id that was never in the catalog is a no-op", async () => {
		const fx = await setup();
		await crawlRejecting(fx, T0, [product("lot")], ["scale", "mug"]);
		const state = await readAll(fx);
		expect(state.products.map((p) => p.externalId)).toEqual(["lot"]);
		expect(state.source?.health).toBe("watching");
	});

	test("rejected ids are not strikes for anything else", async () => {
		const fx = await setup();
		await crawl(fx, T0, [product("a"), product("b")]);
		await crawlRejecting(fx, T0 + CADENCE_MS, [product("a")], ["scale"]);
		const b = await readProduct(fx, "b");
		expect(b).toMatchObject({ missedCrawls: 1, status: "current" });
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

	test("a success after failures resets health and clears the error message", async () => {
		const fx = await setup({
			consecutiveFailures: 4,
			health: "crawl_failed",
			lastErrorAt: T0 - CADENCE_MS,
			lastErrorMessage: "Firecrawl 429",
		});
		await crawl(fx, T0, [product("a")]);
		const source = await readSource(fx);
		expect(source).toMatchObject({
			consecutiveFailures: 0,
			health: "watching",
			lastErrorAt: T0 - CADENCE_MS,
		});
		expect(source?.lastErrorMessage).toBeUndefined();
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

describe("purgeRoasterEvents", () => {
	test("deletes only the roaster's events at or after `since`", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("a", [{ available: true, name: "250g", priceCents: 1800 }]),
		]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("a", [{ available: true, name: "250g", priceCents: 1700 }]),
		]);
		await crawl(fx, T0 + 2 * CADENCE_MS, [
			product("a", [{ available: true, name: "250g", priceCents: 1900 }]),
		]);
		// Another roaster's event must survive.
		const otherId = await fx.t.run(async (ctx) => {
			const roasterId = await ctx.db.insert("roasters", {
				city: "Portland",
				claimed: false,
				domain: "other.example.com",
				name: "Other",
				productPageUrl: "https://other.example.com/shop",
				slug: "other",
				source: "curated",
				state: "OR",
				status: "active",
				websiteUrl: "https://other.example.com",
			});
			const productId = await ctx.db.insert("products", {
				externalId: "x",
				firstSeenAt: T0,
				handle: "x",
				lastSeenAt: T0,
				name: "X",
				roasterId,
				status: "current",
			});
			return ctx.db.insert("dropEvents", {
				detectedAt: T0 + 2 * CADENCE_MS,
				productId,
				roasterId,
				type: "sold_out",
			});
		});
		expect(await readEvents(fx)).toHaveLength(3);

		await fx.t.mutation(internal.crawlSources.purgeRoasterEvents, {
			roasterId: fx.roasterId,
			since: T0 + 2 * CADENCE_MS,
		});
		let events = await readEvents(fx);
		expect(events).toHaveLength(2);
		expect(events.map((e) => e.type)).toEqual(
			expect.arrayContaining(["price_drop", "sold_out"])
		);
		expect(events.some((e) => e._id === otherId)).toBe(true);

		await fx.t.mutation(internal.crawlSources.purgeRoasterEvents, {
			roasterId: fx.roasterId,
		});
		events = await readEvents(fx);
		expect(events.map((e) => e._id)).toEqual([otherId]);
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

describe("setSourceMode", () => {
	test("flips the mode and clears the failure streak", async () => {
		const fx = await setup({ mode: "product_pages" });
		await fail(fx, T0);
		await fail(fx, T0 + CADENCE_MS);
		await fail(fx, T0 + 2 * CADENCE_MS);
		expect(await readHealth(fx)).toBe("crawl_failed");

		await fx.t.mutation(internal.crawlSources.setSourceMode, {
			crawlSourceId: fx.crawlSourceId,
			mode: "woocommerce",
		});
		const source = await readSource(fx);
		expect(source?.mode).toBe("woocommerce");
		expect(source?.consecutiveFailures).toBe(0);
		expect(source?.health).toBe("watching");
	});
});

describe("recordFeedOrigin", () => {
	test("moves the roaster's website and product page to the host that answered", async () => {
		const fx = await setup();
		await fx.t.mutation(internal.crawlSources.recordFeedOrigin, {
			roasterId: fx.roasterId,
			websiteUrl: "https://www.sey.example.com",
		});
		const { roaster } = await readAll(fx);
		expect(roaster?.websiteUrl).toBe("https://www.sey.example.com");
		expect(roaster?.productPageUrl).toBe(
			"https://www.sey.example.com/collections/coffee"
		);
	});
});

describe("purgeProductsByPrefix", () => {
	test("removes url-keyed rows with their variants and events, archives logged ones", async () => {
		const fx = await setup();
		await crawl(fx, T0, [
			product("https://shop.example.com/products/a?Size=250"),
			product("https://shop.example.com/products/b"),
			product("12345"),
		]);
		await crawl(fx, T0 + CADENCE_MS, [
			product("https://shop.example.com/products/a?Size=250"),
			product("https://shop.example.com/products/b"),
			product("12345"),
			product("https://shop.example.com/products/c"),
		]);
		const before = await readEvents(fx);
		expect(before.length).toBe(1);
		const logged = await readProduct(fx, "https://shop.example.com/products/b");
		if (logged === undefined) {
			throw new Error("fixture: b missing");
		}
		await fx.t.run(async (ctx) => {
			const userId = await ctx.db.insert("users", {
				name: "Taster",
				providerAccountId: "google-1",
			});
			await ctx.db.insert("logs", {
				loggedAt: T0,
				productId: logged._id,
				userId,
			});
		});

		await fx.t.mutation(internal.crawlSources.purgeProductsByPrefix, {
			externalIdPrefix: "https://shop.example.com/products/",
			roasterId: fx.roasterId,
		});
		const state = await readAll(fx);
		const remaining = new Map(
			state.products.map((p) => [p.externalId, p.status])
		);
		expect(remaining).toEqual(
			new Map([
				["12345", "current"],
				["https://shop.example.com/products/b", "archived"],
			])
		);
		expect(state.events).toEqual([]);
		expect(new Set(state.variants.map((variant) => variant.productId))).toEqual(
			new Set(state.products.map((p) => p._id))
		);
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
	// Fake timers keep the scheduled crawler action from actually firing (it
	// needs the Firecrawl component); the test asserts the schedule itself.
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

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

	test("claims a 15-minute source four times an hour on the 5-minute tick (#33)", async () => {
		const start = Date.now();
		const fx = await setup({ cadenceMinutes: 15, nextCrawlDueAt: start });
		// Twelve ticks, one per 5 minutes, over the hour [start, start + 55m].
		for (let minute = 0; minute < 60; minute += 5) {
			vi.setSystemTime(start + minute * 60_000);
			// eslint-disable-next-line no-await-in-loop
			await fx.t.mutation(internal.crawlSources.tick, {});
		}
		const scheduled = await fx.t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect()
		);
		expect(scheduled).toHaveLength(4);
	});
});

describe("raw capture retention (#33)", () => {
	test("getSource reports the roaster's last successful capture", async () => {
		const fx = await setup();
		await fx.t.run(async (ctx) => {
			const storageId = await ctx.storage.store(new Blob(["{}"]));
			await ctx.db.insert("rawCaptures", {
				capturedAt: T0,
				extractionOk: true,
				roasterId: fx.roasterId,
				storageId,
			});
			await ctx.db.insert("rawCaptures", {
				capturedAt: T0 + 2 * CADENCE_MS,
				extractionOk: true,
				roasterId: fx.roasterId,
				storageId,
			});
			// A later failed capture does not count as the last success.
			await ctx.db.insert("rawCaptures", {
				capturedAt: T0 + 3 * CADENCE_MS,
				extractionOk: false,
				roasterId: fx.roasterId,
				storageId,
			});
		});
		const loaded = await fx.t.query(internal.crawlSources.getSource, {
			crawlSourceId: fx.crawlSourceId,
		});
		expect(loaded?.lastOkCaptureAt).toBe(T0 + 2 * CADENCE_MS);
	});

	test("getSource reports no capture for a fresh roaster", async () => {
		const fx = await setup();
		const loaded = await fx.t.query(internal.crawlSources.getSource, {
			crawlSourceId: fx.crawlSourceId,
		});
		expect(loaded?.lastOkCaptureAt).toBeUndefined();
	});

	test("a failed extraction is always captured; a success at most once a day", () => {
		const now = T0 + 10 * RAW_CAPTURE_SUCCESS_INTERVAL_MS;
		const recent = now - RAW_CAPTURE_SUCCESS_INTERVAL_MS + 60_000;
		const old = now - RAW_CAPTURE_SUCCESS_INTERVAL_MS;
		expect(
			shouldStoreRawCapture({
				extractionOk: false,
				lastOkCaptureAt: recent,
				now,
			})
		).toBe(true);
		expect(
			shouldStoreRawCapture({
				extractionOk: true,
				lastOkCaptureAt: recent,
				now,
			})
		).toBe(false);
		expect(
			shouldStoreRawCapture({ extractionOk: true, lastOkCaptureAt: old, now })
		).toBe(true);
		expect(
			shouldStoreRawCapture({
				extractionOk: true,
				lastOkCaptureAt: undefined,
				now,
			})
		).toBe(true);
	});
});

describe("commit: market confirmation", () => {
	test("a US/USD homepage stamps the market with confirmedAt equal to the commit time", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string, _init?: RequestInit) =>
				htmlResponse(US_USD, "https://www.sey.example.com/")
			)
		);
		const fx = await setup();
		await crawl(fx, T0 + CADENCE_MS, [product("a")]);
		expect(await readSource(fx)).toMatchObject({
			health: "watching",
			market: {
				confirmedAt: T0 + CADENCE_MS,
				country: "US",
				currency: "USD",
				url: "https://www.sey.example.com/",
			},
		});
		const source = await readSource(fx);
		expect(source?.market?.confirmedAt).toBe(source?.lastSuccessAt);
	});

	test.each([
		["a page without Shopify globals", "<html></html>"],
		["a fetch rejection", null],
	])("%s fails closed and the crawl still succeeds", async (_label, html) => {
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string, _init?: RequestInit) =>
				html === null
					? Promise.reject(new Error("offline"))
					: htmlResponse(html, "https://www.sey.example.com/")
			)
		);
		const fx = await setup();
		await crawl(fx, T0 + CADENCE_MS, [product("a")]);
		const source = await readSource(fx);
		expect(source?.health).toBe("watching");
		expect(source?.market).toBeUndefined();
		expect(source?.lastSuccessAt).toBe(T0 + CADENCE_MS);
		const { products } = await readAll(fx);
		expect(products.some((doc) => doc.externalId === "a")).toBe(true);
	});
});
