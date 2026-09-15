import type { Id } from "@nouveau/backend/convex/_generated/dataModel";

// Prefilled so a 2 oz sample cannot win as the cheapest qualifying variant
// by default (#22). Editable; cleared means any confirmed size.
export const DEFAULT_MIN_GRAMS = 200;

export interface RecommendationFormValues {
	// Raw input strings; "" means the field was cleared.
	budget: string;
	grams: string;
	includeNotes: boolean;
	logIds: Id<"logs">[];
	preferences: string;
}

export interface RecommendationRequestInput {
	includeNotes: boolean;
	logIds: Id<"logs">[];
	maxPriceCents?: number;
	minGrams?: number;
	preferences: string;
}

/** Form strings to the request payload. Empty optional fields are omitted. */
export const buildRecommendationInput = (
	values: RecommendationFormValues
): RecommendationRequestInput => ({
	includeNotes: values.includeNotes,
	logIds: values.logIds,
	preferences: values.preferences.trim(),
	...(values.budget === ""
		? {}
		: { maxPriceCents: Math.round(Number(values.budget) * 100) }),
	...(values.grams === "" ? {} : { minGrams: Number(values.grams) }),
});
