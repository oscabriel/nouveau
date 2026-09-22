import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { LOT_FILTER_SCAN, LOT_SEARCH_LIMIT } from "./constants";
import { followerCounts } from "./followerCounts";
import { crawlStatusValidator, getCrawlStatus } from "./health";
import { joinNotes, mergedFacts } from "./lotFacts";
import { lotAvailability, lotAvailabilityValidator } from "./lotStock";
import { taggedNoteValidator, tagNotes } from "./tasting";

/** Roaster fields every roaster surface renders (directory, watches, page). */
export const roasterCardValidator = v.object({
	city: v.string(),
	id: v.id("roasters"),
	name: v.string(),
	slug: v.string(),
	state: v.string(),
});

/** Roaster card plus watcher count, the status-chip inputs and the two
 * catalog counters the directory shows (0 until the roaster's first
 * counted crawl). */
const roasterSummaryValidator = v.object({
	...roasterCardValidator.fields,
	followerCount: v.number(),
	lotCount: v.number(),
	newLotCount: v.number(),
	status: crawlStatusValidator,
});

/** Active roasters for the directory and the home teaser. */
export const listActive = query({
	args: {},
	handler: async (ctx) => {
		const roasters = await ctx.db
			.query("roasters")
			.withIndex("by_status_and_state", (q) => q.eq("status", "active"))
			.take(100);
		return Promise.all(
			roasters.map(async (roaster) => ({
				city: roaster.city,
				followerCount: await followerCounts.count(ctx, {
					namespace: roaster._id,
				}),
				id: roaster._id,
				lotCount: roaster.lotCount ?? 0,
				name: roaster.name,
				newLotCount: roaster.newLotCount ?? 0,
				slug: roaster.slug,
				state: roaster.state,
				status: await getCrawlStatus(ctx, roaster._id),
			}))
		);
	},
	returns: v.array(roasterSummaryValidator),
});

/** One roaster by slug, for the roaster page. Null when unknown or inactive. */
export const getBySlug = query({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const roaster = await ctx.db
			.query("roasters")
			.withIndex("by_slug", (q) => q.eq("slug", args.slug))
			.unique();
		if (roaster === null || roaster.status !== "active") {
			return null;
		}
		return {
			city: roaster.city,
			followerCount: await followerCounts.count(ctx, {
				namespace: roaster._id,
			}),
			id: roaster._id,
			lotCount: roaster.lotCount ?? 0,
			name: roaster.name,
			newLotCount: roaster.newLotCount ?? 0,
			slug: roaster.slug,
			state: roaster.state,
			status: await getCrawlStatus(ctx, roaster._id),
		};
	},
	returns: v.union(v.null(), roasterSummaryValidator),
});

const lotRowValidator = v.object({
	// The stock boundary (lotStock.lotAvailability): true when current with a
	// purchasable size, false when sold out or archived, null when the crawl
	// has not written the rollup yet (unknown, never sold out).
	available: lotAvailabilityValidator,
	// The bag sizes the feed carries (grams ascending); the weight filter's
	// choices derive from these.
	grams: v.array(v.number()),
	handle: v.string(),
	id: v.id("products"),
	// The lot's photo (the floating hover image, ADR-0015); null when the
	// crawl has not seen one.
	imageUrl: v.union(v.string(), v.null()),
	// What the cheapest purchasable size costs; null when the feed gave no
	// prices (unknown, not free).
	minPriceCents: v.union(v.number(), v.null()),
	name: v.string(),
	// The lot's origin as the feed publishes it (filterable, shown on md+).
	origin: v.union(v.string(), v.null()),
	// Roaster notes (§14.4): descriptors from the roaster's own copy, shown
	// while picking a lot and while logging it. Feed notes first, else the
	// page read's (ADR-0008: the grid column is what the sweep fills).
	roasterNotes: v.union(v.string(), v.null()),
	// The same descriptors one by one with their wheel family, for the
	// table's colored pills (owner, 2026-09-21); empty when there are none.
	roasterTags: v.array(taggedNoteValidator),
	status: v.union(v.literal("current"), v.literal("archived")),
});

const toLotRow = (lot: Doc<"products">): Infer<typeof lotRowValidator> => ({
	available: lotAvailability(lot),
	grams: lot.weightOptions ?? [],
	handle: lot.handle,
	id: lot._id,
	imageUrl: lot.imageUrl ?? null,
	minPriceCents: lot.minPriceCents ?? null,
	name: lot.name,
	origin: lot.origin ?? null,
	roasterNotes: joinNotes(mergedFacts(lot).notes),
	roasterTags: tagNotes(mergedFacts(lot).notes),
	status: lot.status,
});

/** The grid's optional filters; every field absent means "no filter". */
const lotFilterValidator = v.object({
	// Purchaseable now: status current and at least one size in stock.
	availableOnly: v.optional(v.boolean()),
	// The feed carries this bag size (grams).
	grams: v.optional(v.number()),
	// The cheapest size costs at most this many cents.
	maxPriceCents: v.optional(v.number()),
	// Case-insensitive substring of the lot's origin.
	origin: v.optional(v.string()),
});

/**
 * The filters as one predicate over a stored lot. Weight membership and
 * origin substrings are not FilterBuilder expressions, so the filtered
 * queries run a bounded index scan and filter in JS; per-roaster catalogs
 * are bounded (~900 lots at the extreme), so the scan is too.
 */
const matchesLotFilters = (
	lot: Doc<"products">,
	args: Infer<typeof lotFilterValidator>
): boolean => {
	if (args.availableOnly === true && lotAvailability(lot) !== true) {
		return false;
	}
	if (
		args.maxPriceCents !== undefined &&
		(lot.minPriceCents ?? Infinity) > args.maxPriceCents
	) {
		return false;
	}
	if (
		args.grams !== undefined &&
		!(lot.weightOptions ?? []).includes(args.grams)
	) {
		return false;
	}
	if (
		args.origin !== undefined &&
		args.origin !== "" &&
		!(lot.origin ?? "").toLowerCase().includes(args.origin.toLowerCase())
	) {
		return false;
	}
	return true;
};

/**
 * One roaster's lot catalog, paginated (screen inventory §11's Lots grid).
 * Ordered by externalId; archived lots stay in the list (dimmed client-side)
 * because archived lots remain loggable (spec §14.1).
 */
export const listLots = query({
	args: {
		paginationOpts: paginationOptsValidator,
		roasterId: v.id("roasters"),
	},
	handler: async (ctx, args) => {
		const page = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_external_id", (q) =>
				q.eq("roasterId", args.roasterId)
			)
			.paginate(args.paginationOpts);
		return { ...page, page: page.page.map(toLotRow) };
	},
	returns: paginationResultValidator(lotRowValidator),
});

/**
 * The catalog under the grid's filters: one bounded index scan of the whole
 * roaster, one JS filter, one bounded result. Used instead of listLots when
 * a filter is active; the browse-then-load-more path stays paginate-based.
 */
/** One roaster's whole catalog, up to the ADR-0007 scan bound. */
const scanRoasterLots = (ctx: QueryCtx, roasterId: Id<"roasters">) =>
	ctx.db
		.query("products")
		.withIndex("by_roaster_and_external_id", (q) =>
			q.eq("roasterId", roasterId)
		)
		.take(LOT_FILTER_SCAN);

export const listLotsFiltered = query({
	args: { ...lotFilterValidator.fields, roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const lots = await scanRoasterLots(ctx, args.roasterId);
		return lots.filter((lot) => matchesLotFilters(lot, args)).map(toLotRow);
	},
	returns: v.array(lotRowValidator),
});

/**
 * The bag sizes one roaster's catalog carries, distinct and ascending: the
 * grid's size-filter choices. Read over the whole catalog (the same bounded
 * scan as listLotsFiltered), so a size that first appears on page three is
 * selectable before that page loads.
 */
export const lotWeightOptions = query({
	args: { roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const lots = await scanRoasterLots(ctx, args.roasterId);
		const grams = [...new Set(lots.flatMap((lot) => lot.weightOptions ?? []))];
		// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; grams is a fresh array
		return grams.sort((a, b) => a - b);
	},
	returns: v.array(v.number()),
});

/**
 * Find lots by name within one roaster's catalog, for the taster who knows
 * what they drank but not where it sits in an 800-lot list. Full-text over
 * `products.name`; archived lots included for the same reason as listLots.
 */
export const searchLots = query({
	args: {
		...lotFilterValidator.fields,
		roasterId: v.id("roasters"),
		term: v.string(),
	},
	handler: async (ctx, args) => {
		const term = args.term.trim();
		if (term === "") {
			return [];
		}
		// The filters run inside the scan, so a filtered search returns up to
		// LOT_SEARCH_LIMIT matches instead of whatever survives filtering the
		// first LOT_SEARCH_LIMIT name hits. The scan itself stops at the same
		// bound as the filtered browse.
		const rows: Infer<typeof lotRowValidator>[] = [];
		let scanned = 0;
		for await (const lot of ctx.db
			.query("products")
			.withSearchIndex("search_name", (q) =>
				q.search("name", term).eq("roasterId", args.roasterId)
			)) {
			scanned += 1;
			if (matchesLotFilters(lot, args)) {
				rows.push(toLotRow(lot));
			}
			if (rows.length >= LOT_SEARCH_LIMIT || scanned >= LOT_FILTER_SCAN) {
				break;
			}
		}
		return rows;
	},
	returns: v.array(lotRowValidator),
});
