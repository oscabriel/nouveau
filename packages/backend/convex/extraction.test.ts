import { describe, expect, test, vi } from "vitest";

import {
	isWholesale,
	MAX_PRODUCTS_JSON_PAGES,
	parseHtmlPage,
	parseProductsJson,
	PRODUCTS_JSON_PAGE_SIZE,
	SHOPIFY_FETCH_HEADERS,
	shopifyProductsUrl,
	walkFeedPages,
} from "./extraction";

interface FeedProduct {
	handle?: string;
	id: number;
	product_type?: string;
	tags?: string[] | string;
	title?: string;
	variants?: {
		available?: boolean | null;
		grams?: number | null;
		price?: string | number;
		title?: string;
	}[];
}

const feedProduct = (
	id: number,
	extra: Partial<FeedProduct> = {}
): FeedProduct => ({
	handle: `lot-${id}`,
	id,
	title: `Lot ${id}`,
	variants: [{ available: true, grams: 250, price: "18.00", title: "250g" }],
	...extra,
});

const feedBody = (products: FeedProduct[]): string =>
	JSON.stringify({ products });

const fullPage = (startId: number): string =>
	feedBody(
		Array.from({ length: PRODUCTS_JSON_PAGE_SIZE }, (_, i) =>
			feedProduct(startId + i)
		)
	);

describe("shopifyProductsUrl", () => {
	test("targets the shop origin with the page size and page number", () => {
		expect(shopifyProductsUrl("https://shop.example.com/collections/all")).toBe(
			"https://shop.example.com/products.json?limit=250&page=1"
		);
		expect(shopifyProductsUrl("https://shop.example.com", 3)).toBe(
			"https://shop.example.com/products.json?limit=250&page=3"
		);
	});
});

describe("SHOPIFY_FETCH_HEADERS", () => {
	test("pins the US market so Shopify Markets cannot convert prices", () => {
		expect(SHOPIFY_FETCH_HEADERS.cookie).toBe("localization=US");
		expect(SHOPIFY_FETCH_HEADERS.accept).toBe("application/json");
	});
});

describe("isWholesale", () => {
	test("matches product_type", () => {
		expect(isWholesale("Wholesale Coffee", [])).toBe(true);
		expect(isWholesale("Coffee", [])).toBe(false);
	});

	test("matches array tags case-insensitively", () => {
		expect(isWholesale("Coffee", ["single-origin", "WHOLESALE"])).toBe(true);
	});

	test("matches comma-separated string tags", () => {
		expect(isWholesale("Coffee", "single-origin, wholesale only")).toBe(true);
		expect(isWholesale("Coffee", "single-origin, retail")).toBe(false);
	});

	test("treats missing fields as retail", () => {
		expect(isWholesale(null, null)).toBe(false);
	});
});

describe("parseProductsJson", () => {
	test("throws on a body that is not a products feed", () => {
		expect(() => parseProductsJson('{"collections":[]}')).toThrow(TypeError);
		expect(() => parseProductsJson("<html></html>")).toThrow();
	});

	test("maps products and variants, converting prices to cents", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1, {
					variants: [
						{ available: true, grams: 340, price: "19.50", title: "12oz" },
						{ available: false, grams: null, price: 64, title: "5lb" },
						{ available: null, price: "n/a" },
					],
				}),
			])
		);
		expect(page.feedCount).toBe(1);
		expect(page.products).toEqual([
			{
				externalId: "1",
				handle: "lot-1",
				name: "Lot 1",
				variants: [
					{ available: true, grams: 340, name: "12oz", priceCents: 1950 },
					{ available: false, name: "5lb", priceCents: 6400 },
					{ available: false, name: "Default", priceCents: 0 },
				],
			},
		]);
	});

	test("falls back to the handle as externalId when the id is missing", () => {
		const page = parseProductsJson(
			JSON.stringify({ products: [{ handle: "no-id", title: "No Id" }] })
		);
		expect(page.products[0]).toMatchObject({
			externalId: "no-id",
			variants: [],
		});
	});

	test("filters wholesale SKUs but reports the raw feed count", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1),
				feedProduct(2, { product_type: "Wholesale" }),
				feedProduct(3, { tags: ["wholesale"] }),
				feedProduct(4, { tags: "gift, Wholesale-only" }),
			])
		);
		expect(page.feedCount).toBe(4);
		expect(page.products.map((p) => p.externalId)).toEqual(["1"]);
	});
});

describe("walkFeedPages", () => {
	const websiteUrl = "https://shop.example.com";

	test("stops after a first page that is not full", async () => {
		const fetchPage = vi.fn(() => Promise.resolve<string | null>(null));
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(feedBody([feedProduct(1)])),
			websiteUrl,
		});
		expect(fetchPage).not.toHaveBeenCalled();
		expect(result).toEqual({
			pageError: null,
			products: [expect.objectContaining({ externalId: "1" })],
		});
	});

	test("walks sequential pages while the raw feed is full", async () => {
		const pages: Record<string, string> = {
			[shopifyProductsUrl(websiteUrl, 2)]: fullPage(251),
			[shopifyProductsUrl(websiteUrl, 3)]: feedBody([feedProduct(501)]),
		};
		const fetchPage = vi.fn((url: string) =>
			Promise.resolve(pages[url] ?? null)
		);
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(fetchPage.mock.calls.map(([url]) => url)).toEqual([
			shopifyProductsUrl(websiteUrl, 2),
			shopifyProductsUrl(websiteUrl, 3),
		]);
		expect(result.pageError).toBeNull();
		expect(result.products).toHaveLength(501);
	});

	test("uses the raw feed count, not the filtered count, to continue", async () => {
		// Page 1 is full in the feed but every product is wholesale.
		const wholesaleFirst = feedBody(
			Array.from({ length: PRODUCTS_JSON_PAGE_SIZE }, (_, i) =>
				feedProduct(i + 1, { product_type: "Wholesale" })
			)
		);
		const firstPage = parseProductsJson(wholesaleFirst);
		expect(firstPage.products).toHaveLength(0);
		const fetchPage = vi.fn(() =>
			Promise.resolve(feedBody([feedProduct(999)]))
		);
		const result = await walkFeedPages({ fetchPage, firstPage, websiteUrl });
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(result.products.map((p) => p.externalId)).toEqual(["999"]);
	});

	test("merges duplicate externalIds across pages (last wins)", async () => {
		const fetchPage = vi.fn(() =>
			Promise.resolve(feedBody([feedProduct(1, { title: "Lot 1 (renamed)" })]))
		);
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(result.products).toHaveLength(PRODUCTS_JSON_PAGE_SIZE);
		expect(result.products.find((p) => p.externalId === "1")?.name).toBe(
			"Lot 1 (renamed)"
		);
	});

	test("discards the whole catalog when a later page is unavailable", async () => {
		const fetchPage = vi.fn(() => Promise.resolve<string | null>(null));
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(result).toEqual({
			pageError: "products.json page 2 unavailable; partial catalog discarded",
			products: [],
		});
	});

	test("discards the whole catalog when a later page is not a feed", async () => {
		const fetchPage = vi.fn(() => Promise.resolve("<html>blocked</html>"));
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(result.pageError).toContain("page 2 unavailable");
		expect(result.products).toEqual([]);
	});

	test("caps the walk at MAX_PRODUCTS_JSON_PAGES and warns when still full", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fetchPage = vi.fn((url: string) => {
			const page = Number(new URL(url).searchParams.get("page"));
			return Promise.resolve(
				fullPage((page - 1) * PRODUCTS_JSON_PAGE_SIZE + 1)
			);
		});
		const result = await walkFeedPages({
			fetchPage,
			firstPage: parseProductsJson(fullPage(1)),
			websiteUrl,
		});
		expect(fetchPage).toHaveBeenCalledTimes(MAX_PRODUCTS_JSON_PAGES - 1);
		expect(result.products).toHaveLength(
			MAX_PRODUCTS_JSON_PAGES * PRODUCTS_JSON_PAGE_SIZE
		);
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});

describe("parseHtmlPage", () => {
	const pageUrl = "https://roaster.example.com/shop/";

	test("returns nothing for a non-matching extraction", () => {
		expect(parseHtmlPage(null, pageUrl)).toEqual([]);
		expect(parseHtmlPage({ products: "nope" }, pageUrl)).toEqual([]);
	});

	test("drops items without a name", () => {
		expect(
			parseHtmlPage(
				{ products: [{ name: "", price: 1 }, { price: 2 }] },
				pageUrl
			)
		).toEqual([]);
	});

	test("keys URL-bearing items on their URL", () => {
		const [product] = parseHtmlPage(
			{
				products: [
					{
						available: false,
						grams: 250,
						name: "Kiamabara",
						price: 22.5,
						url: "https://roaster.example.com/products/kiamabara",
					},
				],
			},
			pageUrl
		);
		expect(product).toEqual({
			externalId: "https://roaster.example.com/products/kiamabara",
			handle: "kiamabara",
			name: "Kiamabara",
			variants: [
				{ available: false, grams: 250, name: "Default", priceCents: 2250 },
			],
		});
	});

	test("keys URL-less items on page + name so they do not collapse", () => {
		const products = parseHtmlPage(
			{
				products: [
					{ name: "Lot A", price: 18 },
					{ name: "Lot B", price: 20 },
				],
			},
			pageUrl
		);
		expect(products.map((p) => p.externalId)).toEqual([
			"https://roaster.example.com/shop#Lot A",
			"https://roaster.example.com/shop#Lot B",
		]);
		expect(products.every((p) => p.handle === "shop")).toBe(true);
	});

	test("defaults availability to true and price to 0", () => {
		const [product] = parseHtmlPage({ products: [{ name: "Lot" }] }, pageUrl);
		expect(product?.variants[0]).toEqual({
			available: true,
			name: "Default",
			priceCents: 0,
		});
	});
});
