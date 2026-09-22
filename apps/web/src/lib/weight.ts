import { api } from "@nouveau/backend/convex/_generated/api";
import { DEFAULT_WEIGHT_UNIT } from "@nouveau/backend/convex/weightUnit";
import type { WeightUnit } from "@nouveau/backend/convex/weightUnit";
import { useQuery } from "convex/react";

import { formatGrams } from "@/lib/format";

/**
 * Bag weights in the user's display unit (owner, 2026-09-21). Grams are the
 * stored unit on every product; metric renders through formatGrams (340 g,
 * 2.27 kg). Imperial converts and snaps to the size the roaster almost
 * certainly meant: a 340 g bag is a 12 oz bag, a 2268 g bag is 5 lb, so the
 * label says that instead of "11.99 oz". A weight near no typical size
 * prints to one decimal (250 g is 8.8 oz).
 */
const GRAMS_PER_OUNCE = 28.349523125;
const OUNCES_PER_POUND = 16;

/** The bag sizes US roasters sell, in ounces. Pounds are multiples of 16. */
const TYPICAL_OUNCES = [
	2, 4, 5, 6, 8, 10, 12, 16, 18, 20, 24, 32, 40, 48, 64, 80,
] as const;

/** A converted weight this close to a typical size (as a fraction) snaps to it. */
const SNAP_TOLERANCE = 0.05;

const snapOunces = (ounces: number): number | null => {
	for (const typical of TYPICAL_OUNCES) {
		if (Math.abs(ounces - typical) / typical <= SNAP_TOLERANCE) {
			return typical;
		}
	}
	return null;
};

/** Whole pounds print as pounds; half pounds too (24 oz is 1.5 lb). */
const HALF_POUND = OUNCES_PER_POUND / 2;

const formatOunces = (ounces: number): string => {
	if (ounces >= OUNCES_PER_POUND && ounces % HALF_POUND === 0) {
		const pounds = ounces / OUNCES_PER_POUND;
		return `${pounds} lb`;
	}
	return `${Number.isInteger(ounces) ? ounces : ounces.toFixed(1)} oz`;
};

export const formatWeight = (
	grams: number | null,
	unit: WeightUnit
): string | null => {
	if (grams === null) {
		return null;
	}
	if (unit === "metric") {
		return formatGrams(grams);
	}
	const ounces = grams / GRAMS_PER_OUNCE;
	const snapped = snapOunces(ounces);
	return formatOunces(snapped ?? Math.round(ounces * 10) / 10);
};

/**
 * The signed-in user's display unit, metric until the user record arrives
 * or when signed out. Reads getCurrentUser, which the header already
 * subscribes to, so the extra mount costs no second query.
 */
export const useWeightUnit = (): WeightUnit => {
	const me = useQuery(api.users.getCurrentUser);
	return me?.weightUnit ?? DEFAULT_WEIGHT_UNIT;
};

/** formatWeight bound to the current user's unit. */
export const useFormatWeight = (): ((
	grams: number | null
) => string | null) => {
	const unit = useWeightUnit();
	return (grams) => formatWeight(grams, unit);
};
