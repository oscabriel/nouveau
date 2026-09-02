/// <reference types="vite/client" />
import { register } from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	roasterA: Id<"roasters">;
	roasterB: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
	user: Id<"users">;
}

const T0 = 1_700_000_000_000;

const setup = async (): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	register(t);
	const ids = await t.run(async (ctx) => {
		const insertRoaster = (name: string, domain: string) =>
			ctx.db.insert("roasters", {
				city: "Portland",
				claimed: false,
				domain,
				name,
				productPageUrl: `https://${domain}/collections/coffee`,
				slug: domain.replace(/\.[^.]+$/u, ""),
				source: "curated",
				state: "OR",
				status: "active",
				websiteUrl: `https://${domain}`,
			});
		const a = await insertRoaster("Onyx", "onyx.example.com");
		const b = await insertRoaster("Sey", "sey.example.com");
		const user = await ctx.db.insert("users", {
			providerAccountId: "google-123",
		});
		const sources = [
			[a, "stale"],
			[b, "watching"],
		] as const;
		for (const [roasterId, health] of sources) {
			// eslint-disable-next-line no-await-in-loop
			await ctx.db.insert("crawlSources", {
				cadenceMinutes: 60,
				consecutiveFailures: 0,
				health,
				lastCheckedAt: T0,
				lastSuccessAt: T0,
				mode: "products_json",
				nextCrawlDueAt: T0,
				roasterId,
			});
		}
		return { a, b, user };
	});
	return { roasterA: ids.a, roasterB: ids.b, t, user: ids.user };
};

const addProduct = (
	t: ReturnType<typeof convexTest>,
	roasterId: Id<"roasters">
): Promise<Id<"products">> =>
	t.run((ctx) =>
		ctx.db.insert("products", {
			externalId: "gid://shopify/Product/1",
			firstSeenAt: T0,
			handle: "ethiopia-mullugeta",
			lastSeenAt: T0,
			name: "Ethiopia Mullugeta Natural",
			roasterId,
			status: "current",
		})
	);

const addEvent = (
	t: ReturnType<typeof convexTest>,
	fields: {
		detectedAt: number;
		productId: Id<"products">;
		roasterId: Id<"roasters">;
		type: Doc<"dropEvents">["type"];
	}
): Promise<Id<"dropEvents">> =>
	t.run((ctx) =>
		ctx.db.insert("dropEvents", {
			detectedAt: fields.detectedAt,
			newPriceCents: 3500,
			oldPriceCents: fields.type === "price_drop" ? 4000 : undefined,
			productId: fields.productId,
			roasterId: fields.roasterId,
			type: fields.type,
		})
	);

describe("globalFeed", () => {
	test("returns only alert-worthy events, newest first, with lot links", async () => {
		const { roasterA, t } = await setup();
		const productId = await addProduct(t, roasterA);
		await addEvent(t, {
			detectedAt: T0 + 1,
			productId,
			roasterId: roasterA,
			type: "new",
		});
		await addEvent(t, {
			detectedAt: T0 + 3,
			productId,
			roasterId: roasterA,
			type: "price_drop",
		});
		// Stored silently, never surfaced in feeds.
		await addEvent(t, {
			detectedAt: T0 + 2,
			productId,
			roasterId: roasterA,
			type: "sold_out",
		});
		await addEvent(t, {
			detectedAt: T0 + 4,
			productId,
			roasterId: roasterA,
			type: "price_rise",
		});

		const feed = await t.query(api.feed.globalFeed, {});
		expect(feed.map((card) => card.type)).toEqual(["price_drop", "new"]);
		expect(feed[0]).toMatchObject({
			lotUrl: "https://onyx.example.com/products/ethiopia-mullugeta",
			newPriceCents: 3500,
			oldPriceCents: 4000,
			roasterName: "Onyx",
		});
	});

	test("respects the limit", async () => {
		const { roasterA, t } = await setup();
		const productId = await addProduct(t, roasterA);
		const events = [0, 1, 2, 3, 4].map((i) =>
			addEvent(t, {
				detectedAt: T0 + i,
				productId,
				roasterId: roasterA,
				type: "new",
			})
		);
		await Promise.all(events);
		const feed = await t.query(api.feed.globalFeed, { limit: 2 });
		expect(feed).toHaveLength(2);
		const [newest] = feed;
		expect(newest?.detectedAt).toBe(T0 + 4);
	});
});

describe("roasterFeed", () => {
	test("only shows the requested roaster's alert-worthy events", async () => {
		const { roasterA, roasterB, t } = await setup();
		const productA = await addProduct(t, roasterA);
		const productB = await addProduct(t, roasterB);
		await addEvent(t, {
			detectedAt: T0 + 1,
			productId: productA,
			roasterId: roasterA,
			type: "new",
		});
		await addEvent(t, {
			detectedAt: T0 + 2,
			productId: productB,
			roasterId: roasterB,
			type: "back_in_stock",
		});
		const feed = await t.query(api.feed.roasterFeed, { roasterId: roasterB });
		expect(feed).toHaveLength(1);
		expect(feed[0]).toMatchObject({
			roasterName: "Sey",
			type: "back_in_stock",
		});
	});
});

describe("personalizedFeed", () => {
	test("signed-out callers get an empty feed", async () => {
		const { t } = await setup();
		expect(await t.query(api.feed.personalizedFeed, {})).toEqual([]);
	});

	test("only includes watched roasters, with delivery status from the ledger", async () => {
		const { roasterA, roasterB, t, user } = await setup();
		const productA = await addProduct(t, roasterA);
		const productB = await addProduct(t, roasterB);
		const watchedEvent = await addEvent(t, {
			detectedAt: T0 + 1,
			productId: productA,
			roasterId: roasterA,
			type: "new",
		});
		await addEvent(t, {
			detectedAt: T0 + 2,
			productId: productB,
			roasterId: roasterB,
			type: "new",
		});
		await asUser(t, user).mutation(api.watches.watchRoaster, {
			roasterId: roasterA,
		});

		const caller = asUser(t, user);
		let feed = await caller.query(api.feed.personalizedFeed, {});
		expect(feed).toHaveLength(1);
		expect(feed[0]?.deliveryStatus).toBeNull();

		await t.run((ctx) =>
			ctx.db.insert("notifications", {
				deliveryStatus: "delivered",
				dropEventId: watchedEvent,
				sentAt: T0 + 5,
				userId: user,
			})
		);
		feed = await caller.query(api.feed.personalizedFeed, {});
		expect(feed[0]?.deliveryStatus).toBe("delivered");
	});
});

describe("unhealthyWatches", () => {
	test("lists watched roasters whose source is not watching", async () => {
		const { roasterA, roasterB, t, user } = await setup();
		const caller = asUser(t, user);
		await caller.mutation(api.watches.watchRoaster, { roasterId: roasterA });
		await caller.mutation(api.watches.watchRoaster, { roasterId: roasterB });
		const unhealthy = await caller.query(api.feed.unhealthyWatches, {});
		expect(unhealthy).toHaveLength(1);
		expect(unhealthy[0]).toMatchObject({
			name: "Onyx",
			status: { health: "stale" },
		});
	});
});
