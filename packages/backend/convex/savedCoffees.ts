// "Want to try" (product spec §6): a private bookmark on a lot. Saving does
// not email, does not create a watch, and never appears on a public profile.
// The user comes from the session; the run id, when present, only records
// where the save came from.

import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	HOME_SAVED_COFFEES_LIMIT,
	MAX_SAVED_COFFEES_PER_USER,
} from "./constants";
import { optionalUserId, requireUserId } from "./identity";
import { MAX_VARIANTS_PER_PRODUCT } from "./recommendationRules";

/** One saved lot as the home section and the full list render it. */
export const savedCoffeeValidator = v.object({
	// Whether any variant is in stock as of the latest crawl.
	available: v.boolean(),
	fromRunId: v.union(v.id("recommendationRuns"), v.null()),
	lot: v.object({
		id: v.id("products"),
		imageUrl: v.union(v.string(), v.null()),
		name: v.string(),
		status: v.union(v.literal("current"), v.literal("archived")),
		url: v.string(),
	}),
	roaster: v.object({ name: v.string(), slug: v.string() }),
	savedAt: v.number(),
	savedId: v.id("savedCoffees"),
});

const findSave = (
	ctx: QueryCtx | MutationCtx,
	userId: Id<"users">,
	productId: Id<"products">
) =>
	ctx.db
		.query("savedCoffees")
		.withIndex("by_user_and_product", (q) =>
			q.eq("userId", userId).eq("productId", productId)
		)
		.unique();

/** Hydrate a save; null when its lot or roaster vanished. */
const hydrateSave = async (ctx: QueryCtx, save: Doc<"savedCoffees">) => {
	const product = await ctx.db.get(save.productId);
	if (product === null) {
		return null;
	}
	const [roaster, variants] = await Promise.all([
		ctx.db.get(product.roasterId),
		ctx.db
			.query("productVariants")
			.withIndex("by_product_id", (q) => q.eq("productId", product._id))
			.take(MAX_VARIANTS_PER_PRODUCT),
	]);
	if (roaster === null) {
		return null;
	}
	return {
		available:
			product.status === "current" &&
			variants.some((variant) => variant.available),
		fromRunId: save.fromRunId ?? null,
		lot: {
			id: product._id,
			imageUrl: product.imageUrl ?? null,
			name: product.name,
			status: product.status,
			url: `${roaster.websiteUrl}/products/${product.handle}`,
		},
		roaster: { name: roaster.name, slug: roaster.slug },
		savedAt: save.savedAt,
		savedId: save._id,
	};
};

const hydrateAll = async (ctx: QueryCtx, saves: Doc<"savedCoffees">[]) => {
	const cards = await Promise.all(saves.map((save) => hydrateSave(ctx, save)));
	return cards.filter((card) => card !== null);
};

/** Save a lot. Idempotent; a second save keeps the first row and its run. */
export const save = mutation({
	args: {
		fromRunId: v.optional(v.id("recommendationRuns")),
		productId: v.id("products"),
	},
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const product = await ctx.db.get(args.productId);
		if (product === null) {
			throw new Error("Unknown lot");
		}
		if (await findSave(ctx, userId, args.productId)) {
			return null;
		}
		let fromRunId: Id<"recommendationRuns"> | undefined;
		if (args.fromRunId !== undefined) {
			// Only the caller's own run may be cited; anything else is dropped,
			// not rejected, because the save itself is still valid.
			const run = await ctx.db.get(args.fromRunId);
			if (run !== null && run.userId === userId) {
				fromRunId = run._id;
			}
		}
		await ctx.db.insert("savedCoffees", {
			fromRunId,
			productId: args.productId,
			savedAt: Date.now(),
			userId,
		});
		return null;
	},
	returns: v.null(),
});

/** Remove a save. A no-op when there is nothing to remove. */
export const unsave = mutation({
	args: { productId: v.id("products") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const existing = await findSave(ctx, userId, args.productId);
		if (existing === null) {
			return null;
		}
		await ctx.db.delete("savedCoffees", existing._id);
		return null;
	},
	returns: v.null(),
});

/** Lot ids the signed-in user saved, for Save/Saved button state anywhere. */
export const mySavedProductIds = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return [];
		}
		const saves = await ctx.db
			.query("savedCoffees")
			.withIndex("by_user_and_saved_at", (q) => q.eq("userId", userId))
			.take(MAX_SAVED_COFFEES_PER_USER);
		return saves.map((row) => row.productId);
	},
	returns: v.array(v.id("products")),
});

/** The newest few saves for the signed-in home's "Want to try" section. */
export const recentMine = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return { items: [], more: false };
		}
		const saves = await ctx.db
			.query("savedCoffees")
			.withIndex("by_user_and_saved_at", (q) => q.eq("userId", userId))
			.order("desc")
			.take(HOME_SAVED_COFFEES_LIMIT + 1);
		return {
			items: await hydrateAll(ctx, saves.slice(0, HOME_SAVED_COFFEES_LIMIT)),
			more: saves.length > HOME_SAVED_COFFEES_LIMIT,
		};
	},
	returns: v.object({
		items: v.array(savedCoffeeValidator),
		more: v.boolean(),
	}),
});

/** Every save of the signed-in user, newest first, paginated. */
export const listMine = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const page = await ctx.db
			.query("savedCoffees")
			.withIndex("by_user_and_saved_at", (q) => q.eq("userId", userId))
			.order("desc")
			.paginate(args.paginationOpts);
		return { ...page, page: await hydrateAll(ctx, page.page) };
	},
	returns: paginationResultValidator(savedCoffeeValidator),
});
