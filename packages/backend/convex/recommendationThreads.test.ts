// The client's window onto the run's thread (ADR-0017). The authorization
// surface is the point: a thread is readable only by the viewer whose run
// created it.
/// <reference types="vite/client" />
import { createThread } from "@convex-dev/agent";
import { register as registerAgent } from "@convex-dev/agent/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { api, components } from "./_generated/api";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_800_000_000_000);
});
afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

const setup = async () => {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	registerWorkpool(t, "recommendationPool");
	registerFirecrawl(t);
	registerAgent(t);
	const ids = await t.run(async (ctx) => {
		const userId = await ctx.db.insert("users", {
			email: "never-send@example.com",
			name: "One",
			providerAccountId: "one",
		});
		const otherId = await ctx.db.insert("users", {
			name: "Two",
			providerAccountId: "two",
		});
		const runId = await ctx.db.insert("recommendationRuns", {
			attempt: 1,
			candidates: [],
			createdAt: Date.now(),
			enrichments: 0,
			input: { includeNotes: false, preferences: "A floral washed coffee" },
			message: "Waiting to read the catalog.",
			requestKey: "request-key-0001",
			selections: [],
			status: "running",
			updatedAt: Date.now(),
			userId,
		});
		return { otherId, runId, userId };
	});
	return { t, ...ids };
};

test("the run's owner reads the thread; anyone else is refused", async () => {
	const { t, runId, userId, otherId } = await setup();
	const threadId = await t.mutation((ctx) =>
		createThread(ctx, components.agent, { title: "next-bag" })
	);
	await t.run(async (ctx) => {
		await ctx.db.patch(runId, { threadId });
	});
	const args = {
		paginationOpts: { cursor: null, numItems: 10 },
		threadId,
	};
	const page = await asUser(t, userId).query(api.recommendationThreads.list, {
		...args,
	});
	expect(page.isDone).toBe(true);
	expect(page.page).toEqual([]);
	expect(page.streams).toBeUndefined();
	await expect(
		asUser(t, otherId).query(api.recommendationThreads.list, { ...args })
	).rejects.toThrow(/Shortlist not found/u);
});

test("a thread no run claims reads as not found", async () => {
	const { t, userId } = await setup();
	const threadId = await t.mutation((ctx) =>
		createThread(ctx, components.agent, { title: "stray" })
	);
	await expect(
		asUser(t, userId).query(api.recommendationThreads.list, {
			paginationOpts: { cursor: null, numItems: 10 },
			threadId,
		})
	).rejects.toThrow(/Shortlist not found/u);
});
