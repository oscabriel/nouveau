import type { Infer } from "convex/values";
import { v } from "convex/values";

/**
 * The two ways the site shows a bag's weight (owner, 2026-09-21). Grams are
 * the stored unit on every product; the user's choice only changes how the
 * number renders. Shared by the users schema, updateMe and the web's
 * formatter.
 */
export const WEIGHT_UNITS = ["metric", "imperial"] as const;

export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const weightUnitValidator = v.union(
	...WEIGHT_UNITS.map((unit) => v.literal(unit))
);

export type WeightUnitValue = Infer<typeof weightUnitValidator>;

/** The unit a row without a stored choice reads as. */
export const DEFAULT_WEIGHT_UNIT: WeightUnit = "metric";
