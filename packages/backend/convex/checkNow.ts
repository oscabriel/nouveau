// Check now (#34): a signed-in user or an operator asks for a crawl outside
// the scheduler's cadence. Same code path as the tick (startCrawl); the new
// parts are who asks and how often.

import { RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";
import {
	CHECK_NOW_FRESH_MS,
	CHECK_NOW_SOURCE_PERIOD_MS,
	CHECK_NOW_USER_PERIOD_MS,
	CHECK_NOW_USER_RATE,
} from "./constants";
import { startCrawl } from "./crawlSources";
import { isCrawlRunning } from "./health";
import { requireUserId } from "./identity";

const limiter = new RateLimiter(components.rateLimiter, {
	// One source is checked at most once per window, whoever asks.
	checkNowSource: {
		kind: "fixed window",
		period: CHECK_NOW_SOURCE_PERIOD_MS,
		rate: 1,
	},
	// One user may start a few checks in a row, then waits.
	checkNowUser: {
		capacity: CHECK_NOW_USER_RATE,
		kind: "token bucket",
		period: CHECK_NOW_USER_PERIOD_MS,
		rate: CHECK_NOW_USER_RATE,
	},
});

/**
 * Operator tool: start a crawl now, no quota. Refuses only a source whose
 * crawl is in flight; a stamp older than the stale window is a dead action.
 */
export const crawlNow = internalMutation({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		const source = await ctx.db.get(args.crawlSourceId);
		if (source === null) {
			throw new Error("Unknown crawl source");
		}
		const now = Date.now();
		if (isCrawlRunning(source, now)) {
			return { started: false };
		}
		await startCrawl(ctx, source, now);
		return { started: true };
	},
	returns: v.object({ started: v.boolean() }),
});

const requestCheckResult = v.union(
	v.object({ status: v.literal("started") }),
	v.object({ status: v.literal("running") }),
	v.object({ lastSuccessAt: v.number(), status: v.literal("fresh") }),
	v.object({ retryAfter: v.number(), status: v.literal("limited") })
);

/**
 * User-started check from the roaster page. Identity comes from the session
 * token; the roaster id names the source. Fresh and running answers cost the
 * user no quota; only an attempt that would start a crawl consumes a token.
 */
export const requestCheck = mutation({
	args: { roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const source = await ctx.db
			.query("crawlSources")
			.withIndex("by_roaster_id", (q) => q.eq("roasterId", args.roasterId))
			.first();
		if (source === null) {
			throw new Error("Unknown roaster");
		}
		const now = Date.now();
		if (
			source.lastSuccessAt !== undefined &&
			now - source.lastSuccessAt < CHECK_NOW_FRESH_MS
		) {
			return { lastSuccessAt: source.lastSuccessAt, status: "fresh" as const };
		}
		if (isCrawlRunning(source, now)) {
			return { status: "running" as const };
		}
		// Peek at the user's bucket before claiming the source window, so a
		// user who is out of tokens does not burn the window for everyone else;
		// then claim both. Same transaction, so the peek cannot go stale.
		const userQuota = await limiter.check(ctx, "checkNowUser", { key: userId });
		if (!userQuota.ok) {
			return { retryAfter: userQuota.retryAfter, status: "limited" as const };
		}
		const perSource = await limiter.limit(ctx, "checkNowSource", {
			key: source._id,
		});
		if (!perSource.ok) {
			return { retryAfter: perSource.retryAfter, status: "limited" as const };
		}
		await limiter.limit(ctx, "checkNowUser", { key: userId });
		await startCrawl(ctx, source, now);
		return { status: "started" as const };
	},
	returns: requestCheckResult,
});
