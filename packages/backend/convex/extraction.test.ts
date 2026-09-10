import { describe, expect, test, vi } from "vitest";

import {
	extractRoasterNotes,
	isWholesale,
	MAX_PRODUCTS_JSON_PAGES,
	parseHtmlPage,
	parseLotAttributes,
	parseProductsJson,
	PRODUCTS_JSON_PAGE_SIZE,
	SHOPIFY_FETCH_HEADERS,
	shopifyProductsUrl,
	stripHtml,
	walkFeedPages,
} from "./extraction";

interface FeedProduct {
	body_html?: string;
	handle?: string;
	id: number;
	image?: { src?: string } | null;
	images?: { src?: string }[] | null;
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

describe("stripHtml", () => {
	test("strips tags, decodes entities, collapses whitespace", () => {
		expect(
			stripHtml(
				"<p>One of the&nbsp;longest harvest seasons <strong>ever</strong> — &amp; lovely.</p>"
			)
		).toBe("One of the longest harvest seasons ever — & lovely.");
	});

	test("block tags become paragraph breaks", () => {
		expect(
			stripHtml(
				"<h5>We Taste: lemon meringue - lavender - apricot - honey</h5><h5>Light Roast</h5><p>Roasted to order.</p>"
			)
		).toBe(
			"We Taste: lemon meringue - lavender - apricot - honey\nLight Roast\nRoasted to order."
		);
	});
});

describe("parseLotAttributes", () => {
	test("reads the Proud Mary convention", () => {
		expect(
			parseLotAttributes([
				"Coffee",
				"For: Filter",
				"From: Ethiopia",
				"Process: Natural",
			])
		).toEqual({ origin: "Ethiopia", process: "Natural" });
	});

	test("reads the Intelligentsia convention", () => {
		expect(
			parseLotAttributes(["Country: Guatemala", "Roast Level: Bright"])
		).toEqual({ origin: "Guatemala" });
	});

	test("keeps a Roast Level value only when it names an actual roast", () => {
		expect(parseLotAttributes(["Roast Level: Comforting"])).toEqual({});
		expect(parseLotAttributes(["Roast: Light"])).toEqual({
			roastLevel: "Light",
		});
		expect(parseLotAttributes(["Roast: Medium-Light"])).toEqual({
			roastLevel: "Medium-Light",
		});
	});

	test("reads the Onyx convention and a bare process tag", () => {
		expect(parseLotAttributes(["origin:Ethiopia"])).toEqual({
			origin: "Ethiopia",
		});
		expect(parseLotAttributes(["amazing", "Washed", "Wholesale"])).toEqual({
			process: "Washed",
		});
	});

	test("tolerates string tags and noise", () => {
		expect(parseLotAttributes([])).toEqual({});
		expect(parseLotAttributes(["nope", ":", "From:"])).toEqual({});
	});
});

describe("extractRoasterNotes", () => {
	test("reads the Sey prose pattern", () => {
		expect(
			extractRoasterNotes(
				"This encore harvest delivery came as a wonderful surprise. In the cup we find peach, melon, red tea, and lovely florality.",
				[]
			)
		).toBe("peach, melon, red tea, and lovely florality");
	});

	test("reads the Ruby dash list", () => {
		// Ruby's real layout: the descriptor list is its own <h5>; the roast
		// level and info-sheet boilerplate live in separate blocks.
		expect(
			extractRoasterNotes(
				"We Taste: lemon meringue - lavender - apricot - honey\nLight Roast\nDOWNLOAD info sheets",
				[]
			)
		).toBe("lemon meringue - lavender - apricot - honey");
	});

	test("reads notes-of prose and stops at a dash", () => {
		expect(
			extractRoasterNotes(
				"Expect notes of jasmine, stone fruit, blackberry, & winey complexity — a beautiful example.",
				[]
			)
		).toBe("jasmine, stone fruit, blackberry, & winey complexity");
	});

	test("reads flavors-of prose", () => {
		expect(
			extractRoasterNotes(
				"Expect flavors of black currant, ruby grapefruit, and molasses.",
				[]
			)
		).toBe("black currant, ruby grapefruit, and molasses");
	});

	test("falls back to the Flavor Profile tag", () => {
		expect(
			extractRoasterNotes("A comfortable daily brew.", [
				"Country: Brazil",
				"Flavor Profile: Caramel + Stone Fruit",
			])
		).toBe("Caramel + Stone Fruit");
	});

	test("rejects in-the-cup prose without we find/taste", () => {
		// Real Verve copy: "in the cup, with a subtle pine-like character" is
		// narrative, not a descriptor list.
		expect(
			extractRoasterNotes(
				"in the cup, with a subtle pine-like character adding complexity without overwhelming the palate",
				[]
			)
		).toBeNull();
	});

	test("returns null when nothing matches", () => {
		expect(extractRoasterNotes("", [])).toBeNull();
		expect(extractRoasterNotes("Roasted to order.", [])).toBeNull();
	});

	test("caps the matched clause at a word boundary", () => {
		const notes = extractRoasterNotes(
			`In the cup we find ${"words ".repeat(60)}. Then something else.`,
			[]
		);
		expect(notes).not.toBeNull();
		expect(notes?.length).toBeLessThanOrEqual(200);
		expect(notes?.endsWith("words")).toBe(true);
	});
});

describe("parseProductsJson lot copy (§14.4)", () => {
	test("carries description, tags, image, attributes and notes", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(1, {
					body_html:
						"<p>A washed lot from Urrao.</p> In the cup we find peach, melon, and red tea.",
					image: { src: "https://cdn.example.com/lot.png?v=1" },
					tags: ["Coffee", "From: Colombia", "Process: Washed"],
					title: "La Casita",
				}),
			])
		);
		expect(page.products[0]).toEqual({
			description:
				"A washed lot from Urrao. In the cup we find peach, melon, and red tea.",
			externalId: "1",
			handle: "lot-1",
			imageUrl: "https://cdn.example.com/lot.png?v=1",
			name: "La Casita",
			origin: "Colombia",
			process: "Washed",
			roasterNotes: "peach, melon, and red tea",
			tags: ["Coffee", "From: Colombia", "Process: Washed"],
			variants: [
				{ available: true, grams: 250, name: "250g", priceCents: 1800 },
			],
		});
	});

	test("omits every §14.4 field the feed does not carry", () => {
		const page = parseProductsJson(
			feedBody([feedProduct(2, { body_html: "", tags: [] }), feedProduct(3)])
		);
		expect(page.products[0]).toEqual({
			externalId: "2",
			handle: "lot-2",
			name: "Lot 2",
			variants: expect.anything(),
		});
		expect(page.products[1]).not.toHaveProperty("roasterNotes");
	});

	test("reads the first image and comma-string tags", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(4, {
					images: [
						{},
						{ src: "https://cdn.example.com/first.png" },
						{ src: "https://cdn.example.com/second.png" },
					],
					tags: "gift, From: Kenya, Washed",
					title: "Karimikui",
				}),
			])
		);
		expect(page.products[0]).toMatchObject({
			imageUrl: "https://cdn.example.com/first.png",
			origin: "Kenya",
			process: "Washed",
			tags: ["gift", "From: Kenya", "Washed"],
		});
	});

	test("caps the description", () => {
		const page = parseProductsJson(
			feedBody([
				feedProduct(5, { body_html: `<p>${"word ".repeat(2000)}</p>` }),
			])
		);
		const [product] = page.products;
		expect(product?.description?.length).toBeLessThanOrEqual(2000);
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
