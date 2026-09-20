// Roaster slugs (ADR-0011): /roaster/$slug addresses one roaster. The slug
// comes from the shop's registrable domain at creation and never changes.
// The seed and the submission derive it here, and the submission claims
// uniqueness on the by_slug index, so no two roasters can share a slug and
// getBySlug's .unique() never throws again.

import type { MutationCtx } from "./_generated/server";
import { RESERVED_ROUTES } from "./constants";

/** Turn a registrable domain into a slug; the seed's and submission's one. */
export const slugifyDomain = (domain: string): string =>
	domain
		// the TLD off: eastpole.coffee -> eastpole
		.replace(/\.[^.]+$/u, "")
		.replaceAll(/[^a-z0-9]+/gu, "-")
		.replaceAll(/^-+|-+$/gu, "");

/** The reserved route names hold here too, for cleanliness (ADR-0011). */
export const isReservedSlug = (slug: string): boolean =>
	RESERVED_ROUTES.includes(slug);

/**
 * Claim a unique slug for a new roaster: the base when free, otherwise the
 * first free `base-2`, `base-3`, ... One range scan on the by_slug index
 * answers what is taken (the same shape as the user-handle claim).
 */
export const claimRoasterSlug = async (
	ctx: MutationCtx,
	base: string
): Promise<string> => {
	const nearby = await ctx.db
		.query("roasters")
		.withIndex("by_slug", (q) =>
			q.gte("slug", base).lt("slug", `${base}\uFFFF`)
		)
		.collect();
	const taken = new Set(nearby.map((roaster) => roaster.slug));
	if (!taken.has(base) && !isReservedSlug(base)) {
		return base;
	}
	const suffix = /-(?<num>\d+)$/u;
	const used = new Set(
		[...taken].flatMap((slug) => {
			const hit = suffix.exec(slug);
			return hit === null ? [] : [Math.trunc(Number(hit.groups?.num))];
		})
	);
	let n = 2;
	while (used.has(n)) {
		n += 1;
	}
	return `${base}-${n}`;
};
