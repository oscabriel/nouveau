// Roaster slugs (ADR-0011): /roaster/$slug addresses one roaster. The slug
// comes from the shop's registrable domain at creation and never changes.
// The seed and the submission derive it here, and the submission claims
// uniqueness on the by_slug index, so no two roasters can share a slug and
// getBySlug's .unique() never throws again.

import type { MutationCtx } from "./_generated/server";
import type { ReservedRoute } from "./constants";
import { RESERVED_ROUTES } from "./constants";
import {
	assertSuffixScanBounded,
	nextFreeSuffix,
	SUFFIX_SCAN_LIMIT,
	suffixRangeEnd,
} from "./suffix";

/** Turn a registrable domain into a slug; the seed's and submission's one. */
export const slugifyDomain = (domain: string): string =>
	domain
		// the TLD off: eastpole.coffee -> eastpole
		.replace(/\.[^.]+$/u, "")
		.replaceAll(/[^a-z0-9]+/gu, "-")
		.replaceAll(/^-+|-+$/gu, "");

/** The reserved route names hold here too, for cleanliness (ADR-0011). */
export const isReservedSlug = (slug: string): slug is ReservedRoute =>
	RESERVED_ROUTES.some((route) => route === slug);

/**
 * Claim a unique slug for a new roaster: the base when free, otherwise the
 * first free `base-2`, `base-3`, ... One bounded range scan on the by_slug
 * index over `base` and its `base-<n>` family answers what is taken (the
 * same shape as the user-handle claim).
 */
export const claimRoasterSlug = async (
	ctx: MutationCtx,
	base: string
): Promise<string> => {
	const nearby = await ctx.db
		.query("roasters")
		.withIndex("by_slug", (q) =>
			q.gte("slug", base).lt("slug", suffixRangeEnd(base))
		)
		.take(SUFFIX_SCAN_LIMIT);
	assertSuffixScanBounded(nearby, base);
	return nextFreeSuffix(
		base,
		nearby.map((roaster) => roaster.slug),
		isReservedSlug(base)
	);
};
