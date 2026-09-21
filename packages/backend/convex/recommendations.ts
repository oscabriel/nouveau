import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { Workpool, vOnCompleteValidator } from "@convex-dev/workpool";
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./identity";
import { candidateStillAvailable, catalogText } from "./recommendationCatalog";
import {
	candidateValidator,
	EMPTY_EVIDENCE_TTL_MS,
	EVIDENCE_TTL_MS,
	MAX_ATTEMPTS,
	MAX_ENRICHMENTS,
	MAX_PICKS,
	MAX_RUN_CANDIDATES,
	OPENAI_MODEL,
	recommendationInput,
	RUN_TIMEOUT_MS,
	SHORTLIST_TTL_MS,
	pickValidator,
	validateInput,
	WHY_MAX_CHARS,
} from "./recommendationRules";
import schema from "./schema";

const pool = new Workpool(components.recommendationPool, {
	logLevel: "ERROR",
	maxParallelism: 2,
	retryActionsByDefault: false,
});
const limiter = new RateLimiter(components.rateLimiter, {
	recommendationGlobal: { kind: "fixed window", period: HOUR, rate: 30 },
	recommendationPages: { kind: "fixed window", period: HOUR, rate: 60 },
	recommendationUser: { kind: "fixed window", period: HOUR, rate: 5 },
});
const attemptArgs = { attempt: v.number(), runId: v.id("recommendationRuns") };
const activeAttempt = (
	run: Doc<"recommendationRuns"> | null,
	attempt: number
) => run !== null && run.attempt === attempt && run.status === "running";

const consumeQuota = async (
	ctx: MutationCtx,
	userId: Id<"users">
): Promise<void> => {
	await limiter.limit(ctx, "recommendationUser", { key: userId, throws: true });
	await limiter.limit(ctx, "recommendationGlobal", { throws: true });
};

const ensureNoActiveRun = async (
	ctx: QueryCtx,
	userId: Id<"users">
): Promise<void> => {
	const [queued, running] = await Promise.all([
		ctx.db
			.query("recommendationRuns")
			.withIndex("by_user_id_and_status", (q) =>
				q.eq("userId", userId).eq("status", "queued")
			)
			.first(),
		ctx.db
			.query("recommendationRuns")
			.withIndex("by_user_id_and_status", (q) =>
				q.eq("userId", userId).eq("status", "running")
			)
			.first(),
	]);
	if (queued || running) {
		throw new ConvexError("Wait for your current shortlist to finish.");
	}
};

/** A settled run no longer needs its watchdog. */
const cancelWatchdog = async (
	ctx: MutationCtx,
	run: Doc<"recommendationRuns">
): Promise<void> => {
	if (run.expireId === undefined) {
		return;
	}
	const scheduled = await ctx.db.system.get(run.expireId);
	if (scheduled?.state.kind === "pending") {
		await ctx.scheduler.cancel(run.expireId);
	}
};

const enqueue = async (
	ctx: MutationCtx,
	runId: Id<"recommendationRuns">,
	attempt: number
): Promise<void> => {
	await pool.enqueueAction(
		ctx,
		internal.recommendationWorker.run,
		{ attempt, runId },
		{
			context: { attempt, runId },
			onComplete: internal.recommendations.onComplete,
			retry: false,
		}
	);
	const expireId = await ctx.scheduler.runAfter(
		RUN_TIMEOUT_MS,
		internal.recommendations.expire,
		{ attempt, runId }
	);
	await ctx.db.patch(runId, { expireId });
};

export const request = mutation({
	args: { ...recommendationInput.fields, requestKey: v.string() },
	handler: async (ctx, { requestKey, ...input }) => {
		const userId = await requireUserId(ctx);
		validateInput(input);
		if (requestKey.length < 8 || requestKey.length > 100) {
			throw new ConvexError("Invalid request key.");
		}
		const previous = await ctx.db
			.query("recommendationRuns")
			.withIndex("by_user_id_and_request_key", (q) =>
				q.eq("userId", userId).eq("requestKey", requestKey)
			)
			.unique();
		if (previous) {
			return previous._id;
		}
		await ensureNoActiveRun(ctx, userId);
		await consumeQuota(ctx, userId);
		const now = Date.now();
		const runId = await ctx.db.insert("recommendationRuns", {
			attempt: 1,
			candidates: [],
			createdAt: now,
			enrichments: 0,
			input,
			message: "Waiting to read the catalog.",
			requestKey,
			selections: [],
			status: "queued",
			updatedAt: now,
			userId,
		});
		await enqueue(ctx, runId, 1);
		return runId;
	},
	returns: v.id("recommendationRuns"),
});

export const retry = mutation({
	args: { runId: v.id("recommendationRuns") },
	handler: async (ctx, { runId }) => {
		const userId = await requireUserId(ctx);
		const run = await ctx.db.get(runId);
		if (!run || run.userId !== userId) {
			throw new ConvexError("Shortlist not found.");
		}
		if (run.status !== "failed" || run.attempt >= MAX_ATTEMPTS) {
			throw new ConvexError("This request cannot be retried.");
		}
		await ensureNoActiveRun(ctx, userId);
		await consumeQuota(ctx, userId);
		const attempt = run.attempt + 1;
		await ctx.db.patch(runId, {
			attempt,
			candidates: [],
			enrichments: 0,
			message: "Waiting to retry.",
			model: undefined,
			selections: [],
			status: "queued",
			updatedAt: Date.now(),
		});
		await enqueue(ctx, runId, attempt);
		return null;
	},
	returns: v.null(),
});

export const claim = internalMutation({
	args: attemptArgs,
	handler: async (ctx, { attempt, runId }) => {
		const run = await ctx.db.get(runId);
		if (!run || run.attempt !== attempt || run.status !== "queued") {
			return null;
		}
		const now = Date.now();
		// The tools build the candidate list; the run starts empty and the
		// search tool fills it (ADR-0017).
		await ctx.db.patch(runId, {
			candidates: [],
			enrichments: 0,
			message: "Searching the catalog and reading details.",
			status: "running",
			updatedAt: now,
		});
		return ctx.db.get(runId);
	},
	returns: v.union(schema.doc("recommendationRuns"), v.null()),
});

/**
 * Claims one page fetch for this run. Returns the feed's full text for the
 * lot when the fetch may proceed, so page evidence that repeats the catalog
 * is dropped; null when cached, capped or out of quota.
 */
export const reserveEnrichment = internalMutation({
	args: { ...attemptArgs, productId: v.id("products") },
	handler: async (ctx, { attempt, productId, runId }) => {
		const run = await ctx.db.get(runId);
		if (
			!activeAttempt(run, attempt) ||
			!run ||
			run.enrichments >= MAX_ENRICHMENTS
		) {
			return null;
		}
		const candidate = run.candidates.find(
			(item) => item.productId === productId
		);
		const product = candidate ? await ctx.db.get(productId) : null;
		if (!(candidate && product)) {
			return null;
		}
		const cached = await ctx.db
			.query("recommendationEvidence")
			.withIndex("by_product_id", (q) => q.eq("productId", productId))
			.unique();
		if (
			cached &&
			cached.url === candidate.url &&
			Date.now() - cached.observedAt <
				(cached.passages.length > 0 ? EVIDENCE_TTL_MS : EMPTY_EVIDENCE_TTL_MS)
		) {
			return null;
		}
		const quota = await limiter.limit(ctx, "recommendationPages");
		if (!quota.ok) {
			return null;
		}
		await ctx.db.patch(runId, { enrichments: run.enrichments + 1 });
		// A shared reservation also caches empty and failed scrapes to bound costs.
		const value = {
			observedAt: Date.now(),
			passages: [],
			productId,
			url: candidate.url,
		};
		await (cached
			? ctx.db.replace(cached._id, value)
			: ctx.db.insert("recommendationEvidence", value));
		return { known: catalogText(product) };
	},
	returns: v.union(v.object({ known: v.string() }), v.null()),
});

export const storeEnrichment = internalMutation({
	args: {
		...attemptArgs,
		passages: v.array(v.string()),
		productId: v.id("products"),
	},
	handler: async (ctx, { attempt, passages, productId, runId }) => {
		const run = await ctx.db.get(runId);
		if (
			!run ||
			!activeAttempt(run, attempt) ||
			!run.candidates.some((item) => item.productId === productId)
		) {
			return null;
		}
		if (passages.length > 3 || passages.some((text) => text.length > 1000)) {
			throw new Error("Source evidence exceeds limits");
		}
		const cached = await ctx.db
			.query("recommendationEvidence")
			.withIndex("by_product_id", (q) => q.eq("productId", productId))
			.unique();
		if (!cached) {
			return null;
		}
		const observedAt = Date.now();
		await ctx.db.patch(cached._id, { observedAt, passages });
		const candidates = run.candidates.map((item) =>
			item.productId === productId
				? {
						...item,
						evidence: [
							...item.evidence.filter(
								(evidence) => evidence.source !== "firecrawl"
							),
							...passages.map((passage, index) => ({
								id: `${productId}:page:${index}`,
								observedAt,
								passage,
								source: "firecrawl" as const,
								url: item.url,
							})),
						],
					}
				: item
		);
		await ctx.db.patch(runId, { candidates });
		return null;
	},
	returns: v.null(),
});

/**
 * Maintenance: drop cached page evidence so the next requests scrape again.
 * Run after tightening the passage filters. Batches itself on large caches.
 */
export const purgeEvidence = internalMutation({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("recommendationEvidence").take(200);
		await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
		if (rows.length === 200) {
			await ctx.scheduler.runAfter(
				0,
				internal.recommendations.purgeEvidence,
				{}
			);
		}
		return rows.length;
	},
	returns: v.number(),
});

/**
 * Stores the thread id once the worker created it, so the client can watch
 * the steps and the thread query can authorize through run ownership.
 */
export const startThread = internalMutation({
	args: { ...attemptArgs, threadId: v.string() },
	handler: async (ctx, { attempt, runId, threadId }) => {
		if (!activeAttempt(await ctx.db.get(runId), attempt)) {
			return null;
		}
		await ctx.db.patch(runId, { threadId });
		return null;
	},
	returns: v.null(),
});

const recordedValidator = v.object({
	added: v.number(),
	total: v.number(),
});

/**
 * Merges the lots a search returned into the run's candidate set, deduped by
 * variant, capped at MAX_RUN_CANDIDATES so a chatty loop stays bounded.
 */
export const recordCandidates = internalMutation({
	args: { ...attemptArgs, candidates: v.array(candidateValidator) },
	handler: async (ctx, { attempt, candidates, runId }) => {
		const run = await ctx.db.get(runId);
		if (!run || !activeAttempt(run, attempt)) {
			return null;
		}
		const known = new Set(run.candidates.map((item) => item.variantId));
		const fresh = candidates.filter((item) => !known.has(item.variantId));
		const room = Math.max(0, MAX_RUN_CANDIDATES - run.candidates.length);
		const added = fresh.slice(0, room);
		if (added.length === 0) {
			return { added: 0, total: run.candidates.length };
		}
		await ctx.db.patch(runId, {
			candidates: [...run.candidates, ...added],
			updatedAt: Date.now(),
		});
		return { added: added.length, total: run.candidates.length + added.length };
	},
	returns: v.union(recordedValidator, v.null()),
});

/**
 * The pickLot tool's write (ADR-0017, amendment of 2026-09-20): one pick per
 * call, appended in call order, so the client shows each card the moment it
 * validates. Rank is call order. The id must come from this run's searches,
 * the why must fit, the list is capped, and stock and price are re-checked.
 * Throws the error the model must fix; a lot that is no longer available is
 * not the model's fault, so that comes back as a refusal it can act on.
 */
export const pickLot = internalMutation({
	args: { ...attemptArgs, productId: v.id("products"), why: v.string() },
	handler: async (ctx, { attempt, productId, runId, why }) => {
		const run = await ctx.db.get(runId);
		if (!run || !activeAttempt(run, attempt)) {
			throw new Error("This request is no longer active.");
		}
		if (run.selections.length >= MAX_PICKS) {
			throw new Error(
				`The list already holds ${MAX_PICKS} picks; stop picking and write your closing sentence.`
			);
		}
		if (run.selections.some((item) => item.productId === productId)) {
			throw new Error(`Pick ${productId} is already on the list.`);
		}
		if (why.trim().length === 0 || why.length > WHY_MAX_CHARS) {
			throw new Error(
				`Pick ${productId}: the why must be one or two sentences, at most ${WHY_MAX_CHARS} characters.`
			);
		}
		const candidate = run.candidates.find(
			(item) => item.productId === productId
		);
		if (!candidate) {
			throw new Error(
				`Pick ${productId} is not a coffee the tools found. Search the catalog first and pick only from search results.`
			);
		}
		const now = Date.now();
		if (!(await candidateStillAvailable(ctx, candidate, now))) {
			return {
				accepted: false as const,
				reason:
					"This lot is no longer in stock at the recorded price. Pick a different coffee.",
			};
		}
		const rank = run.selections.length + 1;
		await ctx.db.patch(runId, {
			model: OPENAI_MODEL,
			selections: [...run.selections, { productId, why: why.trim() }],
			updatedAt: now,
		});
		return { accepted: true as const, rank };
	},
	returns: v.union(
		v.object({ accepted: v.literal(true), rank: v.number() }),
		v.object({ accepted: v.literal(false), reason: v.string() })
	),
});

/**
 * Maintenance: drop old runs (their threads stay). Runs are transient; the
 * threads keep the HOW IT LOOKED record.
 */
export const purgeRuns = internalMutation({
	args: { before: v.number() },
	handler: async (ctx, { before }) => {
		const rows = await ctx.db
			.query("recommendationRuns")
			.withIndex("by_creation_time", (q) => q.lt("_creationTime", before))
			.take(500);
		await Promise.all(rows.map((row) => ctx.db.delete(row._id)));
		return rows.length;
	},
	returns: v.number(),
});

/** The worker and the tools read the run through this attempt-checked query. */
export const getRun = internalQuery({
	args: attemptArgs,
	handler: async (ctx, { attempt, runId }) => {
		const run = await ctx.db.get(runId);
		return activeAttempt(run, attempt) ? run : null;
	},
	returns: v.union(schema.doc("recommendationRuns"), v.null()),
});

/**
 * The worker tail's read: this attempt's run in whatever state it is in; the
 * caller branches on status.
 */
export const readRun = internalQuery({
	args: attemptArgs,
	handler: async (ctx, { attempt, runId }) => {
		const run = await ctx.db.get(runId);
		return run !== null && run.attempt === attempt ? run : null;
	},
	returns: v.union(schema.doc("recommendationRuns"), v.null()),
});

/**
 * The checkAvailability tool's read: the same re-check the server runs
 * before storing, plus the variant's current price and size.
 */
export const checkCandidate = internalQuery({
	args: { ...attemptArgs, productId: v.id("products") },
	handler: async (ctx, { attempt, productId, runId }) => {
		const run = await ctx.db.get(runId);
		if (!run || !activeAttempt(run, attempt)) {
			return null;
		}
		const candidate = run.candidates.find(
			(item) => item.productId === productId
		);
		if (!candidate) {
			return null;
		}
		const variant = await ctx.db.get(candidate.variantId);
		return {
			available: await candidateStillAvailable(ctx, candidate, Date.now()),
			grams: variant?.grams ?? null,
			priceCents: variant?.priceCents ?? null,
		};
	},
	returns: v.union(
		v.object({
			available: v.boolean(),
			grams: v.union(v.number(), v.null()),
			priceCents: v.union(v.number(), v.null()),
		}),
		v.null()
	),
});

/**
 * The loop's last touch (ADR-0017, amendment of 2026-09-20): the model
 * stopped calling tools, so the run is ready with whatever pickLot stored,
 * and the model's final prose becomes the summary line. An empty list is a
 * valid result. A run the watchdog or a retry already moved on is left alone.
 */
export const finish = internalMutation({
	args: { ...attemptArgs, summary: v.string() },
	handler: async (ctx, { attempt, runId, summary }) => {
		const run = await ctx.db.get(runId);
		if (!run || !activeAttempt(run, attempt)) {
			return null;
		}
		await ctx.db.patch(runId, {
			message:
				summary.length > 0
					? summary
					: "Compared the lots the tools found. Fewer than five matches is a valid result.",
			model: run.model ?? OPENAI_MODEL,
			status: "ready",
			updatedAt: Date.now(),
		});
		await cancelWatchdog(ctx, run);
		return null;
	},
	returns: v.null(),
});

export const expire = internalMutation({
	args: { ...attemptArgs, providerFailed: v.optional(v.boolean()) },
	handler: async (ctx, { attempt, providerFailed, runId }) => {
		const run = await ctx.db.get(runId);
		if (
			run &&
			run.attempt === attempt &&
			(run.status === "queued" || run.status === "running")
		) {
			await ctx.db.patch(runId, {
				message: providerFailed
					? "The shortlist could not be verified. Browsing and logging still work."
					: "The request timed out. Browsing and logging still work.",
				status: "failed",
				updatedAt: Date.now(),
			});
			// No-op when this call is the watchdog itself (state is in progress).
			await cancelWatchdog(ctx, run);
		}
		return null;
	},
	returns: v.null(),
});

export const onComplete = internalMutation({
	args: vOnCompleteValidator(v.object(attemptArgs)),
	handler: async (ctx, { context, result }) => {
		if (result.kind !== "success") {
			const run = await ctx.db.get(context.runId);
			if (
				run &&
				run.attempt === context.attempt &&
				(run.status === "running" || run.status === "queued")
			) {
				// Never persist provider errors, which can contain source text or prompts.
				await ctx.db.patch(run._id, {
					message:
						"The shortlist could not finish. Browsing and logging still work.",
					status: "failed",
					updatedAt: Date.now(),
				});
				await cancelWatchdog(ctx, run);
			}
		}
		return null;
	},
	returns: v.null(),
});

export const latest = query({
	args: { now: v.number() },
	handler: async (ctx, { now }) => {
		const userId = await requireUserId(ctx);
		if (!Number.isFinite(now)) {
			throw new TypeError("Invalid time");
		}
		const run = await ctx.db
			.query("recommendationRuns")
			.withIndex("by_user_id_and_created_at", (q) => q.eq("userId", userId))
			.order("desc")
			.first();
		if (!run) {
			return null;
		}
		// A settled run ages out of the pane; an active one always shows.
		const settled = run.status === "ready" || run.status === "failed";
		if (settled && now - run.updatedAt > SHORTLIST_TTL_MS) {
			return null;
		}
		const results = await Promise.all(
			run.selections.map(async (pick) => {
				const candidate = run.candidates.find(
					(item) => item.productId === pick.productId
				);
				if (!candidate) {
					return null;
				}
				const product = await ctx.db.get(pick.productId);
				return {
					canBuy: await candidateStillAvailable(ctx, candidate, now),
					candidate,
					imageUrl: product?.imageUrl ?? null,
					pick,
				};
			})
		);
		return {
			attempt: run.attempt,
			canRetry: run.status === "failed" && run.attempt < MAX_ATTEMPTS,
			createdAt: run.createdAt,
			id: run._id,
			input: run.input,
			message: run.message,
			model: run.model ?? null,
			picks: results.filter((item) => item !== null),
			status: run.status,
			// The client watches the run's thread for the loop's steps; absent
			// until the worker created it, and on runs from before the field.
			threadId: run.threadId ?? null,
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			attempt: v.number(),
			canRetry: v.boolean(),
			createdAt: v.number(),
			id: v.id("recommendationRuns"),
			input: recommendationInput,
			message: v.string(),
			model: v.union(v.string(), v.null()),
			picks: v.array(
				v.object({
					canBuy: v.boolean(),
					candidate: candidateValidator,
					imageUrl: v.union(v.string(), v.null()),
					pick: pickValidator,
				})
			),
			status: schema.doc("recommendationRuns").fields.status,
			threadId: v.union(v.string(), v.null()),
		})
	),
});
