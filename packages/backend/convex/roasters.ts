import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { LOT_SEARCH_LIMIT } from "./constants";
import { followerCounts } from "./followerCounts";
import { crawlStatusValidator, getCrawlStatus } from "./health";

/** Roaster fields every roaster surface renders (directory, watches, page). */
export const roasterCardValidator = v.object({
	city: v.string(),
	id: v.id("roasters"),
	name: v.string(),
	slug: v.string(),
	state: v.string(),
});

/** Roaster card plus watcher count and the status-chip inputs. */
const roasterSummaryValidator = v.object({
	...roasterCardValidator.fields,
	followerCount: v.number(),
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
				name: roaster.name,
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
			name: roaster.name,
			slug: roaster.slug,
			state: roaster.state,
			status: await getCrawlStatus(ctx, roaster._id),
		};
	},
	returns: v.union(v.null(), roasterSummaryValidator),
});

const lotRowValidator = v.object({
	handle: v.string(),
	id: v.id("products"),
	name: v.string(),
	status: v.union(v.literal("current"), v.literal("archived")),
});

const toLotRow = (lot: Doc<"products">): Infer<typeof lotRowValidator> => ({
	handle: lot.handle,
	id: lot._id,
	name: lot.name,
	status: lot.status,
});

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
 * Find lots by name within one roaster's catalog, for the taster who knows
 * what they drank but not where it sits in an 800-lot list. Full-text over
 * `products.name`; archived lots included for the same reason as listLots.
 */
export const searchLots = query({
	args: { roasterId: v.id("roasters"), term: v.string() },
	handler: async (ctx, args) => {
		const term = args.term.trim();
		if (term === "") {
			return [];
		}
		const lots = await ctx.db
			.query("products")
			.withSearchIndex("search_name", (q) =>
				q.search("name", term).eq("roasterId", args.roasterId)
			)
			.take(LOT_SEARCH_LIMIT);
		return lots.map(toLotRow);
	},
	returns: v.array(lotRowValidator),
});
