// Page facts on demand (ADR-0005, option C). A lot's rendered product page
// is read the first time someone looks at a thin lot: the lot page asks
// through `request`, the recommendation worker asks for a candidate. One
// Firecrawl json scrape, every value verified letter for letter on the page
// and through the shared per-field shape (extraction.verifyPageFacts), then
// stored in `products.pageFacts`, which the feed write never touches.

import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
	internalAction,
	internalMutation,
	mutation,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { verifyPageFacts } from "./extraction";
import { needsPageFacts, pageFactsValidator } from "./lotFacts";
import type { PageFacts } from "./lotFacts";
import { lotShopUrl } from "./lotUrl";
import { ENRICHMENT_PROMPT, enrichmentSchema } from "./recommendationRules";

/** Anyone can open a lot page, so the spend is capped deployment-wide. */
export const PAGE_FACTS_PER_HOUR = 20;
/**
 * Variety, elevation and producer do not change between crawls, so a page
 * Firecrawl read within a day is good enough (a fresh scrape is slower and
 * fails more often; a cached one costs the same credit). No custom headers
 * here: they bypass the cache, and the facts do not depend on the market.
 */
export const PAGE_FACTS_MAX_AGE_MS = 24 * 60 * 60_000;

const limiter = new RateLimiter(components.rateLimiter, {
	pageFacts: { kind: "fixed window", period: HOUR, rate: PAGE_FACTS_PER_HOUR },
});
const firecrawl = new FirecrawlClient(components.firecrawl);

export const requestResultValidator = v.union(
	v.literal("started"),
	// The lot has its facts, or a read is in flight or inside the retry window.
	v.literal("known"),
	v.literal("limited"),
	// No such lot, or nothing to read (archived, no shop URL).
	v.literal("none")
);

/**
 * The lot page's ask. Idempotent under concurrent viewers: the first request
 * stamps `copyFetchedAt`, so the rest see "known" and wait on the same
 * reactive query. No identity needed: the page is public and the limiter is
 * the guard.
 */
export const request = mutation({
	args: { lotId: v.string() },
	handler: async (ctx, args) => {
		const productId = ctx.db.normalizeId("products", args.lotId);
		if (productId === null) {
			return "none";
		}
		const product = await ctx.db.get("products", productId);
		if (product === null || product.status !== "current") {
			return "none";
		}
		if (!needsPageFacts(product, Date.now())) {
			return "known";
		}
		const roaster = await ctx.db.get("roasters", product.roasterId);
		const url = roaster === null ? null : lotShopUrl(roaster, product);
		if (url === null) {
			return "none";
		}
		const quota = await limiter.limit(ctx, "pageFacts");
		if (!quota.ok) {
			return "limited";
		}
		await ctx.db.patch("products", productId, { copyFetchedAt: Date.now() });
		await ctx.scheduler.runAfter(0, internal.pageFacts.scrape, {
			productId,
			url,
		});
		return "started";
	},
	returns: requestResultValidator,
});

/**
 * One product page through Firecrawl's json extraction, verified. Shared by
 * the scheduled scrape and the recommendation worker so both write the same
 * thing. Throws when the page is unavailable; the caller decides what a
 * failure means for it.
 */
export const readPageFacts = async (
	ctx: ActionCtx,
	url: string
): Promise<{ facts: PageFacts; markdown: string; json: unknown }> => {
	const page = await firecrawl.scrape(ctx, url, {
		formats: [
			"markdown",
			{ prompt: ENRICHMENT_PROMPT, schema: enrichmentSchema, type: "json" },
		],
		maxAge: PAGE_FACTS_MAX_AGE_MS,
		onlyMainContent: true,
		timeout: 30_000,
	});
	const { metadata } = page;
	if (metadata?.statusCode !== 200 || metadata.sourceURL !== url) {
		throw new Error("Source page unavailable");
	}
	const markdown = page.markdown ?? "";
	return {
		facts: verifyPageFacts(page.json, markdown),
		json: page.json,
		markdown,
	};
};

export const scrape = internalAction({
	args: { productId: v.id("products"), url: v.string() },
	handler: async (ctx, args) => {
		let facts: PageFacts = {};
		try {
			({ facts } = await readPageFacts(ctx, args.url));
		} catch {
			// copyFetchedAt is already stamped; the lot is retried after the
			// window. Nothing is stored for a page that could not be read.
			return null;
		}
		await ctx.runMutation(internal.pageFacts.store, {
			facts,
			productId: args.productId,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Store what the page said. An empty read keeps the attempt stamp and no
 * `pageFacts`, so the lot is asked again after PAGE_FACTS_RETRY_MS; a read
 * with facts settles the lot. Never touches a feed column.
 */
export const store = internalMutation({
	args: { facts: pageFactsValidator, productId: v.id("products") },
	handler: async (ctx, args) => {
		const product = await ctx.db.get("products", args.productId);
		if (product === null) {
			return null;
		}
		const now = Date.now();
		await ctx.db.patch(
			"products",
			args.productId,
			Object.keys(args.facts).length === 0
				? { copyFetchedAt: now }
				: { copyFetchedAt: now, pageFacts: args.facts }
		);
		return null;
	},
	returns: v.null(),
});
