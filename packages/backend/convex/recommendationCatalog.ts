import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { factPassage, mergedFacts, needsPageFacts } from "./lotFacts";
import { lotShopUrl } from "./lotUrl";
import {
	CANDIDATE_LIMIT,
	CATALOG_SCAN_LIMIT,
	catalogPassages,
	EVIDENCE_TTL_MS,
	FRESHNESS_MS,
	MAX_VARIANTS_PER_PRODUCT,
	preferenceScore,
	preferenceTokens,
	PRODUCTS_PER_ROASTER,
	SOURCE_SCAN_LIMIT,
} from "./recommendationRules";
import type { Candidate, RecommendationInput } from "./recommendationRules";

const meetsConstraints = (
	variant: Doc<"productVariants">,
	input: RecommendationInput
): boolean =>
	variant.grams !== undefined &&
	Number.isFinite(variant.grams) &&
	variant.grams > 0 &&
	Number.isSafeInteger(variant.priceCents) &&
	variant.priceCents > 0 &&
	(input.maxPriceCents === undefined ||
		variant.priceCents <= input.maxPriceCents) &&
	(input.minGrams === undefined || variant.grams >= input.minGrams);

/**
 * When the source last read every product. A product_pages crawl whose
 * collection page was unchanged succeeds without reading a lot, so its
 * catalog, market and variants still carry the stamp of the last full read;
 * that read is what the freshness of `lastSuccessAt` vouches for.
 */
export const observedAt = (source: Doc<"crawlSources">): number | undefined =>
	source.lastFullCrawlAt ?? source.lastSuccessAt;

/**
 * A completed crawl within the hour whose shop was confirmed US/USD. Any
 * source mode qualifies: the Shopify path confirms the market from the
 * storefront globals, the others from the currency every price reported.
 */
export const eligibleSource = (
	source: Doc<"crawlSources">,
	now: number
): source is Doc<"crawlSources"> & { lastSuccessAt: number } =>
	source.health === "watching" &&
	source.lastSuccessAt !== undefined &&
	source.lastSuccessAt <= now &&
	now - source.lastSuccessAt <= FRESHNESS_MS &&
	source.market?.country === "US" &&
	source.market.currency === "USD" &&
	source.market.confirmedAt === observedAt(source);

/** That same full read must have observed this exact variant with its size. */
export const eligibleVariant = (
	product: Doc<"products">,
	variant: Doc<"productVariants">,
	source: Doc<"crawlSources">,
	input: RecommendationInput,
	now: number
): boolean =>
	eligibleSource(source, now) &&
	observedAt(source) === product.lastSeenAt &&
	product.status === "current" &&
	variant.productId === product._id &&
	variant.observedAt === product.lastSeenAt &&
	variant.sizeObservedAt === product.lastSeenAt &&
	variant.available &&
	meetsConstraints(variant, input);

/**
 * Everything the feed already says about a lot. Page evidence is deduplicated
 * against this whole text, not only the passages sent to the model.
 */
export const catalogText = (product: Doc<"products">): string =>
	[
		product.name,
		product.description,
		factPassage(mergedFacts(product)),
		...(product.tags ?? []),
	]
		.filter(Boolean)
		.join("\n")
		.slice(0, 4000);

const makeCandidate = async (
	ctx: QueryCtx,
	product: Doc<"products">,
	roaster: Doc<"roasters">,
	source: Doc<"crawlSources">,
	input: RecommendationInput,
	now: number
): Promise<Candidate | null> => {
	const url = lotShopUrl(roaster, product);
	if (!url) {
		return null;
	}
	const [variants, cached] = await Promise.all([
		ctx.db
			.query("productVariants")
			.withIndex("by_product_id", (q) => q.eq("productId", product._id))
			.take(MAX_VARIANTS_PER_PRODUCT + 1),
		ctx.db
			.query("recommendationEvidence")
			.withIndex("by_product_id", (q) => q.eq("productId", product._id))
			.unique(),
	]);
	if (variants.length > MAX_VARIANTS_PER_PRODUCT) {
		return null;
	}
	const [variant] = variants
		.filter((item) => eligibleVariant(product, item, source, input, now))
		// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; filter created a new array
		.sort((a, b) => a.priceCents - b.priceCents);
	if (!variant || variant.grams === undefined) {
		return null;
	}
	// The lot's facts (feed columns, page facts filling gaps) lead as one
	// labelled passage; description sentences follow.
	const facts = factPassage(mergedFacts(product));
	const passage = (product.description ?? "").slice(0, 2500);
	const evidence: Candidate["evidence"] = [
		...(facts === null ? [] : [facts]),
		...catalogPassages(passage),
	].map((text, index) => ({
		id: `${product._id}:catalog:${index}`,
		observedAt: product.lastSeenAt,
		passage: text,
		source: "catalog",
		url,
	}));
	if (
		cached &&
		cached.url === url &&
		cached.observedAt <= now &&
		now - cached.observedAt < EVIDENCE_TTL_MS
	) {
		for (const [index, text] of cached.passages.entries()) {
			evidence.push({
				id: `${product._id}:page:${index}`,
				observedAt: cached.observedAt,
				passage: text,
				source: "firecrawl",
				url,
			});
		}
	}
	return {
		confirmedAt: product.lastSeenAt,
		currency: "USD",
		evidence,
		factsKnown: !needsPageFacts(product, now),
		grams: variant.grams,
		handle: product.handle,
		market: "US",
		name: product.name,
		priceCents: variant.priceCents,
		productId: product._id,
		roasterName: roaster.name,
		roasterSlug: roaster.slug,
		url,
		variantId: variant._id,
		variantName: variant.name,
	};
};

interface RoasterQueue {
	products: Doc<"products">[];
	roaster: Doc<"roasters">;
	source: Doc<"crawlSources">;
}

const productHaystack = (product: Doc<"products">): string =>
	[
		product.name,
		factPassage(mergedFacts(product)),
		product.description,
		...(product.tags ?? []),
	]
		.filter(Boolean)
		.join(" ");

/** One roaster's current lots from its latest crawl, best preference match first. */
const roasterQueue = async (
	ctx: QueryCtx,
	source: Doc<"crawlSources"> & { lastSuccessAt: number },
	tokens: string[]
): Promise<RoasterQueue | null> => {
	const roaster = await ctx.db.get(source.roasterId);
	if (!roaster || roaster.status !== "active") {
		return null;
	}
	const products = await ctx.db
		.query("products")
		.withIndex("by_roaster_and_status_and_last_seen_at", (q) =>
			q
				.eq("roasterId", source.roasterId)
				.eq("status", "current")
				.eq("lastSeenAt", source.lastSuccessAt)
		)
		.take(PRODUCTS_PER_ROASTER);
	if (products.length === 0) {
		return null;
	}
	const scored = products.map((product) => ({
		product,
		score: preferenceScore(productHaystack(product), tokens),
	}));
	// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; map created a new array
	scored.sort((a, b) => b.score - a.score);
	return { products: scored.map((item) => item.product), roaster, source };
};

/**
 * Round-robin across eligible roasters so a large catalog crawled a minute
 * ago cannot fill the whole pool. Bounded by sources read, lots per roaster,
 * lots inspected in total, and candidates kept.
 */
export const selectCandidates = async (
	ctx: QueryCtx,
	input: RecommendationInput,
	now: number
): Promise<Candidate[]> => {
	const sources = await ctx.db
		.query("crawlSources")
		.withIndex("by_health", (q) => q.eq("health", "watching"))
		.take(SOURCE_SCAN_LIMIT);
	const tokens = preferenceTokens(input.preferences);
	const maybeQueues = await Promise.all(
		sources
			.filter((source) => eligibleSource(source, now))
			.map((source) => roasterQueue(ctx, source, tokens))
	);
	const queues = maybeQueues.filter((queue) => queue !== null);

	const candidates: Candidate[] = [];
	let inspected = 0;
	let anyLeft = queues.length > 0;
	while (anyLeft && candidates.length < CANDIDATE_LIMIT) {
		anyLeft = false;
		for (const queue of queues) {
			const product = queue.products.shift();
			if (!product) {
				continue;
			}
			anyLeft ||= queue.products.length > 0;
			inspected += 1;
			// oxlint-disable-next-line no-await-in-loop -- bounded by CATALOG_SCAN_LIMIT; stop as soon as the pool is full
			const candidate = await makeCandidate(
				ctx,
				product,
				queue.roaster,
				queue.source,
				input,
				now
			);
			if (candidate) {
				candidates.push(candidate);
			}
			if (
				candidates.length === CANDIDATE_LIMIT ||
				inspected === CATALOG_SCAN_LIMIT
			) {
				return candidates;
			}
		}
	}
	return candidates;
};

/** Recheck the same size, not a cheaper substitute, before exposing a shop link. */
export const candidateStillAvailable = async (
	ctx: QueryCtx,
	candidate: Candidate,
	input: RecommendationInput,
	now: number
): Promise<boolean> => {
	const [product, variant] = await Promise.all([
		ctx.db.get(candidate.productId),
		ctx.db.get(candidate.variantId),
	]);
	if (!product || !variant) {
		return false;
	}
	const [source, roaster] = await Promise.all([
		ctx.db
			.query("crawlSources")
			.withIndex("by_roaster_id", (q) => q.eq("roasterId", product.roasterId))
			.unique(),
		ctx.db.get(product.roasterId),
	]);
	return (
		!!source &&
		!!roaster &&
		roaster.status === "active" &&
		lotShopUrl(roaster, product) === candidate.url &&
		eligibleVariant(product, variant, source, input, now) &&
		variant.priceCents === candidate.priceCents &&
		variant.grams === candidate.grams
	);
};
