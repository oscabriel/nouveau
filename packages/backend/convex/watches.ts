import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { MAX_WATCHES_PER_USER } from "./constants";
import { followerCounts } from "./followerCounts";
import { crawlStatusValidator, getCrawlStatus } from "./health";
import { optionalUserId, requireUserId } from "./identity";
import { roasterCardValidator } from "./roasters";

const watchArgs = v.object({ roasterId: v.id("roasters") });

export const watchRoaster = mutation({
	args: watchArgs,
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const roaster = await ctx.db.get(args.roasterId);
		if (roaster === null || roaster.status !== "active") {
			throw new Error("Roaster not available to watch");
		}
		const existing = await ctx.db
			.query("watches")
			.withIndex("by_user_and_roaster_id", (q) =>
				q.eq("userId", userId).eq("roasterId", args.roasterId)
			)
			.unique();
		if (existing !== null) {
			return null;
		}
		const watchId = await ctx.db.insert("watches", {
			muted: false,
			roasterId: args.roasterId,
			userId,
		});
		// The aggregate wants the stored doc (it derives namespace + sort key
		// from it); reading it back keeps the count in the same transaction.
		const watch = await ctx.db.get(watchId);
		if (watch === null) {
			throw new Error("Watch insert did not persist");
		}
		await followerCounts.insert(ctx, watch);
		return null;
	},
	returns: v.null(),
});

export const unwatchRoaster = mutation({
	args: watchArgs,
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const existing = await ctx.db
			.query("watches")
			.withIndex("by_user_and_roaster_id", (q) =>
				q.eq("userId", userId).eq("roasterId", args.roasterId)
			)
			.unique();
		if (existing === null) {
			return null;
		}
		await ctx.db.delete("watches", existing._id);
		await followerCounts.delete(ctx, existing);
		return null;
	},
	returns: v.null(),
});

/** Mute toggle (build spec §8.2): muted watches stop alert emails but stay watches. */
export const setWatchMuted = mutation({
	args: { muted: v.boolean(), roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const existing = await ctx.db
			.query("watches")
			.withIndex("by_user_and_roaster_id", (q) =>
				q.eq("userId", userId).eq("roasterId", args.roasterId)
			)
			.unique();
		if (existing === null) {
			throw new Error("Not watching this roaster");
		}
		await ctx.db.patch("watches", existing._id, { muted: args.muted });
		return null;
	},
	returns: v.null(),
});

/** Watch rows for the signed-in user, with roaster + status-chip data. */
export const listMyWatches = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return [];
		}
		const watches = await ctx.db
			.query("watches")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.take(MAX_WATCHES_PER_USER);
		return Promise.all(
			watches.map(async (watch) => {
				const roaster = await ctx.db.get(watch.roasterId);
				if (roaster === null) {
					throw new Error(
						`Watch ${watch._id} references missing roaster ${watch.roasterId}`
					);
				}
				return {
					muted: watch.muted,
					roaster: {
						city: roaster.city,
						id: roaster._id,
						name: roaster.name,
						slug: roaster.slug,
						state: roaster.state,
					},
					status: await getCrawlStatus(ctx, watch.roasterId),
				};
			})
		);
	},
	returns: v.array(
		v.object({
			muted: v.boolean(),
			roaster: roasterCardValidator,
			status: crawlStatusValidator,
		})
	),
});

/** Ids the signed-in user watches, for watch-button state anywhere. */
export const myWatchedRoasterIds = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return [];
		}
		const watches = await ctx.db
			.query("watches")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.take(MAX_WATCHES_PER_USER);
		return watches.map((watch) => watch.roasterId);
	},
	returns: v.array(v.id("roasters")),
});

/** Follower count for one roaster. */
export const followerCount = query({
	args: { roasterId: v.id("roasters") },
	handler: (ctx, args) =>
		followerCounts.count(ctx, { namespace: args.roasterId }),
	returns: v.number(),
});
