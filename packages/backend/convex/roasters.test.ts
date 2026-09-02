/// <reference types="vite/client" />
import { register } from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = async () => {
	const t = convexTest(schema, modules);
	register(t);
	const ids = await t.run(async (ctx) => {
		const active = await ctx.db.insert("roasters", {
			city: "Brooklyn",
			claimed: false,
			domain: "sey.example.com",
			name: "Sey",
			productPageUrl: "https://sey.example.com/collections/coffee",
			slug: "sey",
			source: "curated",
			state: "NY",
			status: "active",
			websiteUrl: "https://sey.example.com",
		});
		const pending = await ctx.db.insert("roasters", {
			city: "Portland",
			claimed: false,
			domain: "pending.example.com",
			name: "Pending",
			productPageUrl: "https://pending.example.com/collections/coffee",
			slug: "pending",
			source: "curated",
			state: "OR",
			status: "pending",
			websiteUrl: "https://pending.example.com",
		});
		await ctx.db.insert("crawlSources", {
			cadenceMinutes: 60,
			consecutiveFailures: 2,
			health: "crawl_failed",
			lastCheckedAt: 1000,
			mode: "products_json",
			nextCrawlDueAt: 3000,
			roasterId: active,
		});
		const user = await ctx.db.insert("users", {
			providerAccountId: "google-123",
		});
		const watchId = await ctx.db.insert("watches", {
			muted: false,
			roasterId: active,
			userId: user,
		});
		return { active, pending, watchId };
	});
	return { ...ids, t };
};

describe("roasters", () => {
	test("listActive returns only active roasters with source health", async () => {
		const { t } = await setup();
		const roasters = await t.query(api.roasters.listActive, {});
		expect(roasters).toHaveLength(1);
		expect(roasters[0]).toMatchObject({
			slug: "sey",
			status: { health: "crawl_failed", lastCheckedAt: 1000 },
		});
	});

	test("getBySlug resolves active roasters and hides others", async () => {
		const { pending, t } = await setup();
		const found = await t.query(api.roasters.getBySlug, { slug: "sey" });
		expect(found).toMatchObject({
			slug: "sey",
			status: { health: "crawl_failed" },
		});
		expect(
			await t.query(api.roasters.getBySlug, { slug: "pending" })
		).toBeNull();
		expect(pending).toBeDefined();
	});
});
