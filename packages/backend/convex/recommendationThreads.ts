// The next-bag run's thread, exposed to the client (ADR-0017). The run
// document keeps status, the request text and the validated result; the
// agent component's thread keeps everything else, so this one query is the
// client's whole window onto the loop: the tool-call parts are the steps,
// the final text is the summary line's source.
//
// Authorization follows run ownership: a thread is readable only by the
// viewer whose run created it, the same rule as the run subscription.
import type { SyncStreamsReturnValue } from "@convex-dev/agent";
import { listUIMessages, syncStreams, vStreamArgs } from "@convex-dev/agent";
import {
	paginationOptsValidator,
	paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { requireUserId } from "./identity";

/**
 * The one UIMessage shape the client's step list needs. The agent's stored
 * messages carry more (metadata, per-model fields); it is projected away
 * here so the returns validator stays honest about what crosses the wire.
 */
const stepValidator = v.object({
	_creationTime: v.number(),
	id: v.string(),
	key: v.string(),
	order: v.number(),
	parts: v.array(v.any()),
	role: v.string(),
	status: v.union(
		v.literal("success"),
		v.literal("failed"),
		v.literal("pending"),
		v.literal("streaming")
	),
	stepOrder: v.number(),
	text: v.string(),
});

const streamsValidator = v.optional(
	v.union(
		v.object({
			kind: v.literal("list"),
			messages: v.array(v.any()),
		}),
		v.object({
			deltas: v.array(v.any()),
			kind: v.literal("deltas"),
		})
	)
);

export const list = query({
	args: {
		paginationOpts: paginationOptsValidator,
		streamArgs: vStreamArgs,
		threadId: v.string(),
	},
	handler: async (ctx, args) => {
		const userId = await requireUserId(ctx);
		const run = await ctx.db
			.query("recommendationRuns")
			.withIndex("by_user_id_and_thread_id", (q) =>
				q.eq("userId", userId).eq("threadId", args.threadId)
			)
			.first();
		if (!run) {
			throw new ConvexError("Shortlist not found.");
		}
		const paginated = await listUIMessages(ctx, components.agent, {
			paginationOpts: args.paginationOpts,
			threadId: args.threadId,
		});
		const streams: SyncStreamsReturnValue | undefined = await syncStreams(
			ctx,
			components.agent,
			{
				streamArgs: args.streamArgs,
				threadId: args.threadId,
			}
		);
		const page = paginated.page.map((message) => ({
			_creationTime: message._creationTime,
			id: message.id,
			key: message.key,
			order: message.order,
			parts: message.parts,
			role: message.role,
			status: message.status,
			stepOrder: message.stepOrder,
			text: message.text,
		}));
		return { ...paginated, page, streams };
	},
	returns: paginationResultValidator(stepValidator).extend({
		streams: streamsValidator,
	}),
});
