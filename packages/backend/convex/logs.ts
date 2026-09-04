// The social layer (build spec §14, ADR-0002): users log the lots they try,
// rate them in 1–5 half steps, and keep their own notes. Logs are public and
// surface on one global activity feed and on per-user profiles.

import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	LOG_FEED_LIMIT,
	MAX_PROFILE_LOGS,
	MAX_WATCHES_PER_USER,
} from "./constants";
import { requireUserId } from "./identity";

/** Ratings are 1–5 in half steps (spec §14.1); anything else is rejected. */
export const isValidRating = (rating: number): boolean =>
	Number.isInteger(rating * 2) && rating >= 1 && rating <= 5;

const NOTES_MAX_LENGTH = 1000;

// Same shape as roasters.ts's roasterCardValidator, declared locally: that
// validator sits inside the roasters ↔ watches import cycle (via
// followerCounts), and importing it here changes module load order enough to
// make it resolve undefined at registration time (the deploy-blocking
// "undefined validator" trap). Duplicate the five fields, don't import them.
const roasterCard = {
	city: v.string(),
	id: v.id("roasters"),
	name: v.string(),
	slug: v.string(),
	state: v.string(),
};

const checkInput = (
	rating: number | undefined,
	notes: string | null | undefined
): void => {
	if (rating !== undefined && rating !== null && !isValidRating(rating)) {
		throw new Error("Rating must be 1–5 in half steps");
	}
	if (typeof notes === "string" && notes.length > NOTES_MAX_LENGTH) {
		throw new Error(`Notes are capped at ${NOTES_MAX_LENGTH} characters`);
	}
};

/** A hydrated log card: everything the activity feed and profile render. */
const logCard = {
	logId: v.id("logs"),
	loggedAt: v.number(),
	lot: v.object({
		handle: v.string(),
		id: v.id("products"),
		name: v.string(),
	}),
	notes: v.union(v.string(), v.null()),
	rating: v.union(v.number(), v.null()),
	roaster: v.object({ name: v.string(), slug: v.string() }),
	user: v.object({
		id: v.id("users"),
		imageUrl: v.optional(v.string()),
		name: v.optional(v.string()),
	}),
};

interface LogCard {
	loggedAt: number;
	logId: Doc<"logs">["_id"];
	lot: { handle: string; id: Doc<"products">["_id"]; name: string };
	notes: string | null;
	rating: number | null;
	roaster: { name: string; slug: string };
	user: {
		id: Doc<"users">["_id"];
		imageUrl?: string;
		name?: string;
	};
}

/** Hydrate a log into a card; null when its lot, roaster or user vanished. */
const hydrateLog = async (
	ctx: QueryCtx,
	log: Doc<"logs">
): Promise<LogCard | null> => {
	const [product, user] = await Promise.all([
		ctx.db.get(log.productId),
		ctx.db.get(log.userId),
	]);
	if (product === null || user === null) {
		return null;
	}
	const roaster = await ctx.db.get(product.roasterId);
	if (roaster === null) {
		return null;
	}
	return {
		logId: log._id,
		loggedAt: log.loggedAt,
		lot: {
			handle: product.handle,
			id: product._id,
			name: product.name,
		},
		notes: log.notes ?? null,
		rating: log.rating ?? null,
		roaster: { name: roaster.name, slug: roaster.slug },
		user: {
			id: user._id,
			imageUrl: user.imageUrl,
			name: user.name,
		},
	};
};

const hydrateAll = async (
	ctx: QueryCtx,
	logs: Doc<"logs">[]
): Promise<LogCard[]> => {
	const cards = await Promise.all(logs.map((log) => hydrateLog(ctx, log)));
	return cards.filter((card) => card !== null);
};

/**
 * The global activity feed (§14.3): recent logs across all users, newest
 * first. Public — the cold-start proof that people are tasting coffee here.
 */
export const recentLogs = query({
	args: {},
	handler: async (ctx) => {
		const logs = await ctx.db
			.query("logs")
			.withIndex("by_logged_at")
			.order("desc")
			.take(LOG_FEED_LIMIT);
		return hydrateAll(ctx, logs);
	},
	returns: v.array(v.object(logCard)),
});

/** One public profile (§14.2): the taster, their logs, their watches. */
export const profile = query({
	args: { userId: v.id("users") },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (user === null) {
			return null;
		}
		const logs = await ctx.db
			.query("logs")
			.withIndex("by_user_and_logged_at", (q) => q.eq("userId", args.userId))
			.order("desc")
			.take(MAX_PROFILE_LOGS);
		const watches = await ctx.db
			.query("watches")
			.withIndex("by_user_id", (q) => q.eq("userId", args.userId))
			.take(MAX_WATCHES_PER_USER);
		const roasterCards = await Promise.all(
			watches.map(async (watch) => {
				const roaster = await ctx.db.get(watch.roasterId);
				return roaster === null
					? null
					: {
							city: roaster.city,
							id: roaster._id,
							name: roaster.name,
							slug: roaster.slug,
							state: roaster.state,
						};
			})
		);
		return {
			logs: await hydrateAll(ctx, logs),
			roasters: roasterCards.filter((card) => card !== null),
			user: { id: user._id, imageUrl: user.imageUrl, name: user.name },
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			logs: v.array(v.object(logCard)),
			roasters: v.array(v.object(roasterCard)),
			user: v.object({
				id: v.id("users"),
				imageUrl: v.optional(v.string()),
				name: v.optional(v.string()),
			}),
		})
	),
});

const createArgs = {
	notes: v.optional(v.string()),
	productId: v.id("products"),
	rating: v.optional(v.number()),
};

/** Log a lot (§14.1). Public by design; author resolved from the session. */
export const createLog = mutation({
	args: createArgs,
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		checkInput(args.rating, args.notes);
		const product = await ctx.db.get(args.productId);
		if (product === null) {
			throw new Error("Unknown lot");
		}
		const notes = args.notes?.trim();
		return ctx.db.insert("logs", {
			loggedAt: Date.now(),
			notes: notes === "" ? undefined : notes,
			productId: args.productId,
			rating: args.rating,
			userId,
		});
	},
	returns: v.id("logs"),
});

/**
 * Edit the author's own log. `null` clears a field; absent leaves it alone.
 * Others' logs are untouchable — authorship comes from the stored row, not
 * the caller's claim.
 */
export const updateLog = mutation({
	args: {
		logId: v.id("logs"),
		notes: v.optional(v.union(v.string(), v.null())),
		rating: v.optional(v.union(v.number(), v.null())),
	},
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const log = await ctx.db.get(args.logId);
		if (log === null) {
			throw new Error("Unknown log");
		}
		if (log.userId !== userId) {
			throw new Error("Not your log");
		}
		checkInput(args.rating ?? undefined, args.notes ?? undefined);
		const patch: {
			notes?: string | undefined;
			rating?: number | undefined;
		} = {};
		if (args.rating !== undefined) {
			patch.rating = args.rating ?? undefined;
		}
		if (args.notes !== undefined) {
			const notes = args.notes?.trim();
			patch.notes = notes === "" || notes === null ? undefined : notes;
		}
		await ctx.db.patch(args.logId, patch);
		return null;
	},
	returns: v.null(),
});

/** Delete the author's own log. */
export const deleteLog = mutation({
	args: { logId: v.id("logs") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const log = await ctx.db.get(args.logId);
		if (log === null) {
			return null;
		}
		if (log.userId !== userId) {
			throw new Error("Not your log");
		}
		await ctx.db.delete("logs", args.logId);
		return null;
	},
	returns: v.null(),
});
