/// <reference types="vite/client" />
import { register as registerAggregate } from "@convex-dev/aggregate/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import { MAX_ACTIVE_SUBMISSIONS_PER_USER } from "./constants";
import schema from "./schema";
import { normalizeShopUrl } from "./submissions";
import { asUser } from "./test.helpers";

const modules = import.meta.glob("./**/*.ts");
const T0 = 1_700_000_000_000;
const SHOP = "https://jbc.example.com";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

const setup = async () => {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	registerAggregate(t);
	registerFirecrawl(t);
	const userId = await t.run((ctx) =>
		ctx.db.insert("users", { providerAccountId: "google-1" })
	);
	return { t, user: asUser(t, userId), userId };
};

const json = (body: unknown, headers: Record<string, string> = {}) =>
	Response.json(body, { headers });

/** A WooCommerce shop: no Shopify feed, a Store API with one coffee. */
const stubWooShop = () => {
	const fetchMock = vi.fn((url: string) => {
		if (url.includes("/products.json")) {
			return new Response("not found", { status: 404 });
		}
		if (url.startsWith(`${SHOP}/wp-json/wc/store/v1/products?per_page=100`)) {
			return json(
				[
					{
						categories: [{ name: "Coffee" }],
						id: 1,
						is_in_stock: true,
						name: "Daniso Horsa Natural",
						permalink: `${SHOP}/product/daniso/`,
						prices: {
							currency_code: "USD",
							currency_minor_unit: 2,
							price: "3000",
						},
						slug: "daniso",
					},
				],
				{ "x-wp-totalpages": "1" }
			);
		}
		throw new Error(`Unexpected fetch ${url}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
};

/** A shop that is down: every request fails. */
const stubDeadShop = () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(() => {
			throw new TypeError("fetch failed");
		})
	);
};

const jbc = {
	city: "Madison",
	name: "JBC Coffee Roasters",
	state: "wi",
	url: "jbc.example.com/shop/?orderby=date",
};

describe("normalizeShopUrl", () => {
	test("bare domain, path kept, query dropped, https forced", () => {
		expect(normalizeShopUrl(jbc.url)).toEqual({
			domain: "jbc.example.com".split(".").slice(-2).join("."),
			productPageUrl: `${SHOP}/shop`,
			slug: "example",
			websiteUrl: SHOP,
		});
		expect(normalizeShopUrl("http://www.Onyx.example/")).toMatchObject({
			domain: "onyx.example",
			productPageUrl: "https://www.onyx.example",
			websiteUrl: "https://www.onyx.example",
		});
	});

	test("rejects junk", () => {
		expect(normalizeShopUrl("")).toBeNull();
		expect(normalizeShopUrl("localhost")).toBeNull();
		expect(normalizeShopUrl("ftp://shop.example.com")).toBeNull();
		expect(normalizeShopUrl("https://user:pw@shop.example.com")).toBeNull();
	});
});

describe("submit (§7.1)", () => {
	test("requires sign-in", async () => {
		const { t } = await setup();
		await expect(t.mutation(api.submissions.submit, jbc)).rejects.toThrow(
			"Sign in required"
		);
	});

	test("invalid input is reported, not thrown", async () => {
		const { user } = await setup();
		expect(
			await user.mutation(api.submissions.submit, { ...jbc, url: "x" })
		).toEqual({ status: "invalid" });
		expect(
			await user.mutation(api.submissions.submit, { ...jbc, state: "Wisc" })
		).toEqual({ status: "invalid" });
	});

	test("probes the shop, baselines it, flips it active and watches it for the submitter", async () => {
		const { t, user, userId } = await setup();
		stubWooShop();

		const result = await user.mutation(api.submissions.submit, jbc);
		expect(result.status).toBe("submitted");
		if (result.status !== "submitted") {
			return;
		}

		// Pending right away, with a source the tick will not claim yet.
		let [mine] = await user.query(api.submissions.mine, {});
		expect(mine).toMatchObject({
			name: "JBC Coffee Roasters",
			slug: "example",
			state: "WI",
			status: "pending",
			websiteUrl: SHOP,
		});

		await t.finishAllScheduledFunctions(vi.runAllTimers);

		[mine] = await user.query(api.submissions.mine, {});
		expect(mine).toMatchObject({
			lastError: null,
			mode: "woocommerce",
			status: "active",
		});
		expect(mine?.crawl.health).toBe("watching");
		const { products, watches } = await t.run(async (ctx) => ({
			products: await ctx.db.query("products").collect(),
			watches: await ctx.db.query("watches").collect(),
		}));
		expect(products.map((p) => p.name)).toEqual(["Daniso Horsa Natural"]);
		expect(watches).toHaveLength(1);
		expect(watches[0]).toMatchObject({
			roasterId: result.roasterId,
			userId,
		});
		// Now in the directory.
		const active = await t.query(api.roasters.listActive, {});
		expect(active.map((r) => r.slug)).toEqual(["example"]);
	});

	test("a domain already in the directory short-circuits to a watch", async () => {
		const { t, user, userId } = await setup();
		const roasterId = await t.run((ctx) =>
			ctx.db.insert("roasters", {
				city: "Madison",
				claimed: false,
				domain: "example.com",
				name: "JBC",
				productPageUrl: `${SHOP}/shop`,
				slug: "example",
				source: "curated",
				state: "WI",
				status: "active",
				websiteUrl: SHOP,
			})
		);
		expect(
			await user.mutation(api.submissions.submit, {
				...jbc,
				url: "https://shop.example.com/collections/all",
			})
		).toEqual({ slug: "example", status: "already" });
		const watches = await t.run((ctx) => ctx.db.query("watches").collect());
		expect(watches).toMatchObject([{ roasterId, userId }]);
		const roasters = await t.run((ctx) => ctx.db.query("roasters").collect());
		expect(roasters).toHaveLength(1);
	});

	test("a shop that cannot be read is a visible failure the submitter can retry", async () => {
		const { t, user } = await setup();
		stubDeadShop();
		const result = await user.mutation(api.submissions.submit, jbc);
		expect(result.status).toBe("submitted");
		if (result.status !== "submitted") {
			return;
		}
		await t.finishAllScheduledFunctions(vi.runAllTimers);

		let [mine] = await user.query(api.submissions.mine, {});
		expect(mine?.status).toBe("pending");
		expect(mine?.crawl.health).toBe("crawl_failed");
		expect(mine?.lastError).toMatch(/collection page unavailable/u);
		expect(await t.query(api.roasters.listActive, {})).toEqual([]);

		// The shop comes back; the retry re-probes and lands on WooCommerce.
		stubWooShop();
		expect(
			await user.mutation(api.submissions.retry, {
				roasterId: result.roasterId,
			})
		).toEqual({ status: "started" });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		[mine] = await user.query(api.submissions.mine, {});
		expect(mine).toMatchObject({ mode: "woocommerce", status: "active" });
	});

	test("only the submitter may retry, and only while pending", async () => {
		const { t, user } = await setup();
		stubDeadShop();
		const result = await user.mutation(api.submissions.submit, jbc);
		if (result.status !== "submitted") {
			throw new Error(result.status);
		}
		const otherId = await t.run((ctx) =>
			ctx.db.insert("users", { providerAccountId: "google-2" })
		);
		await expect(
			asUser(t, otherId).mutation(api.submissions.retry, {
				roasterId: result.roasterId,
			})
		).rejects.toThrow("Not a pending submission of yours");
	});

	test("quotas: three a day, five pending or active", async () => {
		const { t, user, userId } = await setup();
		stubDeadShop();
		// Sequential on purpose: the quota is per call, in order.
		const submitN = async (
			n: number,
			prefix: string,
			i = 0
		): Promise<string[]> => {
			if (i >= n) {
				return [];
			}
			const result = await user.mutation(api.submissions.submit, {
				...jbc,
				url: `https://${prefix}${i}.example/`,
			});
			return [result.status, ...(await submitN(n, prefix, i + 1))];
		};
		expect(await submitN(4, "roaster")).toEqual([
			"submitted",
			"submitted",
			"submitted",
			"limited",
		]);
		expect(await user.query(api.submissions.quota, {})).toEqual({
			activeLeft: MAX_ACTIVE_SUBMISSIONS_PER_USER - 3,
			todayOk: false,
		});

		// Backdate the daily window; the active cap still holds at five.
		vi.setSystemTime(T0 + 25 * 60 * 60_000);
		const more = await t.run((ctx) =>
			Promise.all(
				(["active", "rejected"] as const).map((status, i) =>
					ctx.db.insert("roasters", {
						city: "X",
						claimed: false,
						domain: `extra${i}.example`,
						name: `Extra ${i}`,
						productPageUrl: `https://extra${i}.example`,
						slug: `extra${i}`,
						source: "user-submitted",
						state: "WI",
						status,
						submittedByUserId: userId,
						websiteUrl: `https://extra${i}.example`,
					})
				)
			)
		);
		expect(more).toHaveLength(2);
		// 3 pending + 1 active = 4 counting; the rejected one does not.
		expect(await user.query(api.submissions.quota, {})).toMatchObject({
			activeLeft: 1,
			todayOk: true,
		});
		expect(await submitN(2, "later")).toEqual(["submitted", "quota"]);
	});
});
