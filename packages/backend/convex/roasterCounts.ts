// The /roasters directory's two per-roaster counters, stored on the roaster
// document so the directory never scans lots at read time.

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

/** "New" means the lot's first sighting is inside this window. */
export const NEW_LOT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Recompute the directory counters into the roaster doc: `lotCount`, the
 * roaster's current lots, and `newLotCount`, the current lots whose
 * firstSeenAt is inside the seven-day window. Callers pass the product docs
 * they already have in hand with each doc's post-crawl status, so no extra
 * scan is needed; finalizeCrawl owns that judgment.
 */
export const catalogCounters = (
	lots: Doc<"products">[],
	now: number
): { lotCount: number; newLotCount: number } => {
	const current = lots.filter((lot) => lot.status === "current");
	const horizon = now - NEW_LOT_WINDOW_MS;
	return {
		lotCount: current.length,
		newLotCount: current.filter((lot) => lot.firstSeenAt > horizon).length,
	};
};

/** Write the counters for one roaster, computed over `lots` at `now`. */
export const patchRoasterCounters = async (
	ctx: MutationCtx,
	lots: Doc<"products">[],
	roasterId: Id<"roasters">,
	now: number
): Promise<void> => {
	await ctx.db.patch(roasterId, catalogCounters(lots, now));
};
