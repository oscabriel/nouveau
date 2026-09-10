// The lot page (build spec §15, ADR-0003): one public page per lot, the
// Letterboxd object-page shape. The lot's published copy (§14.4) plus its
// recent logs with ratings and tasters.

import { v } from "convex/values";

import { query } from "./_generated/server";
import { LOT_PAGE_LOGS_LIMIT } from "./constants";
import { hydrateAll, logCardValidator } from "./logs";

const lotValidator = v.object({
	description: v.union(v.string(), v.null()),
	// url is the roaster's own product page — the lot page links out to the
	// shop, the shop never replaces the page.
	handle: v.string(),
	id: v.id("products"),
	imageUrl: v.union(v.string(), v.null()),
	name: v.string(),
	origin: v.union(v.string(), v.null()),
	process: v.union(v.string(), v.null()),
	roastLevel: v.union(v.string(), v.null()),
	roasterNotes: v.union(v.string(), v.null()),
	status: v.union(v.literal("current"), v.literal("archived")),
	url: v.string(),
});

/**
 * One lot page's data. The id arrives as a string straight from the URL, so
 * a malformed one resolves to null (the "no lot here" page) instead of
 * failing argument validation — the same contract as logs.profile. Archived
 * lots resolve fully: logs keep resolving (§14.1).
 */
export const get = query({
	args: { lotId: v.string() },
	handler: async (ctx, args) => {
		const lotId = ctx.db.normalizeId("products", args.lotId);
		if (lotId === null) {
			return null;
		}
		const lot = await ctx.db.get(lotId);
		if (lot === null) {
			return null;
		}
		const roaster = await ctx.db.get(lot.roasterId);
		if (roaster === null) {
			return null;
		}
		const logs = await ctx.db
			.query("logs")
			.withIndex("by_product_and_logged_at", (q) => q.eq("productId", lotId))
			.order("desc")
			.take(LOT_PAGE_LOGS_LIMIT + 1);
		return {
			logs: await hydrateAll(ctx, logs.slice(0, LOT_PAGE_LOGS_LIMIT)),
			logsTruncated: logs.length > LOT_PAGE_LOGS_LIMIT,
			lot: {
				description: lot.description ?? null,
				handle: lot.handle,
				id: lot._id,
				imageUrl: lot.imageUrl ?? null,
				name: lot.name,
				origin: lot.origin ?? null,
				process: lot.process ?? null,
				roastLevel: lot.roastLevel ?? null,
				roasterNotes: lot.roasterNotes ?? null,
				status: lot.status,
				url: `${roaster.websiteUrl}/products/${lot.handle}`,
			},
			roaster: { name: roaster.name, slug: roaster.slug },
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			logs: v.array(logCardValidator),
			logsTruncated: v.boolean(),
			lot: lotValidator,
			roaster: v.object({ name: v.string(), slug: v.string() }),
		})
	),
});
