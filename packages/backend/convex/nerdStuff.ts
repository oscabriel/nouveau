// The /nerd-stuff workbench (ADR-0018): a viewer over the traces every
// page read writes, plus a bounded run loop that reads up to MAX_RUN_LOTS
// of one roaster's lots through the same Firecrawl budget as the sweep and
// records a trace per lot. A run writes no facts unless asked (`commit`).
// Anyone can view; starting needs sign-in and passes two limiters.

import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
	classifyLot,
	extractRoasterNotes,
	parseLotAttributes,
} from "./extraction";
import { requireUserId } from "./identity";
import { hasMissingPageFacts } from "./lotFacts";
import { lotShopUrl } from "./lotUrl";
import {
	errorText,
	MAX_READ_DEFERRALS,
	PAGE_SWEEP_SPACING_MS,
	ReadDeferredError,
	readOutcome,
	readPageFacts,
	storeArgs,
} from "./pageFacts";
import {
	emptyTraceDraft,
	MAX_RUN_LOTS,
	runStageValidator,
	traceFields,
} from "./pipelineTrace";
import type {
	RunStage,
	traceFeedValidator,
	traceGateValidator,
} from "./pipelineTrace";
import schema from "./schema";

/** Runs anyone may start in an hour, deployment-wide: each takes a Firecrawl minute. */
export const RUNS_PER_HOUR = 4;
/** Runs one person may start in an hour. */
export const RUNS_PER_USER_PER_HOUR = 2;
/** A run still going past this is failed by its watchdog. */
export const RUN_TIMEOUT_MS = 15 * 60_000;
/** Traces live this long; the tail is a window, not a log. */
export const TRACE_RETENTION_MS = 3 * 24 * HOUR;
/** Runs live this long. */
export const RUN_RETENTION_MS = 7 * 24 * HOUR;
/** Rows one prune pass deletes before scheduling the next. */
const PRUNE_BATCH = 200;
/** Current lots the picker looks at before choosing MAX_RUN_LOTS. */
const PICK_SCAN_LIMIT = 200;
/** The live tail shows at most this many traces. */
const RECENT_TRACES_CAP = 50;

const limiter = new RateLimiter(components.rateLimiter, {
	nerdStuffGlobal: { kind: "fixed window", period: HOUR, rate: RUNS_PER_HOUR },
	nerdStuffUser: {
		kind: "fixed window",
		period: HOUR,
		rate: RUNS_PER_USER_PER_HOUR,
	},
});

const runDoc = schema.doc("pipelineRuns");
const traceDoc = schema.doc("pipelineTraces");
const nullableRun = v.union(runDoc, v.null());

/** A settled run no longer needs its watchdog. */
const cancelWatchdog = async (
	ctx: MutationCtx,
	run: Doc<"pipelineRuns">
): Promise<void> => {
	if (run.expireId === undefined) {
		return;
	}
	const scheduled = await ctx.db.system.get(run.expireId);
	if (scheduled?.state.kind === "pending") {
		await ctx.scheduler.cancel(run.expireId);
	}
};

const newestFirst = (a: Doc<"products">, b: Doc<"products">): number =>
	b.firstSeenAt - a.firstSeenAt;

/**
 * The lots one run reads: the roaster's current lots with a shop URL,
 * those still missing a page fact first, then the newest. Returns them in
 * read order, at most MAX_RUN_LOTS.
 */
export const pickLots = (
	roaster: Pick<Doc<"roasters">, "websiteUrl">,
	lots: readonly Doc<"products">[]
): Id<"products">[] => {
	const readable = lots.filter((lot) => lotShopUrl(roaster, lot) !== null);
	const missing = readable.filter((lot) => hasMissingPageFacts(lot));
	const complete = readable.filter((lot) => !hasMissingPageFacts(lot));
	// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; missing and complete are this function's own arrays
	missing.sort(newestFirst);
	// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; see above
	complete.sort(newestFirst);
	return [...missing, ...complete].slice(0, MAX_RUN_LOTS).map((lot) => lot._id);
};

/**
 * Start a run over one roaster. Signed in, two limiters (one per person,
 * one for the deployment), and one run at a time: a run takes the whole
 * Firecrawl minute, and two would only defer each other.
 */
export const start = mutation({
	args: { commit: v.optional(v.boolean()), roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const active = await Promise.all(
			(["queued", "running"] as const).map((status) =>
				ctx.db
					.query("pipelineRuns")
					.withIndex("by_status", (q) => q.eq("status", status))
					.first()
			)
		);
		if (active.some((run) => run !== null)) {
			throw new ConvexError("A run is already going. Wait for it to finish.");
		}
		const roaster = await ctx.db.get("roasters", args.roasterId);
		if (roaster === null) {
			throw new ConvexError("No such roaster.");
		}
		const lots = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_status_and_last_seen_at", (q) =>
				q.eq("roasterId", args.roasterId).eq("status", "current")
			)
			.order("desc")
			.take(PICK_SCAN_LIMIT);
		const productIds = pickLots(roaster, lots);
		if (productIds.length === 0) {
			throw new ConvexError("This roaster has no current lot with a page.");
		}
		await limiter.limit(ctx, "nerdStuffUser", { key: userId, throws: true });
		await limiter.limit(ctx, "nerdStuffGlobal", { throws: true });
		const now = Date.now();
		const runId = await ctx.db.insert("pipelineRuns", {
			commit: args.commit ?? false,
			createdAt: now,
			deferred: 0,
			failed: 0,
			index: 0,
			jevMs: 0,
			jevQuestions: 0,
			jevRequests: 0,
			pageMs: 0,
			productIds,
			read: 0,
			roasterId: args.roasterId,
			status: "running",
			total: productIds.length,
			updatedAt: now,
			userId,
		});
		await ctx.scheduler.runAfter(0, internal.nerdStuff.runLot, {
			index: 0,
			runId,
		});
		const expireId = await ctx.scheduler.runAfter(
			RUN_TIMEOUT_MS,
			internal.nerdStuff.expire,
			{ runId }
		);
		await ctx.db.patch("pipelineRuns", runId, { expireId });
		return runId;
	},
	returns: v.id("pipelineRuns"),
});

/** Stop a run. Its owner only; the loop exits before the next lot. */
export const stop = mutation({
	args: { runId: v.id("pipelineRuns") },
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const run = await ctx.db.get("pipelineRuns", args.runId);
		if (run === null || run.userId !== userId) {
			throw new ConvexError("Not your run.");
		}
		if (run.status !== "queued" && run.status !== "running") {
			return null;
		}
		await ctx.db.patch("pipelineRuns", args.runId, {
			currentStage: undefined,
			message: "stopped",
			status: "stopped",
			updatedAt: Date.now(),
		});
		await cancelWatchdog(ctx, run);
		return null;
	},
	returns: v.null(),
});

/** The watchdog: a run still going at RUN_TIMEOUT_MS has failed. */
export const expire = internalMutation({
	args: { runId: v.id("pipelineRuns") },
	handler: async (ctx, args) => {
		const run = await ctx.db.get("pipelineRuns", args.runId);
		if (run === null || (run.status !== "queued" && run.status !== "running")) {
			return null;
		}
		await ctx.db.patch("pipelineRuns", args.runId, {
			currentStage: undefined,
			message: "timed out",
			status: "failed",
			updatedAt: Date.now(),
		});
		return null;
	},
	returns: v.null(),
});

/** What runLot needs for one lot, in one call: the run, the lot, its roaster, the shadow row. */
export const lotContext = internalQuery({
	args: { index: v.number(), runId: v.id("pipelineRuns") },
	handler: async (ctx, args) => {
		const run = await ctx.db.get("pipelineRuns", args.runId);
		if (run === null || run.status !== "running" || run.index !== args.index) {
			return null;
		}
		const productId = run.productIds[args.index];
		const product =
			productId === undefined ? null : await ctx.db.get("products", productId);
		const roaster = await ctx.db.get("roasters", run.roasterId);
		const shadow =
			product === null
				? null
				: await ctx.db
						.query("lotClassifierShadow")
						.withIndex("by_roaster_and_external_id", (q) =>
							q
								.eq("roasterId", run.roasterId)
								.eq("externalId", product.externalId)
						)
						.unique();
		return { product, roaster, run, shadow };
	},
	returns: v.union(
		v.object({
			product: v.union(schema.doc("products"), v.null()),
			roaster: v.union(schema.doc("roasters"), v.null()),
			run: runDoc,
			shadow: v.union(schema.doc("lotClassifierShadow"), v.null()),
		}),
		v.null()
	),
});

/** The stage in flight, for the stage track. A no-op once the run has left `index`. */
export const setStage = internalMutation({
	args: {
		index: v.number(),
		message: v.optional(v.string()),
		runId: v.id("pipelineRuns"),
		stage: runStageValidator,
	},
	handler: async (ctx, args) => {
		const run = await ctx.db.get("pipelineRuns", args.runId);
		if (run === null || run.status !== "running" || run.index !== args.index) {
			return null;
		}
		const now = Date.now();
		await ctx.db.patch("pipelineRuns", args.runId, {
			currentProductId: run.productIds[args.index],
			currentStage: args.stage,
			message: args.message,
			stageStartedAt: now,
			updatedAt: now,
		});
		return null;
	},
	returns: v.null(),
});

/** One deferral more on the run's count. */
export const noteDeferral = internalMutation({
	args: { index: v.number(), runId: v.id("pipelineRuns") },
	handler: async (ctx, args) => {
		const run = await ctx.db.get("pipelineRuns", args.runId);
		if (run === null || run.status !== "running" || run.index !== args.index) {
			return null;
		}
		await ctx.db.patch("pipelineRuns", args.runId, {
			currentStage: "page",
			deferred: run.deferred + 1,
			message: "waiting for the Firecrawl budget",
			updatedAt: Date.now(),
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Record one read's trace. Every scheduled read calls this at its end
 * (pageFacts.scrape), so the roaster id is derived from the product when
 * the caller did not have it. With a run id, the run's totals move too.
 */
export const recordTrace = internalMutation({
	args: { ...traceFields, roasterId: v.optional(v.id("roasters")) },
	handler: async (ctx, args) => {
		let { roasterId } = args;
		if (roasterId === undefined) {
			const product = await ctx.db.get("products", args.productId);
			if (product === null) {
				return null;
			}
			({ roasterId } = product);
		}
		const traceId = await ctx.db.insert("pipelineTraces", {
			...args,
			roasterId,
		});
		if (args.runId !== undefined) {
			const run = await ctx.db.get("pipelineRuns", args.runId);
			if (run !== null) {
				await ctx.db.patch("pipelineRuns", args.runId, {
					deferred: run.deferred + (args.outcome === "deferred" ? 1 : 0),
					failed: run.failed + (args.outcome === "failed" ? 1 : 0),
					jevMs: run.jevMs + (args.stages.jev ?? 0),
					jevQuestions: run.jevQuestions + (args.questionCount ?? 0),
					jevRequests:
						run.jevRequests + (args.stages.jev === undefined ? 0 : 1),
					pageMs: run.pageMs + (args.stages.page ?? 0),
					read:
						run.read +
						(args.outcome === "read" || args.outcome === "no_key" ? 1 : 0),
					updatedAt: Date.now(),
				});
			}
		}
		return traceId;
	},
	returns: v.union(v.id("pipelineTraces"), v.null()),
});

/**
 * The lot at `index` is done: move to the next, spaced like the sweep, or
 * mark the run done and cancel its watchdog. A stopped run stays stopped.
 */
export const advance = internalMutation({
	args: { index: v.number(), runId: v.id("pipelineRuns") },
	handler: async (ctx, args) => {
		const run = await ctx.db.get("pipelineRuns", args.runId);
		if (run === null || run.status !== "running" || run.index !== args.index) {
			return null;
		}
		const next = args.index + 1;
		const now = Date.now();
		if (next >= run.total) {
			await ctx.db.patch("pipelineRuns", args.runId, {
				currentProductId: undefined,
				currentStage: undefined,
				index: next,
				message: undefined,
				stageStartedAt: undefined,
				status: "done",
				updatedAt: now,
			});
			await cancelWatchdog(ctx, run);
			return null;
		}
		await ctx.db.patch("pipelineRuns", args.runId, {
			currentStage: undefined,
			index: next,
			message: undefined,
			updatedAt: now,
		});
		await ctx.scheduler.runAfter(
			PAGE_SWEEP_SPACING_MS,
			internal.nerdStuff.runLot,
			{ index: next, runId: args.runId }
		);
		return null;
	},
	returns: v.null(),
});

/** The feed pass replayed on the stored product, for the trace's FEED cell. */
export const feedTrace = (
	product: Pick<
		Doc<"products">,
		"description" | "name" | "productType" | "tags"
	>
): Infer<typeof traceFeedValidator> => {
	const tags = product.tags ?? [];
	const verdict = classifyLot({
		productType: product.productType,
		tags,
		title: product.name,
	});
	const attributes = parseLotAttributes({
		blockText: product.description,
		tags,
		title: product.name,
	});
	const notes = extractRoasterNotes(product.description ?? "", tags);
	return {
		attributes: Object.entries(attributes)
			.filter((entry): entry is [string, string] => entry[1] !== undefined)
			.map(([field, value]) => ({ field, value })),
		isLot: verdict.isLot,
		...(notes === null ? {} : { notes }),
		rule: verdict.rule,
	};
};

/** The gate's recorded answer, when the lot has a shadow row. */
const gateTrace = (
	shadow: Doc<"lotClassifierShadow"> | null
): Infer<typeof traceGateValidator> | undefined =>
	shadow === null
		? undefined
		: {
				agreed: shadow.agreed,
				coffeeProbability: shadow.coffeeProbability,
				jevChoice: shadow.jevChoice,
			};

/**
 * Read one lot of the run: replay the feed pass, look up the gate's
 * answer, read the page through the budget, store when asked, record the
 * trace, advance. A deferred read runs again at the budget's word with the
 * same index, up to MAX_READ_DEFERRALS; a stopped run exits here.
 */
export const runLot = internalAction({
	args: {
		deferrals: v.optional(v.number()),
		index: v.number(),
		reserved: v.optional(v.boolean()),
		runId: v.id("pipelineRuns"),
	},
	handler: async (ctx, args) => {
		const context = await ctx.runQuery(internal.nerdStuff.lotContext, {
			index: args.index,
			runId: args.runId,
		});
		if (context === null) {
			return null;
		}
		const { product, roaster, run, shadow } = context;
		const url =
			product === null || roaster === null
				? null
				: lotShopUrl(roaster, product);
		const startedAt = Date.now();
		const deferrals = args.deferrals ?? 0;
		const base = {
			...(deferrals === 0 ? {} : { deferrals }),
			name: product?.name ?? "",
			roasterId: run.roasterId,
			runId: run._id,
			startedAt,
			url: url ?? "",
		};
		const stage = async (s: RunStage, message?: string): Promise<void> => {
			await ctx.runMutation(internal.nerdStuff.setStage, {
				index: args.index,
				message,
				runId: args.runId,
				stage: s,
			});
		};
		if (product === null || url === null) {
			await ctx.runMutation(internal.nerdStuff.recordTrace, {
				...emptyTraceDraft(),
				...base,
				error: product === null ? "lot gone" : "no shop page",
				finishedAt: Date.now(),
				outcome: "failed",
				productId: product?._id ?? run.productIds[args.index],
			});
			await ctx.runMutation(internal.nerdStuff.advance, {
				index: args.index,
				runId: args.runId,
			});
			return null;
		}
		const withProduct = {
			...base,
			feed: feedTrace(product),
			gate: gateTrace(shadow),
			productId: product._id,
		};
		await stage("feed");
		await stage("gate");
		await stage("page");
		const mayDefer = deferrals < MAX_READ_DEFERRALS;
		try {
			const read = await readPageFacts(
				ctx,
				url,
				"",
				product.name,
				{ reserve: mayDefer, reserved: args.reserved },
				stage
			);
			if (run.commit) {
				await stage("store");
				await ctx.runMutation(internal.pageFacts.store, {
					...storeArgs(read),
					productId: product._id,
				});
			}
			await ctx.runMutation(internal.nerdStuff.recordTrace, {
				...read.trace,
				...withProduct,
				...(read.jev === "unreachable" ? { error: "Jev did not answer" } : {}),
				finishedAt: Date.now(),
				outcome: readOutcome(read),
			});
		} catch (error) {
			if (error instanceof ReadDeferredError && mayDefer) {
				await ctx.runMutation(internal.nerdStuff.noteDeferral, {
					index: args.index,
					runId: args.runId,
				});
				await ctx.scheduler.runAfter(
					error.retryAfter,
					internal.nerdStuff.runLot,
					{
						deferrals: deferrals + 1,
						index: args.index,
						reserved: error.reserved,
						runId: args.runId,
					}
				);
				return null;
			}
			await ctx.runMutation(internal.nerdStuff.recordTrace, {
				...emptyTraceDraft(),
				...withProduct,
				...(error instanceof ReadDeferredError
					? { outcome: "deferred" as const }
					: { error: errorText(error), outcome: "failed" as const }),
				finishedAt: Date.now(),
			});
		}
		await ctx.runMutation(internal.nerdStuff.advance, {
			index: args.index,
			runId: args.runId,
		});
		return null;
	},
	returns: v.null(),
});

/** One run. Anyone may read. */
export const run = query({
	args: { runId: v.id("pipelineRuns") },
	handler: async (ctx, args) => await ctx.db.get("pipelineRuns", args.runId),
	returns: nullableRun,
});

/** The newest run, so the page opens on whatever ran last. */
export const latestRun = query({
	args: {},
	handler: async (ctx) =>
		await ctx.db
			.query("pipelineRuns")
			.withIndex("by_created_at")
			.order("desc")
			.first(),
	returns: nullableRun,
});

/** One run's traces, oldest first. Bounded by the run's lot count. */
export const traces = query({
	args: { runId: v.id("pipelineRuns") },
	handler: async (ctx, args) =>
		await ctx.db
			.query("pipelineTraces")
			.withIndex("by_run_id_and_started_at", (q) => q.eq("runId", args.runId))
			.take(MAX_RUN_LOTS),
	returns: v.array(traceDoc),
});

/** The live tail: the newest traces across every read, with the lot's address. */
export const recentTraces = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("pipelineTraces")
			.withIndex("by_started_at")
			.order("desc")
			.take(
				Math.min(Math.max(1, Math.floor(args.limit ?? 20)), RECENT_TRACES_CAP)
			);
		return await Promise.all(
			rows.map(async (row) => {
				const [product, roaster] = await Promise.all([
					ctx.db.get("products", row.productId),
					ctx.db.get("roasters", row.roasterId),
				]);
				return {
					...row,
					handle: product?.handle ?? null,
					roasterSlug: roaster?.slug ?? null,
				};
			})
		);
	},
	returns: v.array(
		traceDoc.extend({
			handle: v.union(v.string(), v.null()),
			roasterSlug: v.union(v.string(), v.null()),
		})
	),
});

/**
 * Daily: traces older than TRACE_RETENTION_MS and runs older than
 * RUN_RETENTION_MS go, PRUNE_BATCH at a time; a full batch schedules the
 * next pass.
 */
export const prune = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const oldTraces = await ctx.db
			.query("pipelineTraces")
			.withIndex("by_started_at", (q) =>
				q.lt("startedAt", now - TRACE_RETENTION_MS)
			)
			.take(PRUNE_BATCH);
		await Promise.all(oldTraces.map((row) => ctx.db.delete(row._id)));
		const oldRuns = await ctx.db
			.query("pipelineRuns")
			.withIndex("by_created_at", (q) =>
				q.lt("createdAt", now - RUN_RETENTION_MS)
			)
			.take(PRUNE_BATCH);
		await Promise.all(oldRuns.map((row) => ctx.db.delete(row._id)));
		if (oldTraces.length === PRUNE_BATCH || oldRuns.length === PRUNE_BATCH) {
			await ctx.scheduler.runAfter(0, internal.nerdStuff.prune, {});
		}
		return oldTraces.length + oldRuns.length;
	},
	returns: v.number(),
});
