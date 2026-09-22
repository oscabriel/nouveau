/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = 1_800_000_000_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
});
afterEach(() => {
	vi.useRealTimers();
});

interface Lot {
	description: string;
	grams: number;
	handle: string;
	name: string;
	priceCents: number;
}

/** One fresh US/USD roaster with the given lots, each in stock at one size. */
const setup = async (lots: Lot[]) => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const roasterId = await ctx.db.insert("roasters", {
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
		});
		await ctx.db.insert("crawlSources", {
			cadenceMinutes: 15,
			consecutiveFailures: 0,
			health: "watching",
			lastSuccessAt: NOW,
			market: {
				confirmedAt: NOW,
				country: "US",
				currency: "USD",
				url: "https://coffee.example.com/",
			},
			mode: "products_json",
			nextCrawlDueAt: NOW + 900_000,
			roasterId,
		});
		const productIds: Id<"products">[] = [];
		for (const lot of lots) {
			// oxlint-disable-next-line no-await-in-loop -- fixture rows, in order
			const productId = await ctx.db.insert("products", {
				description: lot.description,
				externalId: lot.handle,
				firstSeenAt: NOW,
				handle: lot.handle,
				lastSeenAt: NOW,
				name: lot.name,
				roasterId,
				status: "current",
			});
			// oxlint-disable-next-line no-await-in-loop -- fixture rows, in order
			await ctx.db.insert("productVariants", {
				available: true,
				grams: lot.grams,
				name: `${lot.grams}g`,
				observedAt: NOW,
				priceCents: lot.priceCents,
				productId,
				sizeObservedAt: NOW,
			});
			productIds.push(productId);
		}
		return { productIds };
	});
	return { t, ...ids };
};

const floral: Lot = {
	description: "A washed coffee with jasmine and apricot notes.",
	grams: 250,
	handle: "floral",
	name: "Ethiopia Floral",
	priceCents: 2000,
};
const chocolate: Lot = {
	description: "A natural coffee with chocolate and dried fig.",
	grams: 340,
	handle: "chocolate",
	name: "Brazil Chocolate",
	priceCents: 1600,
};

test("signed out, ranks in-stock lots by the preference words with the address pair", async () => {
	const f = await setup([chocolate, floral]);
	const result = await f.t.query(api.catalogSearch.findAvailable, {
		preferences: "something floral and washed",
	});
	expect(result.considered).toBe(2);
	expect(result.applied).toEqual({
		maxGrams: null,
		maxPriceCents: null,
		minGrams: null,
	});
	expect(result.lots.map((lot) => lot.handle)).toEqual(["floral", "chocolate"]);
	expect(result.lots[0]).toMatchObject({
		confirmedAt: NOW,
		grams: 250,
		name: "Ethiopia Floral",
		priceCents: 2000,
		productId: f.productIds[1],
		roasterName: "Fixture roaster",
		roasterSlug: "fixture",
		url: "https://coffee.example.com/products/floral",
		variantName: "250g",
	});
	expect(result.lots[0]?.says).toContain("jasmine");
});

test("budget and bag size are hard constraints, echoed back as applied", async () => {
	const f = await setup([chocolate, floral]);
	const cheap = await f.t.query(api.catalogSearch.findAvailable, {
		maxPriceCents: 1800,
		preferences: "floral",
	});
	expect(cheap.applied.maxPriceCents).toBe(1800);
	expect(cheap.lots.map((lot) => lot.handle)).toEqual(["chocolate"]);
	const big = await f.t.query(api.catalogSearch.findAvailable, {
		minGrams: 300,
		preferences: "floral",
	});
	expect(big.lots.map((lot) => lot.handle)).toEqual(["chocolate"]);
	const none = await f.t.query(api.catalogSearch.findAvailable, {
		maxPriceCents: 1000,
		preferences: "floral",
	});
	expect(none).toMatchObject({ considered: 0, lots: [] });
});

test("a nonsense constraint is ignored rather than trusted", async () => {
	const f = await setup([floral]);
	const result = await f.t.query(api.catalogSearch.findAvailable, {
		maxPriceCents: -5,
		minGrams: 0.5,
		preferences: "floral",
	});
	expect(result.applied).toEqual({
		maxGrams: null,
		maxPriceCents: null,
		minGrams: null,
	});
	expect(result.lots).toHaveLength(1);
});

test("a stale crawl drops the roaster from the selection", async () => {
	const f = await setup([floral]);
	vi.setSystemTime(NOW + 2 * 60 * 60 * 1000);
	const result = await f.t.query(api.catalogSearch.findAvailable, {
		preferences: "floral",
	});
	expect(result).toMatchObject({ considered: 0, lots: [] });
});
