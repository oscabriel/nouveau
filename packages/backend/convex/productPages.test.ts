import { describe, expect, test } from "vitest";

import { bareProductUrl } from "./lotUrl";
import {
	isProductUrl,
	parseProductPage,
	productSitemaps,
	productUrlsFromLinks,
	sitemapLocations,
} from "./productPages";
import type { FirecrawlProduct } from "./productPages";

const SHOP = "https://onyx.example.com";
const PAGE = `${SHOP}/products/kenya-kamunyaka-aa`;

/** The shape Firecrawl's product format returned for Onyx on 2026-09-16. */
const onyx = (overrides: Partial<FirecrawlProduct> = {}): FirecrawlProduct => ({
	brand: "Onyx Coffee Lab",
	category: "Coffee",
	description:
		"<p>This AA separation comes from Kamunyaka. We taste blackcurrant, grapefruit, and brown sugar.</p>",
	title: "Kenya Kamunyaka AA",
	url: `${PAGE}?variant=43286232629346`,
	variants: [
		{
			availability: { inStock: true, text: "In stock" },
			id: "1",
			images: [{ url: "https://cdn.example.com/kenya.webp" }],
			price: { amount: 7, currency: "USD", formatted: "$7.00" },
			sku: "KE-KKA-2OZ",
			title: "2oz",
			values: { size: "2oz" },
		},
		{
			availability: { inStock: false, text: "Sold out" },
			id: "2",
			price: { amount: 26, currency: "USD", formatted: "$26.00" },
			title: "10oz",
			values: { size: "10oz" },
		},
	],
	...overrides,
});

describe("parseProductPage", () => {
	test("maps a product page to a lot keyed by the bare page URL", () => {
		const parsed = parseProductPage(onyx(), `${PAGE}?variant=1`);
		expect(parsed.rejected).toBe(false);
		expect(parsed.currencies).toEqual(["USD"]);
		expect(parsed.product).toMatchObject({
			externalId: PAGE,
			handle: "kenya-kamunyaka-aa",
			name: "Kenya Kamunyaka AA",
			url: PAGE,
			variants: [
				{ available: true, grams: 57, name: "2oz", priceCents: 700 },
				{ available: false, grams: 283, name: "10oz", priceCents: 2600 },
			],
		});
		expect(parsed.product?.lotCopy).toMatchObject({
			imageUrl: "https://cdn.example.com/kenya.webp",
			origin: "Kenya",
			productType: "Coffee",
			roasterNotes: ["blackcurrant", "grapefruit", "brown sugar"],
		});
	});

	test("names a variant by its option values when it has no title", () => {
		const parsed = parseProductPage(
			onyx({
				variants: [
					{
						availability: { inStock: true },
						price: { amount: 30 },
						values: { grind: "Whole Bean", size: "12 oz" },
					},
				],
			}),
			PAGE
		);
		expect(parsed.product?.variants).toEqual([
			{
				available: true,
				grams: 340,
				name: "Whole Bean / 12 oz",
				priceCents: 3000,
			},
		]);
		expect(parsed.currencies).toEqual([]);
	});

	test("a page's category decides like a Shopify product_type", () => {
		const merch = parseProductPage(
			onyx({ category: "Merch > Apparel", title: "Kenya Tee" }),
			`${SHOP}/products/kenya-tee`
		);
		expect(merch).toEqual({ currencies: [], product: null, rejected: true });
	});

	test("an untyped title that names a hard good is rejected, a coffee name is kept", () => {
		const mug = parseProductPage(
			onyx({ category: null, title: "Ceramic Mug" }),
			`${SHOP}/products/mug`
		);
		expect(mug.rejected).toBe(true);
		const lot = parseProductPage(
			onyx({ category: null, title: "Ethiopia Sidamo Shoye Washed" }),
			`${SHOP}/products/shoye`
		);
		expect(lot.product?.name).toBe("Ethiopia Sidamo Shoye Washed");
		// An untyped, place-less name gets the benefit of the doubt (rule default).
		const bare = parseProductPage(
			onyx({ category: null, title: "Dog Days" }),
			`${SHOP}/products/dog-days`
		);
		expect(bare.product?.name).toBe("Dog Days");
	});

	test("no product, no title or no priced variant is unreadable, not rejected", () => {
		const none = { currencies: [], product: null, rejected: false };
		expect(parseProductPage(undefined, PAGE)).toEqual(none);
		expect(parseProductPage(onyx({ title: "" }), PAGE)).toEqual(none);
		expect(
			parseProductPage(
				onyx({ variants: [{ availability: { inStock: true } }] }),
				PAGE
			)
		).toEqual(none);
		expect(parseProductPage(onyx(), "not a url")).toEqual(none);
	});
});

describe("product URL discovery", () => {
	test("bareProductUrl drops query, hash and trailing slash", () => {
		expect(bareProductUrl(`${PAGE}/?Size=250%20g#top`)).toBe(PAGE);
		expect(bareProductUrl("ftp://x/y")).toBeNull();
		expect(bareProductUrl("nope")).toBeNull();
	});

	test("productSitemaps skips a malformed <loc> instead of throwing", () => {
		expect(
			productSitemaps([
				"not a url.xml",
				"https://shop.example/product-sitemap.xml",
				"https://shop.example/post-sitemap.xml",
			])
		).toEqual(["https://shop.example/product-sitemap.xml"]);
	});

	test("isProductUrl accepts Shopify and WooCommerce product paths on the shop's host", () => {
		expect(isProductUrl(`${SHOP}/products/a`, SHOP)).toBe(true);
		expect(isProductUrl(`${SHOP}/product/a/`, SHOP)).toBe(true);
		expect(isProductUrl(`https://www.onyx.example.com/products/a`, SHOP)).toBe(
			true
		);
		expect(isProductUrl(`${SHOP}/en-us/products/a`, SHOP)).toBe(true);
		expect(isProductUrl(`${SHOP}/collections/coffee`, SHOP)).toBe(false);
		expect(isProductUrl(`${SHOP}/collections/coffee/products/a`, SHOP)).toBe(
			false
		);
		expect(isProductUrl("https://other-shop.test/products/a", SHOP)).toBe(
			false
		);
	});

	test("productUrlsFromLinks keeps page order, dedups variants of one page", () => {
		expect(
			productUrlsFromLinks(
				[
					`${SHOP}/`,
					`${SHOP}/products/b?variant=1`,
					`${SHOP}/products/a`,
					`${SHOP}/products/b`,
					"mailto:hi@onyx.example.com",
				],
				SHOP
			)
		).toEqual([`${SHOP}/products/b`, `${SHOP}/products/a`]);
	});

	test("sitemapLocations decodes entities; productSitemaps keeps product children", () => {
		const index = `<?xml version="1.0"?><sitemapindex>
			<sitemap><loc>${SHOP}/sitemap_products_1.xml?from=1&amp;to=2</loc></sitemap>
			<sitemap><loc>${SHOP}/sitemap_blogs_1.xml</loc></sitemap>
			<sitemap><loc> ${SHOP}/product-sitemap.xml </loc></sitemap>
		</sitemapindex>`;
		const locations = sitemapLocations(index);
		expect(locations).toEqual([
			`${SHOP}/sitemap_products_1.xml?from=1&to=2`,
			`${SHOP}/sitemap_blogs_1.xml`,
			`${SHOP}/product-sitemap.xml`,
		]);
		expect(productSitemaps(locations)).toEqual([
			`${SHOP}/sitemap_products_1.xml?from=1&to=2`,
			`${SHOP}/product-sitemap.xml`,
		]);
	});
});
