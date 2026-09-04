import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { LOG_FEED_LIMIT } from "./constants";
import { isValidRating } from "./logs";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	archivedLotId: Id<"products">;
	lotId: Id<"products">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
	userB: Id<"users">;
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
			externalId: "p1",
			firstSeenAt: 1000,
			handle: "mullugeta",
			lastSeenAt: 1000,
			missedCrawls: 0,
			name: "Ethiopia Mullugeta Muntasha",
			roasterId: roaster,
			status: "current",
		});
		const archivedLot = await ctx.db.insert("products", {
			externalId: "p2",
			firstSeenAt: 900,
			handle: "old-lot",
			lastSeenAt: 900,
			missedCrawls: 3,
			name: "Colombia Old Lot",
			roasterId: roaster,
			status: "archived",
		});
		const userId = await ctx.db.insert("users", {
			name: "Taster One",
			providerAccountId: "google-1",
		});
		const userB = await ctx.db.insert("users", {
			name: "Taster Two",
			providerAccountId: "google-2",
		});
		return { archivedLot, lot, roaster, userB, userId };
	});
	return {
		archivedLotId: ids.archivedLot,
		lotId: ids.lot,
		roasterId: ids.roaster,
		t,
		userB: ids.userB,
		userId: ids.userId,
	};
};

describe("rating rules", () => {
	test("ratings are 1–5 in half steps", () => {
		expect(isValidRating(1)).toBe(true);
		expect(isValidRating(3.5)).toBe(true);
		expect(isValidRating(5)).toBe(true);
		expect(isValidRating(0.5)).toBe(false);
		expect(isValidRating(5.5)).toBe(false);
		expect(isValidRating(3.25)).toBe(false);
		expect(isValidRating(0)).toBe(false);
	});
});

describe("logs", () => {
	test("a log hydrates into the activity feed with user, lot and roaster", async () => {
		const { lotId, t, userId } = await setup();
		await asUser(t, userId).mutation(api.logs.createLog, {
			notes: "Jasmine and apricot, better at 1:16.",
			productId: lotId,
			rating: 4.5,
		});

		const feed = await t.query(api.logs.recentLogs, {});
		expect(feed).toHaveLength(1);
		expect(feed[0]).toMatchObject({
			lot: { handle: "mullugeta", name: "Ethiopia Mullugeta Muntasha" },
			notes: "Jasmine and apricot, better at 1:16.",
			rating: 4.5,
			roaster: { name: "Sey", slug: "sey" },
			user: { id: userId, name: "Taster One" },
		});
	});

	test("the activity feed is newest first and bounded", async () => {
		const { lotId, t, userId } = await setup();
		// Sequential on purpose: loggedAt comes from Date.now() inside the
		// mutation, and the newest-first assertion needs stable insertion order.
		for (let i = 0; i < LOG_FEED_LIMIT + 5; i += 1) {
			// oxlint-disable-next-line no-await-in-loop -- ordering matters
			await asUser(t, userId).mutation(api.logs.createLog, {
				notes: `brew ${i}`,
				productId: lotId,
			});
		}
		const feed = await t.query(api.logs.recentLogs, {});
		expect(feed).toHaveLength(LOG_FEED_LIMIT);
		expect(feed[0]?.notes).toBe(`brew ${LOG_FEED_LIMIT + 4}`);
	});

	test("invalid ratings and overlong notes are rejected", async () => {
		const { lotId, t, userId } = await setup();
		const log = asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 6,
		});
		await expect(log).rejects.toThrow("Rating");
		await expect(
			asUser(t, userId).mutation(api.logs.createLog, {
				productId: lotId,
				rating: 3.25,
			})
		).rejects.toThrow("Rating");
		await expect(
			asUser(t, userId).mutation(api.logs.createLog, {
				notes: "x".repeat(1001),
				productId: lotId,
			})
		).rejects.toThrow("characters");
	});

	test("signed-out visitors cannot log", async () => {
		const { lotId, t } = await setup();
		await expect(
			t.mutation(api.logs.createLog, { productId: lotId, rating: 4 })
		).rejects.toThrow("Sign in");
	});

	test("an archived lot is still loggable", async () => {
		const { archivedLotId, t, userId } = await setup();
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: archivedLotId,
			rating: 3,
		});
		const feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]?.lot.name).toBe("Colombia Old Lot");
	});

	test("only the author can edit or delete a log", async () => {
		const { lotId, t, userB, userId } = await setup();
		const logId = await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
		});

		await expect(
			asUser(t, userB).mutation(api.logs.updateLog, {
				logId,
				rating: 2,
			})
		).rejects.toThrow("Not your log");
		await expect(
			asUser(t, userB).mutation(api.logs.deleteLog, { logId })
		).rejects.toThrow("Not your log");

		await asUser(t, userId).mutation(api.logs.updateLog, {
			logId,
			notes: "Updated after re-brew.",
			rating: 4.5,
		});
		let feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]).toMatchObject({
			notes: "Updated after re-brew.",
			rating: 4.5,
		});

		await asUser(t, userId).mutation(api.logs.deleteLog, { logId });
		feed = await t.query(api.logs.recentLogs, {});
		expect(feed).toHaveLength(0);
	});

	test("update can clear a rating or notes with null", async () => {
		const { lotId, t, userId } = await setup();
		const logId = await asUser(t, userId).mutation(api.logs.createLog, {
			notes: "First take.",
			productId: lotId,
			rating: 4,
		});
		await asUser(t, userId).mutation(api.logs.updateLog, {
			logId,
			notes: null,
			rating: null,
		});
		const feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]?.rating).toBeNull();
		expect(feed[0]?.notes).toBeNull();
	});

	test("the roaster's lot catalog paginates with archived lots included", async () => {
		const { archivedLotId, lotId, roasterId, t } = await setup();
		const first = await t.query(api.roasters.listLots, {
			paginationOpts: { cursor: null, numItems: 1 },
			roasterId,
		});
		expect(first.page).toHaveLength(1);
		expect(first.isDone).toBe(false);

		const second = await t.query(api.roasters.listLots, {
			paginationOpts: { cursor: first.continueCursor, numItems: 10 },
			roasterId,
		});
		const all = [...first.page, ...second.page];
		const ids = all.map((lot) => lot.id);
		expect(ids).toHaveLength(2);
		expect(ids).toContain(lotId);
		expect(ids).toContain(archivedLotId);
		expect(all.every((lot) => lot.handle.length > 0)).toBe(true);
	});

	test("profile returns the user's logs newest first plus watched roasters", async () => {
		const { lotId, t, userB, userId } = await setup();
		await t.run(async (ctx) => {
			const roasterB = await ctx.db.insert("roasters", {
				city: "Portland",
				claimed: false,
				domain: "heart.example.com",
				name: "Heart",
				productPageUrl: "https://heart.example.com/coffee",
				slug: "heart",
				source: "curated",
				state: "OR",
				status: "active",
				websiteUrl: "https://heart.example.com",
			});
			await ctx.db.insert("watches", {
				muted: false,
				roasterId: roasterB,
				userId,
			});
		});
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
		});
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 5,
		});

		const profile = await t.query(api.logs.profile, { userId });
		expect(profile?.user).toMatchObject({ name: "Taster One" });
		expect(profile?.logs).toHaveLength(2);
		expect(profile?.logs[0]?.rating).toBe(5);
		expect(profile?.logs[1]?.rating).toBe(4);
		expect(profile?.roasters).toHaveLength(1);
		expect(profile?.roasters[0]).toMatchObject({ name: "Heart" });

		const other = await t.query(api.logs.profile, { userId: userB });
		expect(other?.user).toMatchObject({ name: "Taster Two" });
		expect(other?.logs).toHaveLength(0);
	});
});
