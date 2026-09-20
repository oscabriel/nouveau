// The social layer (build spec §14, ADR-0002): users log the lots they try,
// rate them in 1–5 half steps, and keep their own notes. Logs are public and
// surface on one global activity feed and on per-user profiles.

import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	LOG_FEED_LIMIT,
	MAX_PROFILE_LOGS,
	MAX_WATCHES_PER_USER,
} from "./constants";
import { redirectTarget } from "./handles";
import { requireUserId } from "./identity";
import { joinNotes } from "./lotFacts";
import { roasterCardValidator } from "./roasters";
/** Ratings are 1–5 in half steps (spec §14.1); anything else is rejected. */
export const isValidRating = (rating: number): boolean =>
	Number.isInteger(rating * 2) && rating >= 1 && rating <= 5;

const NOTES_MAX_LENGTH = 1000;

const checkInput = (
	rating: number | undefined,
	notes: string | undefined
): void => {
	if (rating !== undefined && !isValidRating(rating)) {
		throw new Error("Rating must be 1–5 in half steps");
	}
	if (notes !== undefined && notes.length > NOTES_MAX_LENGTH) {
		throw new Error(`Notes are capped at ${NOTES_MAX_LENGTH} characters`);
	}
};

const tasterValidator = v.object({
	// The /$user address (ADR-0011); absent for rows predating the field.
	handle: v.optional(v.string()),
	id: v.id("users"),
	imageUrl: v.optional(v.string()),
	name: v.optional(v.string()),
});

/** A hydrated log card: everything the activity feed and profile render. */
export const logCardValidator = v.object({
	logId: v.id("logs"),
	loggedAt: v.number(),
	// The lot's address pair (ADR-0011): cards link /roaster/$slug/$handle.
	// url is the roaster's own product page, the same link the drop feed's
	// "See the lot" uses (feed.ts); roasterNotes are §14.4 descriptors from
	// the roaster's copy, when the feed carries any.
	lot: v.object({
		// The lot's address pair (ADR-0011); url is the roaster's own product
		// page, the same link the drop feed's "See the lot" uses (feed.ts);
		// roasterNotes are §14.4 descriptors from the roaster's copy, when the
		// feed carries any.
		handle: v.string(),
		id: v.id("products"),
		name: v.string(),
		roasterNotes: v.union(v.string(), v.null()),
		url: v.string(),
	}),
	notes: v.union(v.string(), v.null()),
	rating: v.union(v.number(), v.null()),
	roaster: v.object({ name: v.string(), slug: v.string() }),
	user: tasterValidator,
});

type LogCard = Infer<typeof logCardValidator>;

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
			roasterNotes: joinNotes(product.roasterNotes),
			url: `${roaster.websiteUrl}/products/${product.handle}`,
		},
		notes: log.notes ?? null,
		rating: log.rating ?? null,
		roaster: { name: roaster.name, slug: roaster.slug },
		user: {
			handle: user.handle,
			id: user._id,
			imageUrl: user.imageUrl,
			name: user.name,
		},
	};
};

export const hydrateAll = async (
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
	returns: v.array(logCardValidator),
});

/**
 * One public profile (§14.2). ADR-0011: the address is the user's handle, but
 * the arg keeps the old name and accepts all three shapes a URL can carry:
 * the current handle, a handle the user once held (old-handle redirect), or a
 * legacy users-document id from a pre-handle /profile link. A malformed or
 * unknown one resolves to null (the "no taster here" page) instead of
 * failing argument validation. `logs` is capped at MAX_PROFILE_LOGS;
 * `logsTruncated` says when the cap hit. The returned user carries the
 * current handle so a stale address can redirect to the canonical one.
 */
export const profile = query({
	args: { userId: v.string() },
	handler: async (ctx, args) => {
		let user: Doc<"users"> | null = await ctx.db
			.query("users")
			.withIndex("by_handle", (q) => q.eq("handle", args.userId))
			.unique();
		if (user === null) {
			user = await redirectTarget(ctx, args.userId);
		}
		if (user === null) {
			const id = ctx.db.normalizeId("users", args.userId);
			user = id === null ? null : await ctx.db.get("users", id);
		}
		if (user === null) {
			return null;
		}
		const userId: Id<"users"> = user._id;
		const logs = await ctx.db
			.query("logs")
			.withIndex("by_user_and_logged_at", (q) => q.eq("userId", userId))
			.order("desc")
			.take(MAX_PROFILE_LOGS + 1);
		const watches = await ctx.db
			.query("watches")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
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
			logs: await hydrateAll(ctx, logs.slice(0, MAX_PROFILE_LOGS)),
			logsTruncated: logs.length > MAX_PROFILE_LOGS,
			roasters: roasterCards.filter((card) => card !== null),
			user: {
				handle: user.handle,
				id: user._id,
				imageUrl: user.imageUrl,
				name: user.name,
			},
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			logs: v.array(logCardValidator),
			logsTruncated: v.boolean(),
			roasters: v.array(roasterCardValidator),
			user: tasterValidator,
		})
	),
});

/** Log a lot (§14.1). Public by design; author resolved from the session. */
export const createLog = mutation({
	args: {
		notes: v.optional(v.string()),
		productId: v.id("products"),
		rating: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const notes = args.notes?.trim();
		checkInput(args.rating, notes);
		const product = await ctx.db.get(args.productId);
		if (product === null) {
			throw new Error("Unknown lot");
		}
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
		// Absent and null both become undefined here; only the patch below
		// distinguishes "leave alone" (absent) from "clear" (null).
		const rating = args.rating ?? undefined;
		const notes = args.notes?.trim();
		checkInput(rating, notes);
		const patch: { notes?: string; rating?: number } = {};
		if (args.rating !== undefined) {
			patch.rating = rating;
		}
		if (args.notes !== undefined) {
			patch.notes = notes === "" ? undefined : notes;
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
