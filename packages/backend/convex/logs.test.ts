import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { LOG_FEED_LIMIT, MAX_PROFILE_LOGS } from "./constants";
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

describe("tasting notes", () => {
	test("a log carries its picks and the feed card hydrates them", async () => {
		const { lotId, t, userId } = await setup();
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
			tastingNotes: ["floral", "berry"],
		});
		const feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]?.tastingNotes).toEqual(["floral", "berry"]);
	});

	test("a log without picks reads as null, not an empty array", async () => {
		const { lotId, t, userId } = await setup();
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
		});
		const feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]?.tastingNotes).toBeNull();
	});

	test("five picks are rejected", async () => {
		const { lotId, t, userId } = await setup();
		await expect(
			asUser(t, userId).mutation(api.logs.createLog, {
				productId: lotId,
				tastingNotes: [
					"fruity",
					"berry",
					"citrus fruit",
					"dried fruit",
					"other fruit",
				],
			})
		).rejects.toThrow("capped at 4");
	});

	test("a duplicate pick is rejected", async () => {
		const { lotId, t, userId } = await setup();
		await expect(
			asUser(t, userId).mutation(api.logs.createLog, {
				productId: lotId,
				tastingNotes: ["floral", "floral"],
			})
		).rejects.toThrow("picked once");
	});

	test("a term outside the wheel fails validation", async () => {
		const { lotId, t, userId } = await setup();
		await expect(
			asUser(t, userId).mutation(api.logs.createLog, {
				productId: lotId,
				// The roaster's own vocabulary is freeform; the taster's picks
				// come only from the wheel.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				tastingNotes: ["stone fruit" as never],
			})
		).rejects.toThrow();
	});

	test("update can replace or clear the picks", async () => {
		const { lotId, t, userId } = await setup();
		const { logId } = await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			tastingNotes: ["floral", "citrus fruit"],
		});
		await asUser(t, userId).mutation(api.logs.updateLog, {
			logId,
			tastingNotes: ["fruity"],
		});
		let feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]?.tastingNotes).toEqual(["fruity"]);

		await asUser(t, userId).mutation(api.logs.updateLog, {
			logId,
			tastingNotes: null,
		});
		feed = await t.query(api.logs.recentLogs, {});
		expect(feed[0]?.tastingNotes).toBeNull();
	});
});

describe("log removes save", () => {
	test("logging a saved lot removes it from the try list", async () => {
		const { lotId, t, userId } = await setup();
		await asUser(t, userId).mutation(api.savedCoffees.save, {
			productId: lotId,
		});
		expect(
			await asUser(t, userId).query(api.savedCoffees.mySavedProductIds, {})
		).toEqual([lotId]);

		const { removedSaveFromRunId } = await asUser(t, userId).mutation(
			api.logs.createLog,
			{ productId: lotId, rating: 4 }
		);
		expect(removedSaveFromRunId).toBeNull();
		expect(
			await asUser(t, userId).query(api.savedCoffees.mySavedProductIds, {})
		).toEqual([]);
	});

	test("the undo restores the save with its run citation", async () => {
		const { lotId, t, userId } = await setup();
		const runId = await t.run((ctx) =>
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
		await asUser(t, userId).mutation(api.savedCoffees.save, {
			fromRunId: runId,
			productId: lotId,
		});

		const { removedSaveFromRunId } = await asUser(t, userId).mutation(
			api.logs.createLog,
			{ productId: lotId, rating: 4 }
		);
		expect(removedSaveFromRunId).toBe(runId);
		expect(
			await asUser(t, userId).query(api.savedCoffees.mySavedProductIds, {})
		).toEqual([]);

		// The undo toast restores the save, citation intact.
		await asUser(t, userId).mutation(api.savedCoffees.save, {
			fromRunId: removedSaveFromRunId ?? undefined,
			productId: lotId,
		});
		const page = await asUser(t, userId).query(api.savedCoffees.listMine, {
			paginationOpts: { cursor: null, numItems: 10 },
		});
		expect(page.page).toHaveLength(1);
		expect(page.page[0]?.fromRunId).toBe(runId);
	});

	test("logging an unsaved lot leaves the try list alone", async () => {
		const { archivedLotId, lotId, t, userId } = await setup();
		await asUser(t, userId).mutation(api.savedCoffees.save, {
			productId: archivedLotId,
		});
		const { removedSaveFromRunId } = await asUser(t, userId).mutation(
			api.logs.createLog,
			{ productId: lotId, rating: 4 }
		);
		expect(removedSaveFromRunId).toBeNull();
		expect(
			await asUser(t, userId).query(api.savedCoffees.mySavedProductIds, {})
		).toEqual([archivedLotId]);
	});

	test("another taster's save is never removed by my log", async () => {
		const { lotId, t, userB, userId } = await setup();
		await asUser(t, userB).mutation(api.savedCoffees.save, {
			productId: lotId,
		});
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
		});
		expect(
			await asUser(t, userB).query(api.savedCoffees.mySavedProductIds, {})
		).toEqual([lotId]);
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
			lot: {
				name: "Ethiopia Mullugeta Muntasha",
				url: "https://sey.example.com/products/mullugeta",
			},
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
		const { logId } = await asUser(t, userId).mutation(api.logs.createLog, {
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
		const { logId } = await asUser(t, userId).mutation(api.logs.createLog, {
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

	test("a public profile returns logs only, never watches or the try list", async () => {
		const { lotId, t, userId } = await setup();
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
		await asUser(t, userId).mutation(api.savedCoffees.save, {
			productId: lotId,
		});
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
		});
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 5,
		});

		// Signed-out viewer.
		const signedOut = await t.query(api.logs.profile, { userId });
		expect(signedOut?.kind).toBe("public");
		expect(signedOut?.user).toMatchObject({ name: "Taster One" });
		expect(signedOut?.logs).toHaveLength(2);
		expect(signedOut?.logs[0]?.rating).toBe(5);
		expect(signedOut?.logs[1]?.rating).toBe(4);
		expect(signedOut).not.toHaveProperty("watches");
		expect(signedOut).not.toHaveProperty("saved");

		// A signed-in viewer who is not the user sees the same branch.
		const other = await t.run((ctx) =>
			ctx.db.insert("users", {
				name: "Taster Three",
				providerAccountId: "google-3",
			})
		);
		const viewer = await asUser(t, other).query(api.logs.profile, { userId });
		expect(viewer?.kind).toBe("public");
		expect(viewer).not.toHaveProperty("watches");
		expect(viewer).not.toHaveProperty("saved");
	});

	test("the owner's profile adds watches with health and the try list with stock", async () => {
		const { lotId, t, userId } = await setup();
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
				muted: true,
				roasterId: roasterB,
				userId,
			});
		});
		await asUser(t, userId).mutation(api.savedCoffees.save, {
			productId: lotId,
		});

		const profile = await asUser(t, userId).query(api.logs.profile, { userId });
		if (profile === null || profile.kind !== "owner") {
			throw new Error("expected the owner branch");
		}
		expect(profile.watches).toHaveLength(1);
		expect(profile.watches[0]).toMatchObject({
			muted: true,
			roaster: { name: "Heart" },
		});
		expect(profile.watches[0]?.status.health).toBe("watching");
		expect(profile.saved).toHaveLength(1);
		expect(profile.saved[0]).toMatchObject({
			available: null,
			lot: { handle: "mullugeta", name: "Ethiopia Mullugeta Muntasha" },
			roaster: { slug: "sey" },
		});
	});

	test("profile log cards carry the roaster's notes beside the taster's picks", async () => {
		const { lotId, t, userId } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.patch(lotId, { roasterNotes: ["peach", "melon"] });
		});
		await asUser(t, userId).mutation(api.logs.createLog, {
			productId: lotId,
			rating: 4,
			tastingNotes: ["floral", "berry"],
		});

		const profile = await t.query(api.logs.profile, { userId });
		expect(profile?.logs[0]).toMatchObject({
			lot: { roasterNotes: "peach, melon" },
			tastingNotes: ["floral", "berry"],
		});
	});

	test("profile resolves a malformed or unknown id to null, not an error", async () => {
		const { t, userId } = await setup();
		expect(await t.query(api.logs.profile, { userId: "not-an-id" })).toBeNull();
		const deleted = await t.run(async (ctx) => {
			const ghost = await ctx.db.insert("users", {
				providerAccountId: "google-ghost",
			});
			await ctx.db.delete("users", ghost);
			return ghost;
		});
		expect(await t.query(api.logs.profile, { userId: deleted })).toBeNull();
		expect(await t.query(api.logs.profile, { userId })).not.toBeNull();
	});

	test("profile caps logs and says when it did", async () => {
		const { lotId, t, userId } = await setup();
		await t.run(async (ctx) => {
			for (let i = 0; i <= MAX_PROFILE_LOGS; i += 1) {
				// oxlint-disable-next-line no-await-in-loop -- seeding, order irrelevant
				await ctx.db.insert("logs", {
					loggedAt: i,
					productId: lotId,
					userId,
				});
			}
		});
		const profile = await t.query(api.logs.profile, { userId });
		expect(profile?.logs).toHaveLength(MAX_PROFILE_LOGS);
		expect(profile?.logsTruncated).toBe(true);
	});

	test("lot search finds a lot by name within one roaster only", async () => {
		const { roasterId, t } = await setup();
		const otherRoaster = await t.run(async (ctx) => {
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
			await ctx.db.insert("products", {
				externalId: "h1",
				firstSeenAt: 1000,
				handle: "heart-ethiopia",
				lastSeenAt: 1000,
				missedCrawls: 0,
				name: "Ethiopia Heart Blend",
				roasterId: roasterB,
				status: "current",
			});
			return roasterB;
		});

		const hits = await t.query(api.roasters.searchLots, {
			roasterId,
			term: "ethiopia",
		});
		expect(hits.map((lot) => lot.name)).toEqual([
			"Ethiopia Mullugeta Muntasha",
		]);

		const otherHits = await t.query(api.roasters.searchLots, {
			roasterId: otherRoaster,
			term: "ethiopia",
		});
		expect(otherHits.map((lot) => lot.name)).toEqual(["Ethiopia Heart Blend"]);

		expect(
			await t.query(api.roasters.searchLots, { roasterId, term: "   " })
		).toEqual([]);
	});
});
