"use node";

// The workpool entry for one next-bag run (ADR-0017). It claims the run,
// reads the request with one Jev batch, creates a fresh thread, and drives
// the agent loop over it; the thread's tool-call parts are the run's steps
// and the submitPicks tool writes the result. Quotas, the watchdog, the
// one-active-run rule and the retry rule are unchanged: they live in
// recommendations.ts and fire from the workpool and the scheduler exactly as
// they did for the single-call pipeline.
import { createThread } from "@convex-dev/agent";
import { stepCountIs } from "ai";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { env, internalAction } from "./_generated/server";
import { readPageFacts } from "./pageFacts";
import {
	buildAgent,
	buildPrompt,
	checkWhys,
	structureRequest,
} from "./recommendationAgent";
import {
	MAX_STEPS,
	OPENAI_REASONING_EFFORT,
	pagePassages,
} from "./recommendationRules";

const SUMMARY_MAX_CHARS = 240;

const attemptArgs = { attempt: v.number(), runId: v.id("recommendationRuns") };

/**
 * The readLotFacts tool's page read (ADR-0017). An action because the
 * Firecrawl read and the Jev page questions need it; the loop's streaming
 * action calls it through ctx.runAction.
 */
export const readLot = internalAction({
	args: { ...attemptArgs, productId: v.id("products") },
	handler: async (
		ctx,
		{ attempt, productId, runId }
	): Promise<{ error: string } | { note: string; says: string[] }> => {
		const run = await ctx.runQuery(internal.recommendations.getRun, {
			attempt,
			runId,
		});
		if (!run) {
			return { error: "This request is no longer active." };
		}
		const candidate = run.candidates.find(
			(item) => item.productId === productId
		);
		if (!candidate) {
			return {
				error:
					"readLotFacts only takes lots from searchCatalog results. Search first.",
			};
		}
		// No page read is due for the lot (every page fact known; ADR-0008),
		// so the run does not spend one on it.
		if (candidate.factsKnown) {
			return {
				note: "The lot's details are already known; these are the stored details.",
				says: candidate.evidence.map((item) => item.passage),
			};
		}
		const reserved = await ctx.runMutation(
			internal.recommendations.reserveEnrichment,
			{ attempt, productId: candidate.productId, runId }
		);
		if (!reserved) {
			// Cached, capped, or out of the page budget: the stored facts and
			// cached page passages are what this run has (ADR-0010).
			return {
				note: "No new page read was available; these are the stored details.",
				says: candidate.evidence.map((item) => item.passage),
			};
		}
		try {
			const page = await readPageFacts(
				ctx,
				candidate.url,
				reserved.known,
				candidate.name
			);
			await ctx.runMutation(internal.pageFacts.store, {
				facts: page.facts,
				productId: candidate.productId,
			});
			const passages = pagePassages(
				{ markdown: page.pageText, sentences: page.sentences },
				reserved.known
			);
			await ctx.runMutation(internal.recommendations.storeEnrichment, {
				attempt,
				passages,
				productId: candidate.productId,
				runId,
			});
			return {
				note:
					passages.length > 0
						? "New page details."
						: "The page held no new usable details.",
				says: passages,
			};
		} catch {
			// Not counted toward the lot's read cap (ADR-0008); the hourly
			// retry covers the lot.
			return {
				note: "The page could not be read; proceed with the stored details.",
				says: candidate.evidence.map((item) => item.passage),
			};
		}
	},
	returns: v.union(
		v.object({ error: v.string() }),
		v.object({ note: v.string(), says: v.array(v.string()) })
	),
});

export const run = internalAction({
	args: { attempt: v.number(), runId: v.id("recommendationRuns") },
	handler: async (ctx, args) => {
		try {
			const claimed = await ctx.runMutation(
				internal.recommendations.claim,
				args
			);
			if (!claimed) {
				return null;
			}
			if (!env.OPENAI_API_KEY) {
				await ctx.runMutation(internal.recommendations.expire, {
					...args,
					providerFailed: true,
				});
				return null;
			}
			// One Typesafe batch turns the request into typed search filters;
			// the first search runs with them and the loop sees the results.
			const filters = await structureRequest(ctx, claimed.input.preferences);
			await ctx.runMutation(internal.recommendations.setStructured, {
				...args,
				filters,
			});
			const initial = await ctx.runQuery(
				internal.recommendationAgent.searchCatalogQuery,
				{
					flavour: filters?.flavour,
					maxGrams: undefined,
					maxPriceCents: filters?.maxPriceCents,
					minGrams: filters?.minGrams,
					now: Date.now(),
					origin: filters?.origin,
					process: filters?.process,
					query: claimed.input.preferences,
				}
			);
			await ctx.runMutation(internal.recommendations.recordCandidates, {
				...args,
				candidates: initial.candidates,
			});
			// One fresh thread per run, never reused (ADR-0017): the thread is
			// the run's HOW IT LOOKED record.
			const threadId = await createThread(ctx, components.agent, {
				title: "next-bag",
			});
			await ctx.runMutation(internal.recommendations.startThread, {
				...args,
				threadId,
			});
			const loopCtx = {
				...ctx,
				attempt: args.attempt,
				ownerId: claimed.userId,
				runId: args.runId,
			};
			const agent = buildAgent(loopCtx, claimed.input.includeNotes);
			const result = await agent.streamText(
				loopCtx,
				{ threadId },
				{
					prompt: buildPrompt(claimed.input.preferences, filters, initial.rows),
					// The reasoning effort the Responses pipeline pinned; set here
					// because the agent component's callSettings merge drops it.
					providerOptions: {
						openai: { reasoningEffort: OPENAI_REASONING_EFFORT },
					},
					stopWhen: stepCountIs(MAX_STEPS),
				},
				{ saveStreamDeltas: true }
			);
			await result.consumeStream();
			const settled = await ctx.runQuery(internal.recommendations.getRun, args);
			if (!settled) {
				// The watchdog expired mid-loop; the run is already failed.
				return null;
			}
			if (settled.status !== "ready") {
				// The loop ended without the submitPicks handoff.
				await ctx.runMutation(internal.recommendations.expire, {
					...args,
					providerFailed: false,
				});
				return null;
			}
			// One Jev Noul per card checks the why against the run's facts;
			// a failed check blanks the sentence (ADR-0017).
			const checked = await checkWhys(ctx, settled);
			const text = await result.text;
			const summary = text.trim().slice(0, SUMMARY_MAX_CHARS);
			await ctx.runMutation(internal.recommendations.summarize, {
				...args,
				blanked: checked.blanked,
				summary,
			});
		} catch {
			// Swallow raw provider errors before workpool can log private inputs.
			await ctx.runMutation(internal.recommendations.expire, {
				...args,
				providerFailed: true,
			});
		}
		return null;
	},
	returns: v.null(),
});
