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
