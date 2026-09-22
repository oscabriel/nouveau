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
	MAX_PROFILE_SAVED,
} from "./constants";
import { redirectTarget } from "./handles";
import { optionalUserId, requireUserId } from "./identity";
import { joinNotes, notesList } from "./lotFacts";
import { findSave, savedCards, savedCoffeeValidator } from "./savedCoffees";
import {
	MAX_TASTING_NOTE_LENGTH,
	MAX_TASTING_NOTES,
	normalizeTastingNote,
	taggedNoteValidator,
	tagNotes,
	tastingNoteValidator,
} from "./tasting";
import { watchCards, watchCardValidator } from "./watches";
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

/**
 * The stored shape of a log's tasting notes (ADR-0016, amended
 * 2026-09-21): each word trimmed and lowercased, empties dropped,
 * duplicates dropped, at most MAX_TASTING_NOTES of them, none longer than
 * MAX_TASTING_NOTE_LENGTH. Undefined when nothing is left.
 */
const cleanTastingNotes = (
	tastingNotes: string[] | null | undefined
): string[] | undefined => {
	if (tastingNotes === undefined || tastingNotes === null) {
		return undefined;
	}
	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const raw of tastingNotes) {
		const note = normalizeTastingNote(raw);
		if (note === "" || seen.has(note)) {
			continue;
		}
		if (note.length > MAX_TASTING_NOTE_LENGTH) {
			throw new Error(
				`A tasting note is capped at ${MAX_TASTING_NOTE_LENGTH} characters`
			);
		}
		seen.add(note);
		cleaned.push(note);
	}
	if (cleaned.length > MAX_TASTING_NOTES) {
		throw new Error(`Tasting notes are capped at ${MAX_TASTING_NOTES}`);
	}
	return cleaned.length === 0 ? undefined : cleaned;
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
		// The same descriptors one by one with their wheel family, for the
		// card's colored pills; empty when there are none.
		roasterTags: v.array(taggedNoteValidator),
		url: v.string(),
	}),
	notes: v.union(v.string(), v.null()),
	rating: v.union(v.number(), v.null()),
	roaster: v.object({ name: v.string(), slug: v.string() }),
	// The taster's own words (ADR-0016, free text since 2026-09-21), stored
	// on the log; the roaster's descriptors live beside them on
	// lot.roasterNotes. Each note with the wheel family it resolves to, or
	// null when the wheel does not know the word (tasting.ts).
	tastingNotes: v.union(v.array(taggedNoteValidator), v.null()),
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
			roasterTags: tagNotes(notesList(product.roasterNotes)),
			url: `${roaster.websiteUrl}/products/${product.handle}`,
		},
		notes: log.notes ?? null,
		rating: log.rating ?? null,
		roaster: { name: roaster.name, slug: roaster.slug },
		tastingNotes:
			log.tastingNotes === undefined ? null : tagNotes(log.tastingNotes),
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
 * One public profile (§14.2), split by viewer (ADR-0016). The address
 * accepts all three shapes a URL can carry: the current handle, a handle
 * the user once held (old-handle redirect), or a legacy users-document id
 * from a pre-handle /profile link. A malformed or unknown one resolves to
 * null (the "no taster here" page) instead of failing argument validation.
 *
 * `kind` is the branch: a viewer who is not the user gets logs only, never
 * the watches, never the try list, enforced here in the query. The owner
 * also gets their watches (with health and mute) and the try list (with
 * stock at last check), each capped to the profile's highlight budget. The
 * returned user carries the current handle so a stale address can redirect
 * to the canonical one.
 */
export const profile = query({
	// The address the URL holds: a current handle, a retired handle or a
	// legacy users id (ADR-0011), resolved in that order.
	args: { address: v.string() },
	handler: async (ctx, args) => {
		let user: Doc<"users"> | null = await ctx.db
			.query("users")
			.withIndex("by_handle", (q) => q.eq("handle", args.address))
			.unique();
		if (user === null) {
			user = await redirectTarget(ctx, args.address);
		}
		if (user === null) {
			const id = ctx.db.normalizeId("users", args.address);
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
		const hydrated = await hydrateAll(ctx, logs.slice(0, MAX_PROFILE_LOGS));
		const logsTruncated = logs.length > MAX_PROFILE_LOGS;
		const userCard = {
			handle: user.handle,
			id: user._id,
			imageUrl: user.imageUrl,
			name: user.name,
		};
		const viewerId = await optionalUserId(ctx);
		if (viewerId !== userId) {
			// Public branch: never the watches, never the try list.
			return {
				kind: "public" as const,
				logs: hydrated,
				logsTruncated,
				user: userCard,
			};
		}
		return {
			kind: "owner" as const,
			logs: hydrated,
			logsTruncated,
			saved: await savedCards(ctx, userId, MAX_PROFILE_SAVED),
			user: userCard,
			watches: await watchCards(ctx, userId),
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			kind: v.literal("public"),
			logs: v.array(logCardValidator),
			logsTruncated: v.boolean(),
			user: tasterValidator,
		}),
		v.object({
			kind: v.literal("owner"),
			logs: v.array(logCardValidator),
			logsTruncated: v.boolean(),
			saved: v.array(savedCoffeeValidator),
			user: tasterValidator,
			watches: v.array(watchCardValidator),
		})
	),
});

/** Log a lot (§14.1). Public by design; author resolved from the session. */
export const createLog = mutation({
	args: {
		notes: v.optional(v.string()),
		productId: v.id("products"),
		rating: v.optional(v.number()),
		tastingNotes: v.optional(v.array(tastingNoteValidator)),
	},
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const notes = args.notes?.trim();
		checkInput(args.rating, notes);
		const tastingNotes = cleanTastingNotes(args.tastingNotes);
		const product = await ctx.db.get(args.productId);
		if (product === null) {
			throw new Error("Unknown lot");
		}
		// Logging a lot on the try list removes the save (ADR-0016): "want to
		// try" is over once it is tried. The removed save goes back as an
		// object, run citation or not, so the undo toast fires for every
		// removal and can restore the save exactly as it was.
		const existingSave = await findSave(ctx, userId, args.productId);
		let removedSave: {
			fromRunId: Id<"recommendationRuns"> | null;
		} | null = null;
		if (existingSave !== null) {
			await ctx.db.delete("savedCoffees", existingSave._id);
			removedSave = { fromRunId: existingSave.fromRunId ?? null };
		}
		const logId = await ctx.db.insert("logs", {
			loggedAt: Date.now(),
			notes: notes === "" ? undefined : notes,
			productId: args.productId,
			rating: args.rating,
			tastingNotes,
			userId,
		});
		return { logId, removedSave };
	},
	returns: v.object({
		logId: v.id("logs"),
		removedSave: v.union(
			v.object({ fromRunId: v.union(v.id("recommendationRuns"), v.null()) }),
			v.null()
		),
	}),
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
		tastingNotes: v.optional(v.union(v.array(tastingNoteValidator), v.null())),
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
		const patch: {
			notes?: string;
			rating?: number;
			tastingNotes?: string[];
		} = {};
		if (args.rating !== undefined) {
			patch.rating = rating;
		}
		if (args.notes !== undefined) {
			patch.notes = notes === "" ? undefined : notes;
		}
		if (args.tastingNotes !== undefined) {
			patch.tastingNotes = cleanTastingNotes(args.tastingNotes);
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
