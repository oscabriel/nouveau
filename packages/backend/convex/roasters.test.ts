/// <reference types="vite/client" />
import { register } from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { LOT_SEARCH_LIMIT } from "./constants";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
	const t = convexTest(schema, modules);
	register(t);
	const ids = await t.run(async (ctx) => {
		const active = await ctx.db.insert("roasters", {
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
		const pending = await ctx.db.insert("roasters", {
			city: "Portland",
			claimed: false,
			domain: "pending.example.com",
			name: "Pending",
			productPageUrl: "https://pending.example.com/collections/coffee",
			slug: "pending",
			source: "curated",
			state: "OR",
			status: "pending",
			websiteUrl: "https://pending.example.com",
		});
		await ctx.db.insert("crawlSources", {
			cadenceMinutes: 60,
			consecutiveFailures: 2,
			health: "crawl_failed",
			lastCheckedAt: 1000,
			mode: "products_json",
			nextCrawlDueAt: 3000,
			roasterId: active,
		});
		const user = await ctx.db.insert("users", {
			providerAccountId: "google-123",
		});
		const watchId = await ctx.db.insert("watches", {
			muted: false,
			roasterId: active,
			userId: user,
		});
		return { active, pending, watchId };
	});
	return { ...ids, t };
};

/** Row ids in a fixed order, for set comparisons. */
const ids = (rows: { id: string }[]) =>
	// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; map copies first
	rows.map((row) => row.id).sort();
// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; spread copies first
const sorted = (list: string[]) => [...list].sort();

describe("roasters", () => {
	test("listActive returns only active roasters with source health", async () => {
		const { t } = await setup();
		const roasters = await t.query(api.roasters.listActive, {});
		expect(roasters).toHaveLength(1);
		expect(roasters[0]).toMatchObject({
			slug: "sey",
			status: { health: "crawl_failed", lastCheckedAt: 1000 },
		});
	});

	test("getBySlug resolves active roasters and hides others", async () => {
		const { pending, t } = await setup();
		const found = await t.query(api.roasters.getBySlug, { slug: "sey" });
		expect(found).toMatchObject({
			slug: "sey",
			status: { health: "crawl_failed" },
		});
		expect(
			await t.query(api.roasters.getBySlug, { slug: "pending" })
		).toBeNull();
		expect(pending).toBeDefined();
	});

	test("the directory counters ride the summary; absent counts read 0", async () => {
		const { active, t } = await setup();
		let roasters = await t.query(api.roasters.listActive, {});
		expect(roasters[0]).toMatchObject({ lotCount: 0, newLotCount: 0 });

		await t.run(async (ctx) => {
			await ctx.db.patch(active, { lotCount: 12, newLotCount: 3 });
		});
		roasters = await t.query(api.roasters.listActive, {});
		expect(roasters[0]).toMatchObject({ lotCount: 12, newLotCount: 3 });
	});

	test("the lot rows carry the rollup and the stock boundary", async () => {
		const { active, t } = await setup();
		await t.run(async (ctx) => {
			const inStock = await ctx.db.insert("products", {
				anyAvailable: true,
				externalId: "a1",
				firstSeenAt: 1000,
				handle: "lot-a",
				lastSeenAt: 1000,
				minPriceCents: 1800,
				name: "In-stock lot",
				origin: "Colombia",
				roasterId: active,
				status: "current",
				weightOptions: [250, 1000],
			});
			await ctx.db.insert("productVariants", {
				available: true,
				grams: 250,
				name: "250g",
				priceCents: 1800,
				productId: inStock,
			});
			await ctx.db.insert("productVariants", {
				available: false,
				grams: 1000,
				name: "1kg",
				priceCents: 5600,
				productId: inStock,
			});
			const soldOut = await ctx.db.insert("products", {
				anyAvailable: false,
				externalId: "a2",
				firstSeenAt: 1000,
				handle: "lot-b",
				lastSeenAt: 1000,
				minPriceCents: 2200,
				name: "Sold-out lot",
				origin: "Ethiopia",
				roasterId: active,
				status: "current",
				weightOptions: [250],
			});
			await ctx.db.insert("productVariants", {
				available: false,
				grams: 250,
				name: "250g",
				priceCents: 2200,
				productId: soldOut,
			});
			// Crawled before the rollup existed: variants, no anyAvailable.
			const unrolled = await ctx.db.insert("products", {
				externalId: "a3",
				firstSeenAt: 1000,
				handle: "lot-c",
				lastSeenAt: 1000,
				name: "Unrolled lot",
				roasterId: active,
				status: "current",
			});
			await ctx.db.insert("productVariants", {
				available: true,
				grams: 250,
				name: "250g",
				priceCents: 2000,
				productId: unrolled,
			});
			await ctx.db.insert("products", {
				anyAvailable: true,
				externalId: "a4",
				firstSeenAt: 1000,
				handle: "lot-d",
				lastSeenAt: 1000,
				name: "Archived lot",
				roasterId: active,
				status: "archived",
			});
		});
		const rows = await t.query(api.roasters.listLots, {
			paginationOpts: { cursor: null, numItems: 10 },
			roasterId: active,
		});
		const byName = Object.fromEntries(rows.page.map((row) => [row.name, row]));
		expect(byName["In-stock lot"]).toMatchObject({
			available: true,
			minPriceCents: 1800,
		});
		expect(byName["Sold-out lot"]).toMatchObject({ available: false });
		// ADR-0007: an absent rollup is unknown, never sold out.
		expect(byName["Unrolled lot"]).toMatchObject({ available: null });
		expect(byName["Archived lot"]).toMatchObject({ available: false });
		// Unknown stock is not "in stock" either.
		const inStock = await t.query(api.roasters.listLotsFiltered, {
			availableOnly: true,
			roasterId: active,
		});
		expect(inStock.map((row) => row.name)).toEqual(["In-stock lot"]);
	});

	test("the notes column shows the page read's notes when the feed has none (ADR-0008)", async () => {
		const { active, t } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.insert("products", {
				externalId: "p1",
				firstSeenAt: 1000,
				handle: "page-notes-lot",
				lastSeenAt: 1000,
				name: "Page-notes lot",
				pageFacts: { tastingNotes: ["Tart Apple", "Pecan", "Fig"] },
				roasterId: active,
				status: "current",
			});
			await ctx.db.insert("products", {
				externalId: "p2",
				firstSeenAt: 1000,
				handle: "feed-notes-lot",
				lastSeenAt: 1000,
				name: "Feed-notes lot",
				pageFacts: { tastingNotes: ["cardboard"] },
				roasterId: active,
				roasterNotes: ["peach", "melon"],
				status: "current",
			});
		});
		const rows = await t.query(api.roasters.listLots, {
			paginationOpts: { cursor: null, numItems: 10 },
			roasterId: active,
		});
		const byName = Object.fromEntries(rows.page.map((row) => [row.name, row]));
		expect(byName["Page-notes lot"]?.roasterNotes).toBe(
			"Tart Apple, Pecan, Fig"
		);
		// The feed's own notes still win over the page's.
		expect(byName["Feed-notes lot"]?.roasterNotes).toBe("peach, melon");
		// The tagged copy carries each word with its wheel family for the pills.
		expect(byName["Page-notes lot"]?.roasterTags).toEqual([
			// "Tart Apple" is not a wheel term (the wheel has "apple"): no family.
			{ family: null, note: "Tart Apple" },
			{ family: "nutty/cocoa", note: "Pecan" },
			{ family: "fruity", note: "Fig" },
		]);
		expect(byName["Feed-notes lot"]?.roasterTags).toEqual([
			{ family: "fruity", note: "peach" },
			{ family: "fruity", note: "melon" },
		]);
	});

	test("lotWeightOptions is the catalog's distinct sizes, ascending", async () => {
		const { active, t } = await setup();
		await t.run(async (ctx) => {
			const sizes: number[][] = [[1000, 250], [250], [], [2000, 500]];
			for (const [i, weightOptions] of sizes.entries()) {
				// eslint-disable-next-line no-await-in-loop -- fixture rows in a fixed order
				await ctx.db.insert("products", {
					externalId: `w${i}`,
					firstSeenAt: 1000,
					handle: `lot-w${i}`,
					lastSeenAt: 1000,
					name: `Lot ${i}`,
					roasterId: active,
					status: "current",
					...(weightOptions.length === 0 ? {} : { weightOptions }),
				});
			}
		});
		expect(
			await t.query(api.roasters.lotWeightOptions, { roasterId: active })
		).toEqual([250, 500, 1000, 2000]);
	});

	test("lot rows carry the photo URL for the floating hover image (ADR-0015)", async () => {
		const { active, t } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.insert("products", {
				externalId: "img1",
				firstSeenAt: 1000,
				handle: "photo-lot",
				imageUrl: "https://cdn.shopify.com/beans.jpg",
				lastSeenAt: 1000,
				name: "Photo lot",
				roasterId: active,
				status: "current",
			});
			await ctx.db.insert("products", {
				externalId: "img2",
				firstSeenAt: 1000,
				handle: "no-photo-lot",
				lastSeenAt: 1000,
				name: "No-photo lot",
				roasterId: active,
				status: "current",
			});
		});
		const rows = await t.query(api.roasters.listLots, {
			paginationOpts: { cursor: null, numItems: 10 },
			roasterId: active,
		});
		const byName = Object.fromEntries(rows.page.map((row) => [row.name, row]));
		expect(byName["Photo lot"]?.imageUrl).toBe(
			"https://cdn.shopify.com/beans.jpg"
		);
		// A lot the crawl never gave a photo reads as null, not undefined.
		expect(byName["No-photo lot"]?.imageUrl).toBeNull();
		const filtered = await t.query(api.roasters.listLotsFiltered, {
			roasterId: active,
		});
		// The filtered query maps through the same row builder: the field is
		// always present, string or null.
		expect(filtered.map((row) => row.imageUrl ?? null)).toEqual([
			"https://cdn.shopify.com/beans.jpg",
			null,
		]);
	});

	test("listLotsFiltered applies every filter axis", async () => {
		const { active, t } = await setup();
		const lots = await t.run(async (ctx) => {
			const insert = (
				externalId: string,
				fields: {
					anyAvailable: boolean;
					minPriceCents: number;
					name: string;
					origin: string;
					weightOptions: number[];
				}
			) =>
				ctx.db.insert("products", {
					externalId,
					firstSeenAt: 1000,
					handle: `lot-${externalId}`,
					lastSeenAt: 1000,
					roasterId: active,
					status: "current",
					...fields,
				});
			return {
				colombiaCheap: await insert("c1", {
					anyAvailable: true,
					minPriceCents: 1600,
					name: "Cheap Colombia",
					origin: "Colombia",
					weightOptions: [250],
				}),
				colombiaRich: await insert("c2", {
					anyAvailable: true,
					minPriceCents: 3600,
					name: "Rich Colombia",
					origin: "Colombia",
					weightOptions: [1000],
				}),
				ethSoldOut: await insert("e1", {
					anyAvailable: false,
					minPriceCents: 2800,
					name: "Sold-out Ethiopia",
					origin: "Ethiopia",
					weightOptions: [500],
				}),
				// Cheap but a kilo, in stock but not Colombia: keeps each axis
				// from standing in for another.
				kenyaCheapKilo: await insert("k1", {
					anyAvailable: true,
					minPriceCents: 1500,
					name: "Cheap Kenya Kilo",
					origin: "Kenya",
					weightOptions: [1000],
				}),
			};
		});
		const inStock = await t.query(api.roasters.listLotsFiltered, {
			availableOnly: true,
			roasterId: active,
		});
		expect(ids(inStock)).toEqual(
			sorted([lots.colombiaCheap, lots.colombiaRich, lots.kenyaCheapKilo])
		);
		const cheap = await t.query(api.roasters.listLotsFiltered, {
			maxPriceCents: 2000,
			roasterId: active,
		});
		expect(ids(cheap)).toEqual(
			sorted([lots.colombiaCheap, lots.kenyaCheapKilo])
		);
		const colombia = await t.query(api.roasters.listLotsFiltered, {
			origin: "colo",
			roasterId: active,
		});
		expect(ids(colombia)).toEqual(
			sorted([lots.colombiaCheap, lots.colombiaRich])
		);
		const quarterKilo = await t.query(api.roasters.listLotsFiltered, {
			grams: 250,
			roasterId: active,
		});
		expect(ids(quarterKilo)).toEqual([lots.colombiaCheap]);
		const kilo = await t.query(api.roasters.listLotsFiltered, {
			grams: 1000,
			roasterId: active,
		});
		expect(ids(kilo)).toEqual(sorted([lots.colombiaRich, lots.kenyaCheapKilo]));
		// Axes combine: cheap and in stock and 250 g is one lot.
		const combined = await t.query(api.roasters.listLotsFiltered, {
			availableOnly: true,
			grams: 250,
			maxPriceCents: 2000,
			roasterId: active,
		});
		expect(ids(combined)).toEqual([lots.colombiaCheap]);
	});

	test("searchLots filters inside the scan, not after the result limit", async () => {
		const { active, t } = await setup();
		await t.run(async (ctx) => {
			// More sold-out name matches than the result limit, then one in stock.
			for (let i = 0; i < LOT_SEARCH_LIMIT + 5; i += 1) {
				// eslint-disable-next-line no-await-in-loop -- fixture rows in a fixed order
				await ctx.db.insert("products", {
					anyAvailable: false,
					externalId: `s${i}`,
					firstSeenAt: 1000,
					handle: `lot-s${i}`,
					lastSeenAt: 1000,
					name: `Colombia Lot ${i}`,
					roasterId: active,
					status: "current",
				});
			}
			await ctx.db.insert("products", {
				anyAvailable: true,
				externalId: "s-last",
				firstSeenAt: 1000,
				handle: "lot-s-last",
				lastSeenAt: 1000,
				name: "Colombia Lot Last",
				roasterId: active,
				status: "current",
			});
		});
		const inStock = await t.query(api.roasters.searchLots, {
			availableOnly: true,
			roasterId: active,
			term: "colombia",
		});
		expect(inStock.map((row) => row.name)).toEqual(["Colombia Lot Last"]);
		const all = await t.query(api.roasters.searchLots, {
			roasterId: active,
			term: "colombia",
		});
		expect(all).toHaveLength(LOT_SEARCH_LIMIT);
	});

	test("searchLots carries the same filters", async () => {
		const { active, t } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.insert("products", {
				anyAvailable: true,
				externalId: "c1",
				firstSeenAt: 1000,
				handle: "lot-c1",
				lastSeenAt: 1000,
				minPriceCents: 1600,
				name: "Cheap Colombia Washed",
				origin: "Colombia",
				roasterId: active,
				status: "current",
			});
			await ctx.db.insert("products", {
				anyAvailable: false,
				externalId: "c2",
				firstSeenAt: 1000,
				handle: "lot-c2",
				lastSeenAt: 1000,
				minPriceCents: 1200,
				name: "Cheap Colombia Natural",
				origin: "Colombia",
				roasterId: active,
				status: "current",
			});
		});
		const inStock = await t.query(api.roasters.searchLots, {
			availableOnly: true,
			roasterId: active,
			term: "colombia",
		});
		expect(inStock).toHaveLength(1);
		expect(inStock[0]?.name).toBe("Cheap Colombia Washed");
	});
});
