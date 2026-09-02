import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** Crawl-source health (build spec §5): the one state a watch status derives from. */
export const healthValidator = v.union(
	v.literal("watching"),
	v.literal("stale"),
	v.literal("crawl_failed")
);

/** Watch-status chip inputs (build spec §8.4): the source's health plus the
 * timestamps the client needs to render "last checked 4 min ago". */
export const crawlStatusValidator = v.object({
	health: healthValidator,
	lastCheckedAt: v.union(v.number(), v.null()),
	lastSuccessAt: v.union(v.number(), v.null()),
});

export type CrawlHealth = typeof healthValidator.type;
export type CrawlStatus = typeof crawlStatusValidator.type;

/**
 * One crawl source per roaster; surface its health for status chips. A
 * roaster with no source yet is still "watching" but has never been checked,
 * which the null timestamps carry so the chip can say so.
 */
export const getCrawlStatus = async (
	ctx: QueryCtx,
	roasterId: Id<"roasters">
): Promise<CrawlStatus> => {
	const source = await ctx.db
		.query("crawlSources")
		.withIndex("by_roaster_id", (q) => q.eq("roasterId", roasterId))
		.first();
	if (source === null) {
		return { health: "watching", lastCheckedAt: null, lastSuccessAt: null };
	}
	return {
		health: source.health,
		lastCheckedAt: source.lastCheckedAt ?? null,
		lastSuccessAt: source.lastSuccessAt ?? null,
	};
};
