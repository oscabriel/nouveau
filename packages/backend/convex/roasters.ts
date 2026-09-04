import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { query } from "./_generated/server";
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
	websiteUrl: v.string(),
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
				websiteUrl: roaster.websiteUrl,
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
			websiteUrl: roaster.websiteUrl,
		};
	},
	returns: v.union(v.null(), roasterSummaryValidator),
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
		return {
			...page,
			page: page.page.map((lot) => ({
				handle: lot.handle,
				id: lot._id,
				name: lot.name,
				status: lot.status,
			})),
		};
	},
	returns: paginationResultValidator(
		v.object({
			handle: v.string(),
			id: v.id("products"),
			name: v.string(),
			status: v.union(v.literal("current"), v.literal("archived")),
		})
	),
});
