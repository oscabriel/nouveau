// Paste a roastery URL (build spec §7.1). A signed-in user names a shop; the
// platform ladder decides how to read it, the baseline crawl fills the
// catalog and flips the roaster active, and the submitter's watch lands with
// it. There is no review queue: a failed baseline is the visible failed
// state, and `rejected` is applied by hand to junk.

import { RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	mutation,
	query,
} from "./_generated/server";
import {
	DEFAULT_CADENCE_MINUTES,
	MAX_ACTIVE_SUBMISSIONS_PER_USER,
	SUBMISSION_DAY_MS,
	SUBMISSION_RETRY_PERIOD_MS,
	SUBMISSION_RETRY_RATE,
	MAX_SUBMISSIONS_PER_DAY,
} from "./constants";
import { probeAndStoreMode } from "./crawler";
import { startCrawl } from "./crawlSources";
import { crawlStatusValidator, getCrawlStatus, isCrawlRunning } from "./health";
import { optionalUserId, requireUserId } from "./identity";
import { sourceModeValidator } from "./sourceMode";
import { ensureWatch } from "./watches";

const limiter = new RateLimiter(components.rateLimiter, {
	// Retries of a failed baseline: a few in a row, then a wait.
	submissionRetry: {
		capacity: SUBMISSION_RETRY_RATE,
		kind: "token bucket",
		period: SUBMISSION_RETRY_PERIOD_MS,
		rate: SUBMISSION_RETRY_RATE,
	},
	// New shops per user per day; the credit bound for product_pages shops.
	submissionsDay: {
		kind: "fixed window",
		period: SUBMISSION_DAY_MS,
		rate: MAX_SUBMISSIONS_PER_DAY,
	},
});

const NAME_MAX = 80;
const PLACE_MAX = 60;
const STATE = /^[A-Z]{2}$/u;

export interface NormalizedShop {
	/** Registrable domain, the dedup key: `shop.example.com` is `example.com`. */
	domain: string;
	/** The pasted page without query or hash; what product_pages scrapes. */
	productPageUrl: string;
	slug: string;
	/** The https origin. */
	websiteUrl: string;
}

/**
 * The pasted URL as the catalog stores a shop. Accepts a bare domain, forces
 * https, drops query and hash, and keeps the path: a user who pastes the
 * page that lists the coffees has named the collection page product_pages
 * mode needs. Null for anything that is not an http(s) host with a dot.
 */
export const normalizeShopUrl = (input: string): NormalizedShop | null => {
	const trimmed = input.trim();
	if (trimmed === "") {
		return null;
	}
	let url: URL;
	try {
		url = new URL(
			/^https?:\/\//iu.test(trimmed) ? trimmed : `https://${trimmed}`
		);
	} catch {
		return null;
	}
	if (url.username || url.password || !url.hostname.includes(".")) {
		return null;
	}
	url.protocol = "https:";
	url.port = "";
	const labels = url.hostname.toLowerCase().split(".");
	const domain = labels.slice(-2).join(".");
	const path = url.pathname.replace(/\/+$/u, "");
	return {
		domain,
		productPageUrl: `${url.origin}${path}`,
		slug: domain.replace(/\.[^.]+$/u, ""),
		websiteUrl: url.origin,
	};
};

const submitResult = v.union(
	// A roaster on that domain exists; the user now watches it.
	v.object({ slug: v.string(), status: v.literal("already") }),
	v.object({ roasterId: v.id("roasters"), status: v.literal("submitted") }),
	v.object({ retryAfter: v.number(), status: v.literal("limited") }),
	// Five submitted roasters are pending or active already.
	v.object({ status: v.literal("quota") }),
	v.object({ status: v.literal("invalid") })
);

const countsToward = (roaster: Doc<"roasters">): boolean =>
	roaster.status === "pending" || roaster.status === "active";

/**
 * Step 1 and 2 of §7.1, the parts that need a transaction: dedup on the
 * domain, the quotas, the pending roaster and its source. The probe and the
 * baseline crawl run in the scheduled action. The source starts with a
 * placeholder mode and a due date one cadence out, so the scheduler tick
 * does not crawl it before the probe has chosen how.
 */
export const submit = mutation({
	args: {
		city: v.string(),
		name: v.string(),
		state: v.string(),
		url: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const shop = normalizeShopUrl(args.url);
		const name = args.name.trim().slice(0, NAME_MAX);
		const city = args.city.trim().slice(0, PLACE_MAX);
		const state = args.state.trim().toUpperCase();
		if (shop === null || name === "" || city === "" || !STATE.test(state)) {
			return { status: "invalid" as const };
		}

		const existing = await ctx.db
			.query("roasters")
			.withIndex("by_domain", (q) => q.eq("domain", shop.domain))
			.first();
		if (existing !== null) {
			if (existing.status === "active") {
				await ensureWatch(ctx, userId, existing._id);
			}
			return { slug: existing.slug, status: "already" as const };
		}

		const mine = await ctx.db
			.query("roasters")
			.withIndex("by_submitted_by_user_id", (q) =>
				q.eq("submittedByUserId", userId)
			)
			.take(MAX_ACTIVE_SUBMISSIONS_PER_USER + 1);
		if (mine.filter(countsToward).length >= MAX_ACTIVE_SUBMISSIONS_PER_USER) {
			return { status: "quota" as const };
		}
		const day = await limiter.limit(ctx, "submissionsDay", { key: userId });
		if (!day.ok) {
			return { retryAfter: day.retryAfter, status: "limited" as const };
		}

		const now = Date.now();
		const roasterId = await ctx.db.insert("roasters", {
			city,
			claimed: false,
			domain: shop.domain,
			name,
			productPageUrl: shop.productPageUrl,
			slug: shop.slug,
			source: "user-submitted",
			state,
			status: "pending",
			submittedByUserId: userId,
			websiteUrl: shop.websiteUrl,
		});
		const crawlSourceId = await ctx.db.insert("crawlSources", {
			cadenceMinutes: DEFAULT_CADENCE_MINUTES,
			consecutiveFailures: 0,
			health: "watching",
			mode: "product_pages",
			nextCrawlDueAt: now + DEFAULT_CADENCE_MINUTES * 60_000,
			roasterId,
		});
		await ctx.scheduler.runAfter(0, internal.submissions.probeAndBaseline, {
			crawlSourceId,
		});
		return { roasterId, status: "submitted" as const };
	},
	returns: submitResult,
});

/**
 * Claim the source for its baseline the way every crawl starts (startCrawl),
 * from the probe action. Refuses a source already in flight.
 */
export const startBaseline = internalMutation({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		const source = await ctx.db.get(args.crawlSourceId);
		if (source === null) {
			return null;
		}
		const now = Date.now();
		if (!isCrawlRunning(source, now)) {
			await startCrawl(ctx, source, now);
		}
		return null;
	},
	returns: v.null(),
});

/**
 * Steps 2 and 3 of §7.1: run the ladder, store the mode, start the baseline.
 * The crawl's own finalizeCrawl flips the roaster active or records the
 * failure the submissions page shows.
 */
export const probeAndBaseline = internalAction({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		const mode = await probeAndStoreMode(ctx, args.crawlSourceId);
		if (mode === null) {
			return null;
		}
		await ctx.runMutation(internal.submissions.startBaseline, {
			crawlSourceId: args.crawlSourceId,
		});
		return null;
	},
	returns: v.null(),
});

const retryResult = v.union(
	v.object({ status: v.literal("started") }),
	v.object({ status: v.literal("running") }),
	v.object({ retryAfter: v.number(), status: v.literal("limited") })
);

/**
 * The retry button on a failed submission (§7.1 step 4). Re-runs the probe
 * too, since a shop that was down when first pasted may have landed on the
 * wrong rung. Only the submitter may retry; a roaster already active has
 * Check now instead.
 */
export const retry = mutation({
	args: { roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const roaster = await ctx.db.get(args.roasterId);
		if (
			roaster === null ||
			roaster.submittedByUserId !== userId ||
			roaster.status !== "pending"
		) {
			throw new Error("Not a pending submission of yours");
		}
		const source = await ctx.db
			.query("crawlSources")
			.withIndex("by_roaster_id", (q) => q.eq("roasterId", args.roasterId))
			.unique();
		if (source === null) {
			throw new Error("Submission has no crawl source");
		}
		if (isCrawlRunning(source, Date.now())) {
			return { status: "running" as const };
		}
		const quota = await limiter.limit(ctx, "submissionRetry", { key: userId });
		if (!quota.ok) {
			return { retryAfter: quota.retryAfter, status: "limited" as const };
		}
		await ctx.scheduler.runAfter(0, internal.submissions.probeAndBaseline, {
			crawlSourceId: source._id,
		});
		return { status: "started" as const };
	},
	returns: retryResult,
});

const submissionValidator = v.object({
	city: v.string(),
	crawl: crawlStatusValidator,
	id: v.id("roasters"),
	// The crawler's last error, for the failed state's copy.
	lastError: v.union(v.string(), v.null()),
	mode: sourceModeValidator,
	name: v.string(),
	slug: v.string(),
	state: v.string(),
	status: v.union(
		v.literal("pending"),
		v.literal("active"),
		v.literal("rejected")
	),
	websiteUrl: v.string(),
});

/** The signed-in user's submissions, newest first. Empty when signed out. */
export const mine = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return [];
		}
		const roasters = await ctx.db
			.query("roasters")
			.withIndex("by_submitted_by_user_id", (q) =>
				q.eq("submittedByUserId", userId)
			)
			.order("desc")
			.take(50);
		return Promise.all(
			roasters.map(async (roaster) => {
				const source = await ctx.db
					.query("crawlSources")
					.withIndex("by_roaster_id", (q) => q.eq("roasterId", roaster._id))
					.first();
				return {
					city: roaster.city,
					crawl: await getCrawlStatus(ctx, roaster._id),
					id: roaster._id,
					lastError: source?.lastErrorMessage ?? null,
					mode: source?.mode ?? "product_pages",
					name: roaster.name,
					slug: roaster.slug,
					state: roaster.state,
					status: roaster.status,
					websiteUrl: roaster.websiteUrl,
				};
			})
		);
	},
	returns: v.array(submissionValidator),
});

/** How many more shops the user may submit today, for the form's copy. */
export const quota = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return null;
		}
		const submitted = await ctx.db
			.query("roasters")
			.withIndex("by_submitted_by_user_id", (q) =>
				q.eq("submittedByUserId", userId)
			)
			.take(MAX_ACTIVE_SUBMISSIONS_PER_USER + 1);
		const day = await limiter.check(ctx, "submissionsDay", { key: userId });
		return {
			activeLeft: Math.max(
				0,
				MAX_ACTIVE_SUBMISSIONS_PER_USER - submitted.filter(countsToward).length
			),
			todayOk: day.ok,
		};
	},
	returns: v.union(
		v.null(),
		v.object({ activeLeft: v.number(), todayOk: v.boolean() })
	),
});
