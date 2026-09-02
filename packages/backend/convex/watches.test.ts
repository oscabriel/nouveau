/// <reference types="vite/client" />
import { register } from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
	userId: Id<"users">;
}

const setup = async (
	roasterStatus: "active" | "pending" = "active"
): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	register(t);
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
			status: roasterStatus,
			websiteUrl: "https://sey.example.com",
		});
		const user = await ctx.db.insert("users", {
			providerAccountId: "google-123",
		});
		await ctx.db.insert("crawlSources", {
			cadenceMinutes: 60,
			consecutiveFailures: 0,
			health: "watching",
			lastCheckedAt: 1000,
			lastSuccessAt: 2000,
			mode: "products_json",
			nextCrawlDueAt: 3000,
			roasterId: roaster,
		});
		return { roaster, user };
	});
	return { roasterId: ids.roaster, t, userId: ids.user };
};

describe("watches", () => {
	test("requires sign-in", async () => {
		const { roasterId, t } = await setup();
		await expect(
			t.mutation(api.watches.watchRoaster, { roasterId })
		).rejects.toThrow("Sign in required");
	});

	test("watch inserts, counts, and is idempotent", async () => {
		const { roasterId, t, userId } = await setup();
		const caller = asUser(t, userId);
		await caller.mutation(api.watches.watchRoaster, { roasterId });
		await caller.mutation(api.watches.watchRoaster, { roasterId });
		expect(await t.query(api.watches.followerCount, { roasterId })).toBe(1);
	});

	test("watch rejects roasters that are not active", async () => {
		const { roasterId, t, userId } = await setup("pending");
		await expect(
			asUser(t, userId).mutation(api.watches.watchRoaster, { roasterId })
		).rejects.toThrow("Roaster not available to watch");
	});

	test("unwatch removes and the count drops; unwatching without a watch is a no-op", async () => {
		const { roasterId, t, userId } = await setup();
		const caller = asUser(t, userId);
		await caller.mutation(api.watches.watchRoaster, { roasterId });
		await caller.mutation(api.watches.unwatchRoaster, { roasterId });
		expect(await t.query(api.watches.followerCount, { roasterId })).toBe(0);
		await expect(
			caller.mutation(api.watches.unwatchRoaster, { roasterId })
		).resolves.toBeNull();
	});

	test("setWatchMuted toggles an existing watch and rejects non-watches", async () => {
		const { roasterId, t, userId } = await setup();
		const caller = asUser(t, userId);
		await expect(
			caller.mutation(api.watches.setWatchMuted, { muted: true, roasterId })
		).rejects.toThrow("Not watching this roaster");
		await caller.mutation(api.watches.watchRoaster, { roasterId });
		await caller.mutation(api.watches.setWatchMuted, {
			muted: true,
			roasterId,
		});
		const [watch] = await caller.query(api.watches.listMyWatches, {});
		expect(watch?.muted).toBe(true);
	});

	test("listMyWatches returns roaster and status-chip data; signed-out is empty", async () => {
		const { roasterId, t, userId } = await setup();
		expect(await t.query(api.watches.listMyWatches, {})).toEqual([]);
		await asUser(t, userId).mutation(api.watches.watchRoaster, { roasterId });
		const watches = await asUser(t, userId).query(
			api.watches.listMyWatches,
			{}
		);
		expect(watches).toHaveLength(1);
		expect(watches[0]).toMatchObject({
			muted: false,
			roaster: { id: roasterId, name: "Sey", slug: "sey" },
			status: {
				health: "watching",
				lastCheckedAt: 1000,
				lastSuccessAt: 2000,
			},
		});
	});

	test("myWatchedRoasterIds lists watched roaster ids", async () => {
		const { roasterId, t, userId } = await setup();
		expect(
			await asUser(t, userId).query(api.watches.myWatchedRoasterIds, {})
		).toEqual([]);
		await asUser(t, userId).mutation(api.watches.watchRoaster, { roasterId });
		expect(
			await asUser(t, userId).query(api.watches.myWatchedRoasterIds, {})
		).toEqual([roasterId]);
	});
});
