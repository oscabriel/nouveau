/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	lotId: Id<"products">;
	otherLotId: Id<"products">;
	otherUserId: Id<"users">;
	t: ReturnType<typeof convexTest>;
	userId: Id<"users">;
}

const setup = async (): Promise<Fixture> => {
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
			status: "active",
			websiteUrl: "https://sey.example.com",
		});
		const lot = await ctx.db.insert("products", {
			anyAvailable: true,
			externalId: "p1",
			firstSeenAt: 1000,
			handle: "mullugeta",
			imageUrl: "https://sey.example.com/mullugeta.jpg",
			lastSeenAt: 1000,
			name: "Ethiopia Mullugeta Muntasha",
			roasterId: roaster,
			status: "current",
		});
		await ctx.db.insert("productVariants", {
			available: true,
			name: "250g",
			priceCents: 2400,
			productId: lot,
		});
		const otherLot = await ctx.db.insert("products", {
			anyAvailable: true,
			externalId: "p2",
			firstSeenAt: 900,
			handle: "old-lot",
			lastSeenAt: 900,
			name: "Colombia Old Lot",
			roasterId: roaster,
			status: "archived",
		});
		await ctx.db.insert("productVariants", {
			available: true,
			name: "250g",
			priceCents: 2200,
			productId: otherLot,
		});
		const user = await ctx.db.insert("users", { providerAccountId: "g-1" });
		const otherUser = await ctx.db.insert("users", {
			providerAccountId: "g-2",
		});
		return { lot, otherLot, otherUser, user };
	});
	return {
		lotId: ids.lot,
		otherLotId: ids.otherLot,
		otherUserId: ids.otherUser,
		t,
		userId: ids.user,
	};
};

const insertRun = (f: Fixture, userId: Id<"users">) =>
	f.t.run((ctx) =>
		ctx.db.insert("recommendationRuns", {
			attempt: 1,
			candidates: [],
			createdAt: 1000,
			enrichments: 0,
			input: {
				includeNotes: false,
				preferences: "A floral washed coffee",
			},
			message: "Ready",
			requestKey: "k",
			selections: [],
			status: "ready",
			updatedAt: 1000,
			userId,
		})
	);

const firstPage = { cursor: null, numItems: 10 };

describe("savedCoffees", () => {
	test("requires sign-in to save, and lists nothing when signed out", async () => {
		const f = await setup();
		await expect(
			f.t.mutation(api.savedCoffees.save, { productId: f.lotId })
		).rejects.toThrow("Sign in required");
		expect(await f.t.query(api.savedCoffees.mySavedProductIds)).toEqual([]);
		expect(await f.t.query(api.savedCoffees.recentMine)).toEqual({
			items: [],
			more: false,
		});
	});

	test("save then unsave; both are idempotent", async () => {
		const f = await setup();
		const me = asUser(f.t, f.userId);
		await me.mutation(api.savedCoffees.save, { productId: f.lotId });
		await me.mutation(api.savedCoffees.save, { productId: f.lotId });
		expect(await me.query(api.savedCoffees.mySavedProductIds)).toEqual([
			f.lotId,
		]);
		const page = await me.query(api.savedCoffees.listMine, {
			paginationOpts: firstPage,
		});
		expect(page.page).toHaveLength(1);
		expect(page.page[0]).toMatchObject({
			available: true,
			fromRunId: null,
			lot: {
				id: f.lotId,
				imageUrl: "https://sey.example.com/mullugeta.jpg",
				name: "Ethiopia Mullugeta Muntasha",
				status: "current",
				url: "https://sey.example.com/products/mullugeta",
			},
			roaster: { name: "Sey", slug: "sey" },
		});

		await me.mutation(api.savedCoffees.unsave, { productId: f.lotId });
		await me.mutation(api.savedCoffees.unsave, { productId: f.lotId });
		expect(await me.query(api.savedCoffees.mySavedProductIds)).toEqual([]);
	});

	test("two users cannot see each other's saves", async () => {
		const f = await setup();
		const me = asUser(f.t, f.userId);
		const other = asUser(f.t, f.otherUserId);
		await me.mutation(api.savedCoffees.save, { productId: f.lotId });
		await other.mutation(api.savedCoffees.save, { productId: f.otherLotId });

		expect(await me.query(api.savedCoffees.mySavedProductIds)).toEqual([
			f.lotId,
		]);
		expect(await other.query(api.savedCoffees.mySavedProductIds)).toEqual([
			f.otherLotId,
		]);
		const mine = await me.query(api.savedCoffees.recentMine);
		expect(mine.items.map((item) => item.lot.id)).toEqual([f.lotId]);

		// Unsaving a lot you never saved touches nothing of the other user's.
		await me.mutation(api.savedCoffees.unsave, { productId: f.otherLotId });
		expect(await other.query(api.savedCoffees.mySavedProductIds)).toEqual([
			f.otherLotId,
		]);

		// The public profile stays free of saves (spec §6).
		const profile = await f.t.query(api.logs.profile, { userId: f.userId });
		expect(profile).not.toBeNull();
		expect(JSON.stringify(profile)).not.toContain("saved");
	});

	test("saving from a run records fromRunId, but only the caller's own run", async () => {
		const f = await setup();
		const me = asUser(f.t, f.userId);
		const myRun = await insertRun(f, f.userId);
		const foreignRun = await insertRun(f, f.otherUserId);

		await me.mutation(api.savedCoffees.save, {
			fromRunId: myRun,
			productId: f.lotId,
		});
		await me.mutation(api.savedCoffees.save, {
			fromRunId: foreignRun,
			productId: f.otherLotId,
		});

		const page = await me.query(api.savedCoffees.listMine, {
			paginationOpts: firstPage,
		});
		const byLot = new Map(page.page.map((item) => [item.lot.id, item]));
		expect(byLot.get(f.lotId)?.fromRunId).toBe(myRun);
		expect(byLot.get(f.otherLotId)?.fromRunId).toBeNull();
		// Archived lots are never "available", whatever their rollup says.
		expect(byLot.get(f.otherLotId)?.available).toBe(false);
		// The saved lot reads the crawl's rollup, not a capped variant scan.
		expect(byLot.get(f.lotId)?.available).toBe(true);
	});

	test("recentMine caps the home section and flags more", async () => {
		const f = await setup();
		const me = asUser(f.t, f.userId);
		const lots = await f.t.run(async (ctx) => {
			const roaster = await ctx.db.query("roasters").first();
			if (roaster === null) {
				throw new Error("fixture roaster missing");
			}
			return Promise.all(
				[0, 1, 2, 3, 4, 5].map((i) =>
					ctx.db.insert("products", {
						externalId: `x${i}`,
						firstSeenAt: 1000,
						handle: `x${i}`,
						lastSeenAt: 1000,
						name: `Lot ${i}`,
						roasterId: roaster._id,
						status: "current",
					})
				)
			);
		});
		await Promise.all(
			lots.map((productId) => me.mutation(api.savedCoffees.save, { productId }))
		);
		const recent = await me.query(api.savedCoffees.recentMine);
		expect(recent.items).toHaveLength(5);
		expect(recent.more).toBe(true);
		// No rollup yet (crawled before ADR-0007) is unknown stock, not sold out.
		expect(recent.items[0]?.available).toBeNull();
	});
});
