// Jev shadow check for the lot classifier's ambiguous tail (§16). A
// `default` verdict is not a decision: the feed paths (ADR-0001 /products.json,
// ADR-0006 WooCommerce) reject the item while the page path accepts it, so an
// untyped shop's tail is decided by a guess that points in opposite
// directions by mode. Every crawl now also asks Jev (TypeSafe's System One
// decision model) whether the item is a lot and records the answer without
// acting on it. Shadow mode only: nothing here feeds back into
// classification until the agreement numbers say so.
//
// Page-mode shops are not shadowed yet: their `default` items become lots
// (untyped-shop rule), so their interesting tail is the accepted side, which
// needs its own question.
//
// The request, the pin and the failure posture live in jev.ts.

import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
	env,
	internalAction,
	internalMutation,
	internalQuery,
} from "./_generated/server";
import type { ShadowCandidate } from "./extraction";
import { askJev } from "./jev";

/** One Jev request per candidate, so a huge ambiguous tail is bounded. */
export const CANDIDATES_PER_CRAWL = 25;
/** The only options the question offers; anything else is a protocol error. */
const CHOICES = ["coffee", "not_coffee"] as const;

/**
 * One ambiguous-tail item as it travels from the feed parser to Jev: the
 * externalId the crawl knows the item by, plus the item's own words.
 */
export const shadowCandidateValidator = v.object({
	description: v.optional(v.string()),
	externalId: v.string(),
	productType: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	title: v.string(),
});

/**
 * The §16 lot line as one Choice question. Criteria carry the boundary cases
 * (Jev reads instructions literally); the options are fixed so the answer
 * maps onto code. Keyed by question id, as the /v1/systemone body wants.
 */
export const isLotQuestion = (): {
	is_lot: {
		criteria: Record<string, string>;
		instructions: string;
		type: "choice";
	};
} => ({
	is_lot: {
		criteria: {
			coffee:
				"One specific roasted coffee sold in a bag (any bag size, whole bean, ground, instant, or steeped bags).",
			not_coffee:
				"Anything else a shop sells: brewing equipment, merch, tea or other consumables, gift cards, subscriptions, bundles or samplers with several coffees, capsules or pods, canned or ready-to-drink coffee.",
		},
		instructions:
			"Is `item` one roasted coffee that a customer buys as a bag (any bag size, whole bean or ground)?",
		type: "choice",
	},
});

/** A Jev Choice answer for `is_lot`, narrowed from the raw response. */
export interface JevVerdict {
	confidence?: number;
	coffeeProbability: number;
	jevChoice: string;
	model: string;
}

/**
 * Narrow the /v1/systemone answers map to the `is_lot` Choice answer.
 * Everything is treated as unknown and checked: a field of the wrong shape
 * makes the whole answer null, never a default.
 */
export const parseJevAnswer = (
	answers: unknown,
	model: string
): JevVerdict | null => {
	if (typeof answers !== "object" || answers === null) {
		return null;
	}
	const isLot = (answers as Record<string, unknown>).is_lot;
	if (typeof isLot !== "object" || isLot === null) {
		return null;
	}
	const fields = isLot as Record<string, unknown>;
	const { choice } = fields;
	if (
		typeof choice !== "string" ||
		!(CHOICES as readonly string[]).includes(choice) ||
		typeof fields.probabilities !== "object" ||
		fields.probabilities === null
	) {
		return null;
	}
	const coffeeProbability = (fields.probabilities as Record<string, unknown>)
		.coffee;
	if (typeof coffeeProbability !== "number") {
		return null;
	}
	return {
		...(typeof fields.confidence === "number"
			? { confidence: fields.confidence }
			: {}),
		coffeeProbability,
		jevChoice: choice,
		model,
	};
};

/**
 * One item through Jev: state is the item's own words (title, tags, type,
 * a description excerpt), the question is the §16 lot definition as a Choice.
 * Null when the API is unreachable or answers something unexpected: a shadow
 * verdict is never worth breaking a crawl over, and a parse failure is logged
 * rather than retried (the next crawl brings the same item back).
 */
export const judge = async (
	apiKey: string,
	candidate: ShadowCandidate
): Promise<JevVerdict | null> => {
	const item: Record<string, unknown> = { title: candidate.title };
	if (candidate.productType !== undefined) {
		item.productType = candidate.productType;
	}
	if (candidate.tags !== undefined) {
		item.tags = candidate.tags;
	}
	if (candidate.description !== undefined) {
		item.description = candidate.description;
	}
	const answer = await askJev(
		apiKey,
		`shadow ${candidate.externalId}`,
		{ item },
		isLotQuestion()
	);
	return answer === null ? null : parseJevAnswer(answer.answers, answer.model);
};

/** ExternalIds of this roaster's candidates that already have a verdict. */
export const decidedExternalIds = internalQuery({
	args: { externalIds: v.array(v.string()), roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const decided: string[] = [];
		for (const externalId of args.externalIds) {
			// One indexed lookup per candidate; a shared scan would read past
			// this roaster's rows.
			// eslint-disable-next-line no-await-in-loop
			const existing = await ctx.db
				.query("lotClassifierShadow")
				.withIndex("by_roaster_and_external_id", (q) =>
					q.eq("roasterId", args.roasterId).eq("externalId", externalId)
				)
				.first();
			if (existing !== null) {
				decided.push(existing.externalId);
			}
		}
		return decided;
	},
	returns: v.array(v.string()),
});

/**
 * Ask Jev about this crawl's ambiguous tail. A no-op without
 * TYPESAFE_API_KEY, so the shadow costs nothing until the key is set. Skips
 * items already judged: the same tail reappears on every crawl and only the
 * first opinion counts, which also keeps the table at one row per ambiguous
 * item.
 */
export const evaluate = internalAction({
	args: {
		candidates: v.array(shadowCandidateValidator),
		roasterId: v.id("roasters"),
	},
	handler: async (ctx, args) => {
		const apiKey = env.TYPESAFE_API_KEY;
		if (apiKey === undefined || apiKey === "") {
			return null;
		}
		const decided = await ctx.runQuery(
			internal.lotClassifierShadow.decidedExternalIds,
			{
				externalIds: args.candidates.map((candidate) => candidate.externalId),
				roasterId: args.roasterId,
			}
		);
		const known = new Set(decided);
		const candidates = args.candidates
			.slice(0, CANDIDATES_PER_CRAWL)
			.filter((candidate) => !known.has(candidate.externalId));
		const verdicts: (JevVerdict & ShadowCandidate)[] = [];
		for (const candidate of candidates) {
			// Sequential on purpose: the shadow rides along with a crawl and
			// must not race the API's per-minute limit.
			// eslint-disable-next-line no-await-in-loop
			const verdict = await judge(apiKey, candidate);
			if (verdict !== null) {
				verdicts.push({ ...verdict, ...candidate });
			}
		}
		if (verdicts.length > 0) {
			await ctx.runMutation(internal.lotClassifierShadow.store, {
				roasterId: args.roasterId,
				verdicts,
			});
		}
		return null;
	},
});

/**
 * One stored verdict as it arrives from the action. The regex verdict on
 * every candidate is {isLot: false, rule: "default"} by construction, so
 * `agreed` is computed at the store boundary (Jev also read the item as a
 * non-lot) rather than shipped through the args.
 */
const verdictArgs = v.object({
	coffeeProbability: v.number(),
	confidence: v.optional(v.number()),
	description: v.optional(v.string()),
	externalId: v.string(),
	jevChoice: v.string(),
	model: v.string(),
	productType: v.optional(v.string()),
	tags: v.optional(v.array(v.string())),
	title: v.string(),
});

export const store = internalMutation({
	args: {
		roasterId: v.id("roasters"),
		verdicts: v.array(verdictArgs),
	},
	handler: async (ctx, args) => {
		for (const verdict of args.verdicts) {
			// The unique check and its insert stay in the same pass: two
			// verdicts for one externalId must not both insert.
			// eslint-disable-next-line no-await-in-loop
			const existing = await ctx.db
				.query("lotClassifierShadow")
				.withIndex("by_roaster_and_external_id", (q) =>
					q.eq("roasterId", args.roasterId).eq("externalId", verdict.externalId)
				)
				.first();
			if (existing !== null) {
				continue;
			}
			// eslint-disable-next-line no-await-in-loop
			await ctx.db.insert("lotClassifierShadow", {
				...(verdict.confidence === undefined
					? {}
					: { confidence: verdict.confidence }),
				coffeeProbability: verdict.coffeeProbability,
				externalId: verdict.externalId,
				jevChoice: verdict.jevChoice,
				model: verdict.model,
				...(verdict.productType === undefined
					? {}
					: { productType: verdict.productType }),
				agreed: verdict.jevChoice !== "coffee",
				roasterId: args.roasterId,
				...(verdict.tags === undefined ? {} : { tags: verdict.tags }),
				title: verdict.title,
			});
		}
		return null;
	},
});

/**
 * Agreement tally over the newest verdicts, for deciding when the shadow
 * graduates: how often Jev agreed with the regex's `default` rejection, how
 * often it saw a lot the regex rejected, and the disagreement titles to read
 * by hand. Read with `npx convex run lotClassifierShadow:agreement`.
 */
export const agreement = internalQuery({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db
			.query("lotClassifierShadow")
			.order("desc")
			.take(500);
		return {
			agreed: rows.filter((row) => row.agreed).length,
			coffee: rows.filter((row) => row.jevChoice === "coffee").length,
			disagreements: rows
				.filter((row) => !row.agreed)
				.slice(0, 20)
				.map((row) => ({
					coffeeProbability: row.coffeeProbability,
					title: row.title,
				})),
			sampled: rows.length,
		};
	},
	returns: v.object({
		agreed: v.number(),
		coffee: v.number(),
		disagreements: v.array(
			v.object({
				coffeeProbability: v.number(),
				title: v.string(),
			})
		),
		sampled: v.number(),
	}),
});
