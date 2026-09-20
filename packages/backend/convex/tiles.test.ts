import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	photoLotId: Id<"products">;
	photoLotBId: Id<"products">;
	plainLotId: Id<"products">;
	t: ReturnType<typeof convexTest>;
	userA: Id<"users">;
	userB: Id<"users">;
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
		const lot = (externalId: string) => ({
			externalId,
			firstSeenAt: 1000,
			handle: externalId,
			lastSeenAt: 1000,
			missedCrawls: 0,
			name: `Lot ${externalId}`,
			roasterId: roaster,
			status: "current" as const,
		});
		const photoLot = await ctx.db.insert("products", {
			...lot("mullugeta"),
			imageUrl: "https://cdn.example.com/mullugeta.jpg",
		});
		const photoLotB = await ctx.db.insert("products", {
			...lot("kenia"),
			imageUrl: "https://cdn.example.com/kenia.jpg",
		});
		const plainLot = await ctx.db.insert("products", lot("guji"));
		const userA = await ctx.db.insert("users", {
			name: "Taster One",
			providerAccountId: "google-1",
		});
		const userB = await ctx.db.insert("users", {
			name: "Taster Two",
			providerAccountId: "google-2",
		});
		return { photoLot, photoLotB, plainLot, userA, userB };
	});
	return {
		photoLotBId: ids.photoLotB,
		photoLotId: ids.photoLot,
		plainLotId: ids.plainLot,
		t,
		userA: ids.userA,
		userB: ids.userB,
	};
};

/** A rated log row, inserted directly so loggedAt stays in test control. */
const log = async (
	t: Fixture["t"],
	userId: Id<"users">,
	productId: Id<"products">,
	loggedAt: number,
	rating: number
): Promise<void> => {
	await t.run(async (ctx) => {
		await ctx.db.insert("logs", { loggedAt, productId, rating, userId });
	});
};

/** An alert-worthy "new" drop event, the padding's source. */
const drop = async (
	t: Fixture["t"],
	productId: Id<"products">,
	detectedAt: number
): Promise<void> => {
	await t.run(async (ctx) => {
		const lot = await ctx.db.get(productId);
		if (lot === null) {
			throw new Error("missing lot");
		}
		await ctx.db.insert("dropEvents", {
			detectedAt,
			productId,
			roasterId: lot.roasterId,
			type: "new",
		});
	});
};

describe("rated tiles", () => {
	test("a rated log on a photographed lot becomes a log tile", async () => {
		const { photoLotId, t, userA } = await setup();
		await log(t, userA, photoLotId, 1000, 4.5);

		const tiles = await t.query(api.tiles.ratedTiles, {});
		expect(tiles).toHaveLength(1);
		expect(tiles[0]).toMatchObject({
			handle: "mullugeta",
			imageUrl: "https://cdn.example.com/mullugeta.jpg",
			kind: "log",
			name: "Lot mullugeta",
			rating: 4.5,
			roaster: { name: "Sey", slug: "sey" },
		});
	});

	test("unrated logs and photoless lots never tile; drops pad the slots", async () => {
		const { photoLotBId, photoLotId, plainLotId, t, userA, userB } =
			await setup();
		await log(t, userA, photoLotId, 1000, 4);
		await t.run(async (ctx) => {
			await ctx.db.insert("logs", {
				loggedAt: 1001,
				productId: photoLotId,
				userId: userA,
			});
		});
		await log(t, userB, plainLotId, 2000, 3);
		// The newest drop is on the already-tiled lot, so it is skipped; the
		// slot still pads from the next photographed drop.
		await drop(t, photoLotId, 6000);
		await drop(t, photoLotBId, 5000);

		const tiles = await t.query(api.tiles.ratedTiles, {});
		expect(tiles).toHaveLength(2);
		expect(tiles[0]).toMatchObject({ handle: "mullugeta", kind: "log" });
		expect(tiles[1]).toMatchObject({
			kind: "drop",
			name: "Lot kenia",
			rating: null,
		});
	});

	test("drops alone fill the tiles until the first rating", async () => {
		const { photoLotBId, photoLotId, t } = await setup();
		await drop(t, photoLotId, 6000);
		await drop(t, photoLotBId, 5000);

		const tiles = await t.query(api.tiles.ratedTiles, {});
		expect(tiles).toHaveLength(2);
		expect(tiles.map((tile) => tile.kind)).toEqual(["drop", "drop"]);
		expect(tiles[0]?.handle).toBe("mullugeta");
	});

	test("one taster cannot fill all three tiles", async () => {
		const { photoLotBId, photoLotId, t, userA, userB } = await setup();
		await log(t, userA, photoLotId, 1000, 3);
		await log(t, userA, photoLotBId, 2000, 4);
		await log(t, userB, photoLotId, 3000, 5);

		const tiles = await t.query(api.tiles.ratedTiles, {});
		expect(tiles).toHaveLength(2);
		// Newest ratings first; Taster One's older rating is dropped.
		expect(tiles[0]).toMatchObject({ handle: "mullugeta", rating: 5 });
		expect(tiles[1]).toMatchObject({ handle: "kenia", rating: 4 });
	});

	test("tiles order by log time, newest first", async () => {
		const { photoLotBId, photoLotId, t, userA, userB } = await setup();
		await log(t, userA, photoLotId, 1000, 3);
		await log(t, userB, photoLotBId, 2000, 4.5);

		const tiles = await t.query(api.tiles.ratedTiles, {});
		expect(tiles.map((tile) => tile.rating)).toEqual([4.5, 3]);
	});

	test("a lot already shown as a rated tile is not shown again as a drop", async () => {
		const { photoLotId, t, userA } = await setup();
		await log(t, userA, photoLotId, 1000, 4);
		await drop(t, photoLotId, 6000);

		const tiles = await t.query(api.tiles.ratedTiles, {});
		expect(tiles).toHaveLength(1);
		expect(tiles[0]?.kind).toBe("log");
	});

	test("shuffle draws three from the deduped pool and stays stable per seed", async () => {
		const { photoLotBId, photoLotId, t } = await setup();
		// Five tasters, five rated logs across the two photographed lots: a
		// deduped pool of five, larger than the three-tile draw. Insertion
		// order is irrelevant; loggedAt orders the pool.
		await t.run(async (ctx) => {
			const users = await Promise.all(
				[0, 1, 2, 3, 4].map((index) =>
					ctx.db.insert("users", {
						name: `Taster ${index}`,
						providerAccountId: `google-${index}`,
					})
				)
			);
			await Promise.all(
				users.map((user, index) =>
					ctx.db.insert("logs", {
						loggedAt: 1000 + index,
						productId: index % 2 === 0 ? photoLotId : photoLotBId,
						rating: 3 + (index % 3),
						userId: user,
					})
				)
			);
		});

		const first = await t.query(api.tiles.ratedTiles, { shuffleSeed: 42 });
		const again = await t.query(api.tiles.ratedTiles, { shuffleSeed: 42 });
		expect(first).toEqual(again);
		expect(first).toHaveLength(3);
		for (const tile of first) {
			expect(tile.kind).toBe("log");
			expect(["mullugeta", "kenia"]).toContain(tile.handle);
		}

		const other = await t.query(api.tiles.ratedTiles, { shuffleSeed: 7 });
		// A different seed redraws from the same pool, same lot vocabulary.
		expect(other).toHaveLength(3);
		for (const tile of other) {
			expect(["mullugeta", "kenia"]).toContain(tile.handle);
		}
	});
});
