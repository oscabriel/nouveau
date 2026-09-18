// The lot page (build spec §15, ADR-0003): one public page per lot, the
// Letterboxd object-page shape. The lot's published copy (§14.4) plus its
// recent logs with ratings and tasters.

import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { LOT_PAGE_LOGS_LIMIT, LOT_PAGE_VARIANTS_LIMIT } from "./constants";
import { hydrateAll, logCardValidator } from "./logs";
import { isThin, mergedFacts, variantGrind } from "./lotFacts";
import { lotAvailability, lotAvailabilityValidator } from "./lotStock";
import { lotShopUrl, variantShopUrl } from "./lotUrl";

const factsValidator = v.object({
	elevation: v.union(v.string(), v.null()),
	notes: v.array(v.string()),
	origin: v.union(v.string(), v.null()),
	process: v.union(v.string(), v.null()),
	producer: v.union(v.string(), v.null()),
	region: v.union(v.string(), v.null()),
	roastLevel: v.union(v.string(), v.null()),
	variety: v.union(v.string(), v.null()),
});

/**
 * One row of the lot page's size table: a weight, its grind options, its
 * price, its stock, and the deep link to the exact size on the roaster's
 * shop (the lot page when the source publishes no variant id).
 */
const variantRowValidator = v.object({
	available: v.boolean(),
	// The weight in grams when the variant name carried one.
	grams: v.union(v.number(), v.null()),
	// The grind option, split off the display name ("2kg / Grind for Espresso").
	grind: v.union(v.string(), v.null()),
	id: v.id("productVariants"),
	name: v.string(),
	priceCents: v.number(),
	url: v.string(),
});

const lotValidator = v.object({
	// The lot page's stock boundary (lotStock.lotAvailability): true when a
	// size is in stock, false when sold out or archived, null when the rollup
	// is not written yet (unknown, never sold out).
	available: lotAvailabilityValidator,
	description: v.union(v.string(), v.null()),
	// The roaster's facts, feed first with page facts filling gaps
	// (ADR-0005, lotFacts.mergedFacts).
	facts: factsValidator,
	// url is the roaster's own product page — the lot page links out to the
	// shop, the shop never replaces the page.
	handle: v.string(),
	id: v.id("products"),
	imageUrl: v.union(v.string(), v.null()),
	name: v.string(),
	// Page-read state for the client: when the page was last asked for and
	// whether it answered. The client decides "ask" and "reading" from these
	// with its own clock, since a query cannot read the wall clock.
	pageFactsAt: v.union(v.number(), v.null()),
	pageFactsKnown: v.boolean(),
	status: v.union(v.literal("current"), v.literal("archived")),
	// Whether the merged facts still miss what a card leans on; with
	// pageFactsKnown false this is the lot page's cue to ask.
	thin: v.boolean(),
	url: v.string(),
	// The size table, one row per purchasable option the roaster publishes.
	variants: v.array(variantRowValidator),
});

/**
 * The size table's rows: one per stored variant, sizes first, stable order.
 * The page promises every purchasable option, so the read bound
 * (LOT_PAGE_VARIANTS_LIMIT) sits well above any real lot; the recommender's
 * MAX_VARIANTS_PER_PRODUCT is its own eligibility cut, not a page limit.
 */
const lotVariantRows = async (
	ctx: QueryCtx,
	lot: Doc<"products">,
	roaster: Doc<"roasters">
): Promise<Infer<typeof variantRowValidator>[]> => {
	const variants = await ctx.db
		.query("productVariants")
		.withIndex("by_product_id", (q) => q.eq("productId", lot._id))
		.take(LOT_PAGE_VARIANTS_LIMIT);
	const rows = variants.map((variant) => {
		const grind = variantGrind(variant.name);
		return {
			available: variant.available,
			grams: variant.grams ?? null,
			grind,
			id: variant._id,
			name: variant.name,
			priceCents: variant.priceCents,
			url:
				variantShopUrl(roaster, lot, variant) ??
				lotShopUrl(roaster, lot) ??
				roaster.websiteUrl,
		};
	});
	// Sizes ascending, grind options next to their size, sold out last.
	// eslint-disable-next-line unicorn/no-array-sort -- ES2021 backend; no toSorted in this lib target
	const sorted = [...rows].sort(
		(a, b) =>
			Number(b.available) - Number(a.available) ||
			(a.grams ?? Number.MAX_SAFE_INTEGER) -
				(b.grams ?? Number.MAX_SAFE_INTEGER) ||
			a.name.localeCompare(b.name)
	);
	return sorted;
};

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
				available: lotAvailability(lot),
				description: lot.description ?? null,
				facts: mergedFacts(lot),
				handle: lot.handle,
				id: lot._id,
				imageUrl: lot.imageUrl ?? null,
				name: lot.name,
				pageFactsAt: lot.copyFetchedAt ?? null,
				pageFactsKnown: lot.pageFacts !== undefined,
				status: lot.status,
				thin: isThin(lot),
				url: lotShopUrl(roaster, lot) ?? roaster.websiteUrl,
				variants: await lotVariantRows(ctx, lot, roaster),
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
