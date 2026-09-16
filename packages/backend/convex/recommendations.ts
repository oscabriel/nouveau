import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { Workpool, vOnCompleteValidator } from "@convex-dev/workpool";
import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireUserId } from "./identity";
import { joinNotes } from "./lotFacts";
import {
	candidateStillAvailable,
	catalogText,
	selectCandidates,
} from "./recommendationCatalog";
import {
	candidateValidator,
	EMPTY_EVIDENCE_TTL_MS,
	EVIDENCE_TTL_MS,
	MAX_ATTEMPTS,
	MAX_ENRICHMENTS,
	preferenceValidator,
	recommendationInput,
	RUN_TIMEOUT_MS,
	selectionValidator,
	validateInput,
	validateSelections,
} from "./recommendationRules";
import type { Preference, RecommendationInput } from "./recommendationRules";
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

const preferencesFor = async (
	ctx: QueryCtx,
	userId: Id<"users">,
	input: RecommendationInput
): Promise<Preference[]> => {
	const preferences: Preference[] = input.preferences.trim()
		? [{ id: "request", text: input.preferences.trim() }]
		: [];
	for (const [index, id] of input.logIds.entries()) {
		// oxlint-disable-next-line no-await-in-loop -- at most five owner-checked logs
		const log = await ctx.db.get(id);
		if (!log || log.userId !== userId) {
			throw new ConvexError("Choose logs from your own history.");
		}
		// oxlint-disable-next-line no-await-in-loop -- at most five coffees
		const product = await ctx.db.get(log.productId);
		if (!product) {
			throw new ConvexError("A selected coffee is no longer in the catalog.");
		}
		preferences.push({
			id: `history:${index}`,
			text: [
				`Selected coffee: ${product.name}.`,
				log.rating === undefined
					? "No rating recorded."
					: `Your rating: ${log.rating}/5.`,
				joinNotes(product.roasterNotes) === null
					? ""
					: `Roaster descriptors: ${joinNotes(product.roasterNotes)}.`,
				input.includeNotes && log.notes ? `Your note: ${log.notes}` : "",
			]
				.filter(Boolean)
				.join(" "),
		});
	}
	return preferences;
};

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
		const preferences = await preferencesFor(ctx, userId, input);
		await ensureNoActiveRun(ctx, userId);
		await consumeQuota(ctx, userId);
		const now = Date.now();
		const runId = await ctx.db.insert("recommendationRuns", {
			attempt: 1,
			candidates: [],
			createdAt: now,
			enrichments: 0,
			input,
			message: "Waiting to check the catalog.",
			preferences,
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
		const preferences = await preferencesFor(ctx, userId, run.input);
		await ensureNoActiveRun(ctx, userId);
		await consumeQuota(ctx, userId);
		const attempt = run.attempt + 1;
		await ctx.db.patch(runId, {
			attempt,
			candidates: [],
			message: "Waiting to retry.",
			model: undefined,
			preferences,
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
		// Deleted or reassigned logs must not reach the provider from a queued request.
		const preferences = await preferencesFor(ctx, run.userId, run.input);
		const candidates = await selectCandidates(ctx, run.input, now);
		await ctx.db.patch(runId, {
			candidates,
			message: "Checking source details and comparing coffees.",
			preferences,
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

export const prepareModel = internalMutation({
	args: attemptArgs,
	handler: async (ctx, { attempt, runId }) => {
		const run = await ctx.db.get(runId);
		if (!run || !activeAttempt(run, attempt)) {
			return null;
		}
		const preferences = await preferencesFor(ctx, run.userId, run.input);
		await ctx.db.patch(runId, { preferences });
		return { ...run, preferences };
	},
	returns: v.union(schema.doc("recommendationRuns"), v.null()),
});

export const finish = internalMutation({
	args: {
		...attemptArgs,
		message: v.string(),
		model: v.optional(v.string()),
		selections: v.array(selectionValidator),
		status: v.union(v.literal("ready"), v.literal("failed")),
	},
	handler: async (ctx, { attempt, runId, ...result }) => {
		const run = await ctx.db.get(runId);
		if (!run || !activeAttempt(run, attempt)) {
			return null;
		}
		const selections = validateSelections(
			{ selections: result.selections },
			run.candidates,
			run.preferences
		);
		const available = await Promise.all(
			selections.map(async (selection) => {
				const candidate = run.candidates.find(
					(item) => item.productId === selection.productId
				);
				return candidate &&
					(await candidateStillAvailable(ctx, candidate, run.input, Date.now()))
					? selection
					: null;
			})
		);
		await ctx.db.patch(runId, {
			...result,
			selections: available.filter((item) => item !== null),
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

const resultValidator = v.object({
	canBuy: v.boolean(),
	candidate: candidateValidator,
	preference: v.string(),
	selection: selectionValidator,
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
		const results = await Promise.all(
			run.selections.map(async (selection) => {
				const candidate = run.candidates.find(
					(item) => item.productId === selection.productId
				);
				if (!candidate) {
					return null;
				}
				return {
					canBuy: await candidateStillAvailable(ctx, candidate, run.input, now),
					candidate,
					preference:
						run.preferences.find((item) => item.id === selection.preferenceId)
							?.text ?? "",
					selection,
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
			preferences: run.preferences,
			results: results.filter((item) => item !== null),
			status: run.status,
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
			preferences: v.array(preferenceValidator),
			results: v.array(resultValidator),
			status: schema.doc("recommendationRuns").fields.status,
		})
	),
});

const historyOption = v.object({
	id: v.id("logs"),
	loggedAt: v.number(),
	name: v.string(),
	notes: v.union(v.string(), v.null()),
	rating: v.union(v.number(), v.null()),
});
export const history = query({
	args: { paginationOpts: paginationOptsValidator },
	handler: async (ctx, { paginationOpts }) => {
		const userId = await requireUserId(ctx);
		if (
			!Number.isInteger(paginationOpts.numItems) ||
			paginationOpts.numItems < 1 ||
			paginationOpts.numItems > 50
		) {
			throw new ConvexError("Choose a history page size between 1 and 50.");
		}
		const page = await ctx.db
			.query("logs")
			.withIndex("by_user_and_logged_at", (q) => q.eq("userId", userId))
			.order("desc")
			.paginate(paginationOpts);
		const items = await Promise.all(
			page.page.map(async (log) => {
				const product = await ctx.db.get(log.productId);
				return {
					id: log._id,
					loggedAt: log.loggedAt,
					name: product?.name ?? "Coffee no longer in catalog",
					notes: log.notes ?? null,
					rating: log.rating ?? null,
				};
			})
		);
		return { ...page, page: items };
	},
	returns: paginationResultValidator(historyOption),
});
