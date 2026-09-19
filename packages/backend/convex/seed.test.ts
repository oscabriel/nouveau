/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const cadenceBySlug = (
	t: ReturnType<typeof convexTest>
): Promise<Record<string, number>> =>
	t.run(async (ctx) => {
		const sources = await ctx.db.query("crawlSources").collect();
		const pairs = await Promise.all(
			sources.map(async (source) => {
				const roaster = await ctx.db.get(source.roasterId);
				return roaster === null
					? null
					: ([roaster.slug, source.cadenceMinutes] as const);
			})
		);
		return Object.fromEntries(pairs.filter((pair) => pair !== null));
	});

describe("seed cadence table (#33)", () => {
	test("seedCuratedRoasters sets each roaster's cadence", async () => {
		const t = convexTest(schema, modules);
		await t.mutation(internal.seed.seedCuratedRoasters, {});
		const cadence = await cadenceBySlug(t);
		expect(cadence.proudmarycoffee).toBe(15);
		expect(cadence.vervecoffee).toBe(15);
		expect(cadence.drinkpassenger).toBe(15);
		expect(cadence.intelligentsia).toBe(30);
		expect(cadence.meritcoffee).toBe(30);
		expect(cadence.heartroasters).toBe(60);
		expect(cadence.eastpole).toBe(60);
		expect(Object.keys(cadence)).toHaveLength(20);
	});

	test("applySeedCadence patches existing sources by slug and leaves others", async () => {
		const t = convexTest(schema, modules);
		await t.mutation(internal.seed.seedCuratedRoasters, {});
		// A stale deployment: every source still on the old default.
		const otherSource = await t.run(async (ctx) => {
			const sources = await ctx.db.query("crawlSources").collect();
			await Promise.all(
				sources.map((source) =>
					ctx.db.patch(source._id, { cadenceMinutes: 60 })
				)
			);
			const roaster = await ctx.db.insert("roasters", {
				city: "Nowhere",
				claimed: false,
				domain: "other.example.com",
				name: "Other",
				productPageUrl: "https://other.example.com/collections/all",
				slug: "other",
				source: "curated",
				state: "ZZ",
				status: "pending",
				websiteUrl: "https://other.example.com",
			});
			return ctx.db.insert("crawlSources", {
				cadenceMinutes: 45,
				consecutiveFailures: 0,
				health: "watching",
				mode: "products_json",
				nextCrawlDueAt: 0,
				roasterId: roaster,
			});
		});

		const result = await t.mutation(internal.seed.applySeedCadence, {});

		const cadence = await cadenceBySlug(t);
		expect(result).toEqual({ patched: 13, unchanged: 7 });
		expect(cadence.seycoffee).toBe(15);
		expect(cadence.regaliacoffee).toBe(30);
		expect(cadence.lacolombe).toBe(60);
		expect(cadence.other).toBe(45);
		const other = await t.run((ctx) => ctx.db.get(otherSource));
		expect(other?.cadenceMinutes).toBe(45);
	});

	test("applySeedUrls repoints a roaster whose shop URLs drifted from the table and leaves the rest", async () => {
		const t = convexTest(schema, modules);
		await t.mutation(internal.seed.seedCuratedRoasters, {});
		// The 17abf56 paste: La Colombe carried Passenger's www host.
		await t.run(async (ctx) => {
			const roaster = await ctx.db
				.query("roasters")
				.withIndex("by_slug", (q) => q.eq("slug", "lacolombe"))
				.unique();
			if (roaster === null) {
				throw new Error("seed missing");
			}
			await ctx.db.patch(roaster._id, {
				productPageUrl: "https://www.drinkpassenger.com/collections/coffee",
				websiteUrl: "https://www.drinkpassenger.com",
			});
		});

		const result = await t.mutation(internal.seed.applySeedUrls, {});

		expect(result).toEqual({ patched: 1, unchanged: 19 });
		const urls = await t.run(async (ctx) => {
			const rows = await ctx.db.query("roasters").collect();
			return Object.fromEntries(
				rows.map((row) => [row.slug, [row.websiteUrl, row.productPageUrl]])
			);
		});
		expect(urls.lacolombe).toEqual([
			"https://lacolombe.com",
			"https://lacolombe.com/collections/coffee",
		]);
		expect(urls.drinkpassenger).toEqual([
			"https://www.drinkpassenger.com",
			"https://www.drinkpassenger.com/collections/coffee",
		]);
		expect(urls.coavacoffee).toEqual([
			"https://shop.coavacoffee.com",
			"https://shop.coavacoffee.com/collections/all",
		]);
	});
});
