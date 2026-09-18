// The lot-level stock boundary (ADR-0007). The variant rollup on the product
// (anyAvailable, refreshed per crawl) is the truth; a lot crawled before the
// rollup existed has none until its next crawl, and that gap is unknown
// stock, never sold out, everywhere it is rendered.

import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";

/** true: purchasable now. false: sold out or archived. null: rollup absent. */
export const lotAvailability = (
	lot: Pick<Doc<"products">, "anyAvailable" | "status">
): boolean | null => {
	if (lot.status !== "current") {
		return false;
	}
	return lot.anyAvailable ?? null;
};

export const lotAvailabilityValidator = v.union(v.boolean(), v.null());
