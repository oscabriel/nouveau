import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { CRAWL_RUNNING_STALE_MS } from "./constants";

/** Crawl-source health (build spec §5): the one state a watch status derives from. */
export const healthValidator = v.union(
	v.literal("watching"),
	v.literal("stale"),
	v.literal("crawl_failed")
);

/** Watch-status chip inputs (build spec §8.4): the source's health plus the
 * timestamps the client needs to render "last checked 4 min ago". */
export const crawlStatusValidator = v.object({
	// True while a crawl is in flight (#34): the chip says "checking".
	checking: v.boolean(),
	health: healthValidator,
	lastCheckedAt: v.union(v.number(), v.null()),
	lastSuccessAt: v.union(v.number(), v.null()),
});

/**
 * A crawl is in flight when runningSince is set and younger than the stale
 * window; an older stamp is a crawl whose action died before finalizeCrawl
 * could clear it, and must not block the source forever.
 */
export const isCrawlRunning = (
	source: Pick<Doc<"crawlSources">, "runningSince">,
	now: number
): boolean =>
	source.runningSince !== undefined &&
	now - source.runningSince < CRAWL_RUNNING_STALE_MS;

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
		return {
			checking: false,
			health: "watching",
			lastCheckedAt: null,
			lastSuccessAt: null,
		};
	}
	return {
		checking: isCrawlRunning(source, Date.now()),
		health: source.health,
		lastCheckedAt: source.lastCheckedAt ?? null,
		lastSuccessAt: source.lastSuccessAt ?? null,
	};
};
