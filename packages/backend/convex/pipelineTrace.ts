// One page read's evidence and verdicts (ADR-0018): what Jev was asked,
// what it answered per field, note and sentence, what the cut made of it
// and whether the verifier kept it. The read builds the draft from the same
// answers it stores facts from, so the trace and the facts cannot disagree;
// the caller writes it (nerdStuff.recordTrace). Pure: validators and types
// only, no Convex imports beyond `v`, so schema.ts can import it.

import type { Infer } from "convex/values";
import { v } from "convex/values";

/** The option Jev would have picked second, with its probability. */
export const runnerUpValidator = v.object({
	option: v.string(),
	probability: v.number(),
});

/** One field's line pick: the line, its probability, the runner-up, the cut value, kept or not. */
export const tracePickValidator = v.object({
	/** The verified value the cut produced, when the verifier kept it. */
	cut: v.optional(v.string()),
	field: v.string(),
	kept: v.boolean(),
	/** The line Jev picked; absent when it picked the none hatch. */
	line: v.optional(v.string()),
	/** Jev's probability for what it picked, the hatch included. */
	probability: v.optional(v.number()),
	runnerUp: v.optional(runnerUpValidator),
});

/** One vocabulary Choice: the chosen option (not_stated included) and its distribution's top two. */
export const traceCanonicalValidator = v.object({
	choice: v.string(),
	field: v.string(),
	probability: v.optional(v.number()),
	runnerUp: v.optional(runnerUpValidator),
});

/** One note candidate's Noul and whether it was stored. */
export const traceNoteValidator = v.object({
	kept: v.boolean(),
	note: v.string(),
	probability: v.number(),
});

/** One description sentence's Noul and whether it was kept as evidence. */
export const traceSentenceValidator = v.object({
	kept: v.boolean(),
	probability: v.number(),
	sentence: v.string(),
});

export const traceOutcomeValidator = v.union(
	v.literal("read"),
	v.literal("deferred"),
	v.literal("failed"),
	v.literal("no_key")
);
export type TraceOutcome = Infer<typeof traceOutcomeValidator>;

export const traceSourceValidator = v.union(
	v.literal("firecrawl"),
	v.literal("plain")
);
export type TraceSource = Infer<typeof traceSourceValidator>;

/** Stage timings in ms; a stage that did not run is absent. */
export const traceStagesValidator = v.object({
	jev: v.optional(v.number()),
	page: v.optional(v.number()),
});

/**
 * The feed pass replayed on the stored product: what the regex path says
 * about the lot before any page is read. Pure functions over stored
 * fields, so it costs nothing and needs no crawl.
 */
export const traceFeedValidator = v.object({
	attributes: v.array(v.object({ field: v.string(), value: v.string() })),
	isLot: v.boolean(),
	notes: v.optional(v.string()),
	rule: v.string(),
});

/** The gate's recorded shadow answer for the lot, when one exists (rejected items only). */
export const traceGateValidator = v.object({
	agreed: v.boolean(),
	coffeeProbability: v.number(),
	jevChoice: v.string(),
});

/**
 * What the read itself produces, before the caller adds ids, outcome and
 * the feed and gate stages. Everything here comes out of one
 * `readPageFacts`.
 */
export const traceDraftValidator = v.object({
	canonical: v.array(traceCanonicalValidator),
	model: v.optional(v.string()),
	notes: v.array(traceNoteValidator),
	/** Lines offered on each field Choice, the hatch included. */
	optionCount: v.optional(v.number()),
	pageChars: v.optional(v.number()),
	picks: v.array(tracePickValidator),
	questionCount: v.optional(v.number()),
	sentences: v.array(traceSentenceValidator),
	source: v.optional(traceSourceValidator),
	stages: traceStagesValidator,
});
export type TraceDraft = Infer<typeof traceDraftValidator>;

/** A draft with nothing in it: the shape a failed or deferred read records. */
export const emptyTraceDraft = (): TraceDraft => ({
	canonical: [],
	notes: [],
	picks: [],
	sentences: [],
	stages: {},
});

/** Note candidates one trace keeps; past this, the top by probability. */
export const MAX_TRACE_NOTES = 60;

/** Why the read ended the way it did, from readPageFacts's point of view. */
export const jevStatusValidator = v.union(
	/** Jev answered; the picks are its. */
	v.literal("answered"),
	/** No TYPESAFE_API_KEY on the deployment: the page was read, nothing was asked. */
	v.literal("no_key"),
	/** Jev did not answer (unreachable, a non-2xx, or an unexpected body). */
	v.literal("unreachable")
);
export type JevStatus = Infer<typeof jevStatusValidator>;

/** The trace row less the system fields: what recordTrace takes and the table stores. */
export const traceFields = {
	...traceDraftValidator.fields,
	deferrals: v.optional(v.number()),
	error: v.optional(v.string()),
	feed: v.optional(traceFeedValidator),
	finishedAt: v.optional(v.number()),
	gate: v.optional(traceGateValidator),
	name: v.string(),
	outcome: traceOutcomeValidator,
	productId: v.id("products"),
	roasterId: v.id("roasters"),
	/** Set when a /nerd-stuff run asked for the read. */
	runId: v.optional(v.id("pipelineRuns")),
	startedAt: v.number(),
	url: v.string(),
};

export const runStatusValidator = v.union(
	v.literal("queued"),
	v.literal("running"),
	v.literal("done"),
	v.literal("stopped"),
	v.literal("failed")
);
export type RunStatus = Infer<typeof runStatusValidator>;

/** The six cells of the workbench's stage track, in order. */
export const runStageValidator = v.union(
	v.literal("feed"),
	v.literal("gate"),
	v.literal("page"),
	v.literal("jev"),
	v.literal("cut"),
	v.literal("store")
);
export type RunStage = Infer<typeof runStageValidator>;

/** Lots one workbench run reads: a run takes at most this much of the Firecrawl minute. */
export const MAX_RUN_LOTS = 10;

/**
 * A workbench run (ADR-0018): a bounded sequence of traced reads a signed-in
 * person started from /nerd-stuff, through the same Firecrawl budget as the
 * sweep. The lot list is fixed at start, so `index` names the lot in flight.
 */
export const runFields = {
	/**
	 * Gone (owner, 2026-09-21): every run stores its facts now. Optional so
	 * the rows from before validate until the weekly prune removes them;
	 * drop the field after that.
	 */
	commit: v.optional(v.boolean()),
	createdAt: v.number(),
	currentProductId: v.optional(v.id("products")),
	currentStage: v.optional(runStageValidator),
	/** Lots given up after MAX_READ_DEFERRALS waits; with `read` and `failed`, every lot counts once. */
	deferred: v.number(),
	/** The watchdog that fails a run still going at RUN_TIMEOUT_MS. */
	expireId: v.optional(v.id("_scheduled_functions")),
	failed: v.number(),
	/** 0-based position of the lot in flight; equals `total` when done. */
	index: v.number(),
	jevMs: v.number(),
	jevQuestions: v.number(),
	jevRequests: v.number(),
	message: v.optional(v.string()),
	pageMs: v.number(),
	/** The lots picked at start, in read order; at most MAX_RUN_LOTS. */
	productIds: v.array(v.id("products")),
	read: v.number(),
	roasterId: v.id("roasters"),
	stageStartedAt: v.optional(v.number()),
	status: runStatusValidator,
	total: v.number(),
	updatedAt: v.number(),
	userId: v.id("users"),
};
