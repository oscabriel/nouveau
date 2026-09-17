/// <reference types="vite/client" />
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { PRODUCT_PAGES_FULL_INTERVAL_MS } from "./constants";
import { eligibleVariant } from "./recommendationCatalog";
import schema from "./schema";
import type { SourceMode } from "./sourceMode";

const modules = import.meta.glob("./**/*.ts");

const SHOP = "https://shop.example.com";
const COLLECTION = `${SHOP}/collections/coffee`;
const T0 = 1_700_000_000_000;

interface Fixture {
	crawlSourceId: Id<"crawlSources">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
}

const setup = async (
	mode: SourceMode,
	sourceFields: Partial<Doc<"crawlSources">> = {}
): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	registerFirecrawl(t);
	const ids = await t.run(async (ctx) => {
		const roaster = await ctx.db.insert("roasters", {
			city: "Madison",
			claimed: false,
			domain: "shop.example.com",
			name: "Example Roasters",
			productPageUrl: COLLECTION,
			slug: "example",
			source: "user-submitted",
			state: "WI",
			status: "pending",
			websiteUrl: SHOP,
		});
		const source = await ctx.db.insert("crawlSources", {
			cadenceMinutes: 60,
			consecutiveFailures: 0,
			health: "watching",
			mode,
			nextCrawlDueAt: T0,
			roasterId: roaster,
			...sourceFields,
		});
		return { roaster, source };
	});
	return { crawlSourceId: ids.source, roasterId: ids.roaster, t };
};

const crawl = (fx: Fixture): Promise<null> =>
	fx.t.action(internal.crawler.crawlSource, {
		crawlSourceId: fx.crawlSourceId,
	});

const readAll = (fx: Fixture) =>
	fx.t.run(async (ctx) => ({
		events: await ctx.db.query("dropEvents").collect(),
		products: await ctx.db.query("products").collect(),
		roaster: await ctx.db.get(fx.roasterId),
		source: await ctx.db.get(fx.crawlSourceId),
		variants: await ctx.db.query("productVariants").collect(),
	}));

const json = (body: unknown, headers: Record<string, string> = {}) =>
	Response.json(body, { headers });

/** A Firecrawl /v2/scrape response body. */
const scraped = (data: Record<string, unknown>) =>
	json({
		data: { metadata: { sourceURL: "", statusCode: 200 }, ...data },
		success: true,
	});

const firecrawlProduct = (
	title: string,
	variants: { inStock: boolean; price: number; size: string }[],
	category: string | null = "Coffee"
) => ({
	category,
	title,
	variants: variants.map((variant) => ({
		availability: { inStock: variant.inStock },
		price: { amount: variant.price, currency: "USD" },
		title: variant.size,
	})),
});

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("woocommerce mode", () => {
	const listing = [
		{
			categories: [{ name: "Coffee" }],
			id: 1,
			is_in_stock: true,
			name: "Daniso Horsa Natural",
			permalink: `${SHOP}/product/daniso/`,
			prices: { currency_code: "USD", currency_minor_unit: 2, price: "3000" },
			slug: "daniso",
		},
		{
			categories: [{ name: "Coffee" }],
			id: 2,
			is_in_stock: true,
			name: "Kenya Karumandi",
			permalink: `${SHOP}/product/karumandi/`,
			prices: {
				currency_code: "USD",
				currency_minor_unit: 2,
				price: "1800",
				price_range: { max_amount: "6500", min_amount: "1800" },
			},
			slug: "karumandi",
			variations: [{ id: 21 }, { id: 22 }],
		},
		{
			categories: [{ name: "Merch" }],
			id: 3,
			is_in_stock: true,
			name: "Tee",
			prices: { currency_code: "USD", currency_minor_unit: 2, price: "2500" },
		},
	];
	const variations = [
		{
			is_in_stock: false,
			prices: { currency_code: "USD", currency_minor_unit: 2, price: "1800" },
			variation: "Size: 12 oz",
		},
		{
			is_in_stock: true,
			prices: { currency_code: "USD", currency_minor_unit: 2, price: "6500" },
			variation: "Size: 5 lb",
		},
	];

	const stubShop = (options: { pageTwoFails?: boolean } = {}) => {
		const fetchMock = vi.fn((url: string) => {
			if (
				url.startsWith(`${SHOP}/wp-json/wc/store/v1/products?type=variation`)
			) {
				return json(variations);
			}
			if (
				url.startsWith(
					`${SHOP}/wp-json/wc/store/v1/products?per_page=100&page=1`
				)
			) {
				return json(listing, {
					"x-wp-totalpages": options.pageTwoFails ? "2" : "1",
				});
			}
			if (url.includes("&page=2")) {
				return new Response("gateway timeout", { status: 504 });
			}
			throw new Error(`Unexpected fetch ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	};

	test("reads the Store API, expands priced sizes, confirms the market from the currency", async () => {
		const fx = await setup("woocommerce");
		stubShop();
		await crawl(fx);
		const { products, roaster, source, variants } = await readAll(fx);

		expect(source?.health).toBe("watching");
		expect(source?.lastSuccessAt).toBe(T0);
		expect(source?.lastFullCrawlAt).toBe(T0);
		expect(source?.market).toEqual({
			confirmedAt: T0,
			country: "US",
			currency: "USD",
			url: SHOP,
		});
		expect(roaster?.status).toBe("active");

		expect(new Set(products.map((p) => `${p.externalId} ${p.url}`))).toEqual(
			new Set([`1 ${SHOP}/product/daniso`, `2 ${SHOP}/product/karumandi`])
		);
		const byProduct = new Map(products.map((p) => [p._id, p.externalId]));
		const named = variants.map(
			(v) =>
				`${byProduct.get(v.productId)}:${v.name}:${v.priceCents}:${v.available}`
		);
		expect(new Set(named)).toEqual(
			new Set(["1:Default:3000:true", "2:12 oz:1800:false", "2:5 lb:6500:true"])
		);
	});

	test("a listing page lost mid-walk fails the crawl and commits nothing", async () => {
		const fx = await setup("woocommerce");
		stubShop({ pageTwoFails: true });
		await crawl(fx);
		const { products, source } = await readAll(fx);
		expect(products).toEqual([]);
		expect(source?.health).toBe("crawl_failed");
		expect(source?.lastErrorMessage).toContain("page 2 unavailable");
	});

	test("a shop without the Store API fails visibly", async () => {
		const fx = await setup("woocommerce");
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Response("<html></html>", { status: 404 }))
		);
		await crawl(fx);
		const { source } = await readAll(fx);
		expect(source?.health).toBe("crawl_failed");
		expect(source?.consecutiveFailures).toBe(1);
	});
});

describe("product_pages mode", () => {
	const A = `${SHOP}/products/kenya-karumandi`;
	const B = `${SHOP}/products/ethiopia-danche`;
	const MUG = `${SHOP}/products/ceramic-mug`;

	interface ShopState {
		changeStatus: string | null;
		links: string[];
		pages: Record<string, unknown>;
	}

	/** Firecrawl answers by the `url` in the scrape request body. */
	const stubFirecrawl = (state: ShopState) => {
		const scrapes: string[] = [];
		const fetchMock = vi.fn((url: string, init?: RequestInit) => {
			if (url.startsWith(`${SHOP}/sitemap`)) {
				return new Response("not found", { status: 404 });
			}
			if (!url.includes("firecrawl")) {
				throw new Error(`Unexpected fetch ${url}`);
			}
			const body = JSON.parse(String(init?.body)) as {
				formats: unknown[];
				url: string;
			};
			scrapes.push(body.url);
			if (body.url === COLLECTION) {
				return scraped({
					changeTracking:
						state.changeStatus === null
							? undefined
							: { changeStatus: state.changeStatus },
					links: state.links,
					markdown: "# Coffee",
				});
			}
			const product = state.pages[body.url];
			return product === undefined
				? scraped({ warning: "No product found on the page." })
				: scraped({ product });
		});
		vi.stubGlobal("fetch", fetchMock);
		return { fetchMock, scrapes };
	};

	const shop = (): ShopState => ({
		changeStatus: "new",
		links: [`${SHOP}/`, `${A}?variant=1`, B, MUG, `${SHOP}/pages/about`],
		pages: {
			[A]: firecrawlProduct("Kenya Karumandi", [
				{ inStock: true, price: 18, size: "250g" },
				{ inStock: true, price: 65, size: "2lb" },
			]),
			[B]: firecrawlProduct("2026 Danche - Ethiopia", [
				{ inStock: true, price: 26.5, size: "250g" },
			]),
			[MUG]: firecrawlProduct(
				"Ceramic Mug",
				[{ inStock: true, price: 20, size: "Default" }],
				"Merch"
			),
		},
	});

	test("baseline: reads the grid's product pages, keeps lots, purges non-lots, fires nothing", async () => {
		const fx = await setup("product_pages");
		const { scrapes } = stubFirecrawl(shop());
		await crawl(fx);
		const { events, products, source, variants } = await readAll(fx);

		expect(scrapes).toEqual([COLLECTION, A, B, MUG]);
		expect(events).toEqual([]);
		expect(new Set(products.map((p) => p.externalId))).toEqual(new Set([A, B]));
		expect(products.find((p) => p.externalId === A)).toMatchObject({
			handle: "kenya-karumandi",
			origin: "Kenya",
			productType: "Coffee",
			url: A,
		});
		expect(new Set(variants.map((v) => `${v.name}:${v.priceCents}`))).toEqual(
			new Set(["250g:1800", "250g:2650", "2lb:6500"])
		);
		expect(source?.market?.currency).toBe("USD");
		expect(source?.lastFullCrawlAt).toBe(T0);
	});

	test("an unchanged grid skips the product scrapes and leaves the catalog alone", async () => {
		const fx = await setup("product_pages");
		const state = shop();
		stubFirecrawl(state);
		await crawl(fx);

		state.changeStatus = "same";
		const { scrapes } = stubFirecrawl(state);
		vi.setSystemTime(T0 + 60 * 60_000);
		await crawl(fx);
		const { products, source, variants } = await readAll(fx);

		expect(scrapes).toEqual([COLLECTION]);
		expect(source?.lastSuccessAt).toBe(T0 + 60 * 60_000);
		expect(source?.lastFullCrawlAt).toBe(T0);
		expect(source?.health).toBe("watching");
		// No archive strikes for lots that were not read.
		expect(products.every((p) => (p.missedCrawls ?? 0) === 0)).toBe(true);

		// The skip vouches for the last full read: the lots it observed stay
		// recommendable even though lastSuccessAt moved on.
		const lot = products.find((p) => p.externalId === A);
		const bag = variants.find(
			(v) => v.productId === lot?._id && v.name === "250g"
		);
		expect(lot && bag && source).toBeTruthy();
		if (lot && bag && source) {
			expect(
				eligibleVariant(
					lot,
					bag,
					source,
					{
						includeNotes: false,
						logIds: [],
						maxPriceCents: 3000,
						minGrams: 200,
						preferences: "",
					},
					T0 + 60 * 60_000
				)
			).toBe(true);
		}
	});

	test("a changed grid re-reads every page and fires the drop events", async () => {
		const fx = await setup("product_pages");
		const state = shop();
		stubFirecrawl(state);
		await crawl(fx);

		state.changeStatus = "changed";
		state.pages[A] = firecrawlProduct("Kenya Karumandi", [
			{ inStock: false, price: 18, size: "250g" },
			{ inStock: true, price: 60, size: "2lb" },
		]);
		stubFirecrawl(state);
		vi.setSystemTime(T0 + 60 * 60_000);
		await crawl(fx);
		const { events } = await readAll(fx);
		expect(new Set(events.map((e) => e.type))).toEqual(
			new Set(["price_drop", "sold_out"])
		);
		expect(events.length).toBe(2);
	});

	test("an unchanged grid still gets a full read once the interval has passed, and reads known lots that left the grid", async () => {
		const fx = await setup("product_pages");
		const state = shop();
		stubFirecrawl(state);
		await crawl(fx);

		// B leaves the grid and its page goes away; the catalog still asks
		// for it, and the missing page counts as a strike.
		state.changeStatus = "same";
		state.links = [`${A}?variant=1`, MUG];
		state.pages = { [A]: state.pages[A], [MUG]: state.pages[MUG] };
		const { scrapes } = stubFirecrawl(state);
		vi.setSystemTime(T0 + PRODUCT_PAGES_FULL_INTERVAL_MS);
		await crawl(fx);
		const { products, source } = await readAll(fx);

		expect(scrapes).toEqual([COLLECTION, A, MUG, B]);
		expect(source?.lastFullCrawlAt).toBe(T0 + PRODUCT_PAGES_FULL_INTERVAL_MS);
		expect(products.find((p) => p.externalId === B)?.missedCrawls).toBe(1);
	});

	test("without change tracking the grid is treated as changed", async () => {
		const fx = await setup("product_pages", {
			lastFullCrawlAt: T0,
			lastSuccessAt: T0,
		});
		const state = shop();
		state.changeStatus = null;
		const { scrapes } = stubFirecrawl(state);
		await crawl(fx);
		expect(scrapes.length).toBe(4);
	});

	test("pages with no structured product data fail the crawl visibly", async () => {
		const fx = await setup("product_pages");
		const state = shop();
		state.pages = {};
		stubFirecrawl(state);
		await crawl(fx);
		const { source } = await readAll(fx);
		expect(source?.health).toBe("crawl_failed");
		expect(source?.lastErrorMessage).toContain("no structured product data");
	});

	test("an unreachable collection page fails the crawl", async () => {
		const fx = await setup("product_pages");
		// A 400 is not retried by the component; the scrape throws.
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Response.json({ error: "bad request", success: false }, { status: 400 })
			)
		);
		await crawl(fx);
		const { source } = await readAll(fx);
		expect(source?.health).toBe("crawl_failed");
		expect(source?.lastErrorMessage).toContain("collection page unavailable");
	});
});

describe("detectSourceMode", () => {
	test("runs the ladder and stores the mode it lands on", async () => {
		const fx = await setup("products_json");
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) => {
				if (url.startsWith(`${SHOP}/wp-json/wc/store/v1/products`)) {
					return json([
						{
							categories: [{ name: "Coffee" }],
							id: 1,
							is_in_stock: true,
							name: "Kenya Karumandi",
							prices: {
								currency_code: "USD",
								currency_minor_unit: 2,
								price: "1800",
							},
						},
					]);
				}
				return new Response("not found", { status: 404 });
			})
		);
		const mode = await fx.t.action(internal.crawler.detectSourceMode, {
			crawlSourceId: fx.crawlSourceId,
		});
		expect(mode).toBe("woocommerce");
		const { source } = await readAll(fx);
		expect(source?.mode).toBe("woocommerce");
	});

	test("moves the roaster to www when that host answered", async () => {
		const fx = await setup("product_pages");
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) => {
				if (url.startsWith("https://www.shop.example.com/products.json")) {
					return json({
						products: [
							{
								id: 1,
								product_type: "Coffee",
								title: "Kenya",
								variants: [{ available: true, price: "18.00", title: "250g" }],
							},
						],
					});
				}
				return new Response("not found", { status: 404 });
			})
		);
		const mode = await fx.t.action(internal.crawler.detectSourceMode, {
			crawlSourceId: fx.crawlSourceId,
		});
		expect(mode).toBe("products_json");
		const { roaster } = await readAll(fx);
		expect(roaster?.websiteUrl).toBe("https://www.shop.example.com");
	});
});
