// The public catalog search behind the find_available_lots site tool
// (.agents/research/webmcp-implementation-sketch.md): the same bounded,
// stock-checked candidate selection the next-bag loop runs, without a run
// document, quotas, or a model. Anyone may call it; the catalog is public
// and nothing here reads the caller.

import { v } from "convex/values";

import { query } from "./_generated/server";
import { rankCandidates, selectCandidates } from "./recommendationCatalog";
import { budgetFilters } from "./recommendationRules";

/** Rows handed back per search. The tool clips further for its own budget. */
export const FIND_AVAILABLE_LIMIT = 10;
/** Characters of the roaster's own copy per row. */
const SAYS_LIMIT = 240;
const PREFERENCES_LIMIT = 200;

const usableNumber = (value: number | undefined): number | undefined =>
	value !== undefined && Number.isSafeInteger(value) && value > 0
		? value
		: undefined;

export const foundLotValidator = v.object({
	// When the crawl last confirmed this size in stock at this price.
	confirmedAt: v.number(),
	grams: v.number(),
	handle: v.string(),
	name: v.string(),
	priceCents: v.number(),
	productId: v.id("products"),
	roasterName: v.string(),
	roasterSlug: v.string(),
	// The roaster's copy about the lot, quoted as data.
	says: v.string(),
	url: v.string(),
	variantName: v.string(),
});

/**
 * Lots in stock at US roasters crawled within the hour, under the budget
 * and bag-size constraints, ranked by the preference words. Bounded on
 * every side (roasters read, lots per roaster, lots inspected, rows kept):
 * an empty result means nothing in that selection matched, not that no
 * such coffee exists.
 */
export const findAvailable = query({
	args: {
		...budgetFilters.fields,
		preferences: v.string(),
	},
	handler: async (ctx, args) => {
		const preferences = args.preferences.trim().slice(0, PREFERENCES_LIMIT);
		const filters = {
			maxGrams: usableNumber(args.maxGrams),
			maxPriceCents: usableNumber(args.maxPriceCents),
			minGrams: usableNumber(args.minGrams),
			preferences,
		};
		const candidates = await selectCandidates(ctx, filters, Date.now());
		const ranked = rankCandidates(candidates, preferences);
		return {
			applied: {
				maxGrams: filters.maxGrams ?? null,
				maxPriceCents: filters.maxPriceCents ?? null,
				minGrams: filters.minGrams ?? null,
			},
			considered: candidates.length,
			lots: ranked.slice(0, FIND_AVAILABLE_LIMIT).map((candidate) => ({
				confirmedAt: candidate.confirmedAt,
				grams: candidate.grams,
				handle: candidate.handle ?? "",
				name: candidate.name,
				priceCents: candidate.priceCents,
				productId: candidate.productId,
				roasterName: candidate.roasterName,
				roasterSlug: candidate.roasterSlug ?? "",
				says: candidate.evidence
					.map((item) => item.passage)
					.join(" ")
					.slice(0, SAYS_LIMIT),
				url: candidate.url,
				variantName: candidate.variantName,
			})),
		};
	},
	returns: v.object({
		applied: v.object({
			maxGrams: v.union(v.number(), v.null()),
			maxPriceCents: v.union(v.number(), v.null()),
			minGrams: v.union(v.number(), v.null()),
		}),
		// Candidates that passed the stock and budget checks before ranking
		// and clipping, so a caller can tell a full page from a thin one.
		considered: v.number(),
		lots: v.array(foundLotValidator),
	}),
});
