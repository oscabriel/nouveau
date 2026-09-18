import { describe, expect, test } from "vitest";

import {
	parseWooListing,
	parseWooVariations,
	variationName,
	wantsVariations,
	wooProductsUrl,
	wooVariationsUrl,
} from "./woocommerce";
import type { WooProduct } from "./woocommerce";

const SHOP = "https://jbc.example.com";

/** A Store API listing item as JBC served it on 2026-09-16, trimmed. */
const jbc = (overrides: Partial<WooProduct> = {}): WooProduct => ({
	attributes: [
		{
			has_variations: true,
			name: "Grind",
			terms: [{ name: "Aeropress" }, { name: "Whole Bean" }],
		},
	],
	categories: [
		{ name: "12 oz coffee" },
		{ name: "Africa" },
		{ name: "Coffee" },
	],
	description: "<p>Notes of blueberry, jasmine and cocoa nib.</p>",
	id: 237_734,
	images: [{ src: "https://jbc.example.com/daniso.png" }],
	is_in_stock: true,
	name: "Daniso Horsa Natural",
	permalink: `${SHOP}/product/daniso-horsa-natural/`,
	prices: {
		currency_code: "USD",
		currency_minor_unit: 2,
		price: "3000",
		price_range: null,
	},
	slug: "daniso-horsa-natural",
	tags: [{ name: "Ethiopia coffee" }],
	type: "variable",
	variations: [{ id: 237_736 }, { id: 237_737 }],
	...overrides,
});

describe("parseWooListing", () => {
	test("a grind-only variable product is one lot with one variant", () => {
		const page = parseWooListing(JSON.stringify([jbc()]));
		expect(page.feedCount).toBe(1);
		expect(page.currencies).toEqual(["USD"]);
		expect(page.rejectedExternalIds).toEqual([]);
		expect(page.variationParents).toEqual([]);
		expect(page.products).toEqual([
			{
				externalId: "237734",
				handle: "daniso-horsa-natural",
				lotCopy: {
					description: "Notes of blueberry, jasmine and cocoa nib.",
					imageUrl: "https://jbc.example.com/daniso.png",
					origin: "Ethiopia",
					process: "Natural",
					productType: "12 oz coffee, Africa, Coffee",
					roasterNotes: ["blueberry", "jasmine", "cocoa nib"],
					tags: ["Ethiopia coffee"],
				},
				name: "Daniso Horsa Natural",
				url: `${SHOP}/product/daniso-horsa-natural`,
				variants: [
					{ available: true, grams: 340, name: "Default", priceCents: 3000 },
				],
			},
		]);
	});

	test("a single size attribute names the variant; a price range asks for variations", () => {
		const page = parseWooListing(
			JSON.stringify([
				jbc({
					attributes: [
						{ has_variations: false, name: "Size", terms: [{ name: "12 oz" }] },
					],
					id: 1,
					variations: [],
				}),
				jbc({
					id: 2,
					prices: {
						currency_code: "USD",
						currency_minor_unit: 2,
						price: "1800",
						price_range: { max_amount: "6500", min_amount: "1800" },
					},
				}),
			])
		);
		expect(page.products[0]?.variants[0]?.name).toBe("12 oz");
		expect(page.variationParents).toEqual([{ externalId: "2", parentId: 2 }]);
	});

	test("categories decide like a product_type; the minor unit scales the price", () => {
		const page = parseWooListing(
			JSON.stringify([
				jbc({ categories: [{ name: "Merch" }], id: 9, name: "JBC Tee" }),
				jbc({
					id: 10,
					prices: {
						currency_code: "JPY",
						currency_minor_unit: 0,
						price: "3000",
					},
				}),
				{ name: "no id" },
			])
		);
		expect(page.rejectedExternalIds).toEqual(["9"]);
		expect(page.products.map((p) => p.externalId)).toEqual(["10"]);
		expect(page.products[0]?.variants[0]?.priceCents).toBe(300_000);
		expect(page.currencies).toEqual(["JPY"]);
		expect(page.feedCount).toBe(3);
	});

	test("a default rejection becomes a shadow candidate; a named one does not", () => {
		const page = parseWooListing(
			JSON.stringify([
				// The ambiguous tail: no categories, no tags, nothing to read.
				jbc({
					categories: [],
					id: 11,
					name: "Special Release",
					tags: [],
				}),
				// A named reject (Merch) is no shadow candidate.
				jbc({ categories: [{ name: "Merch" }], id: 12, name: "Mug" }),
			])
		);
		expect(page.shadowCandidates).toEqual([
			{
				description: "Notes of blueberry, jasmine and cocoa nib.",
				externalId: "11",
				title: "Special Release",
			},
		]);
	});

	test("a permalink that is not an http(s) URL is dropped, the lot kept", () => {
		const [lot] = parseWooListing(
			JSON.stringify([
				jbc({ permalink: "ftp://jbc.example.com/product/daniso" }),
			])
		).products;
		expect(lot?.url).toBeUndefined();
	});

	test("rejects a body that is not a Store API list", () => {
		expect(() => parseWooListing('{"products":[]}')).toThrow();
		expect(() => parseWooListing("<html></html>")).toThrow();
	});
});

const variation = (
	label: string,
	price: string,
	inStock: boolean
): WooProduct => ({
	id: Math.random(),
	is_in_stock: inStock,
	prices: { currency_code: "USD", currency_minor_unit: 2, price },
	variation: label,
});

describe("variations", () => {
	test("wantsVariations only for sizes with their own prices", () => {
		expect(wantsVariations(jbc())).toBe(false);
		expect(wantsVariations(jbc({ variations: [] }))).toBe(false);
		expect(
			wantsVariations(
				jbc({
					attributes: [
						{
							has_variations: true,
							name: "Bag Size",
							terms: [{ name: "12 oz" }, { name: "5 lb" }],
						},
					],
				})
			)
		).toBe(true);
	});

	test("variationName keeps the size part of the label", () => {
		expect(variationName("Size: 12 oz, Grind: Whole Bean")).toBe("12 oz");
		expect(variationName("Grind: Aeropress")).toBe("Aeropress");
		expect(variationName("Roast: Light, Grind: Drip")).toBe("Light / Drip");
		expect(variationName("")).toBe("Default");
		expect(variationName()).toBe("Default");
	});

	test("parseWooVariations collapses a Size x Grind matrix to one variant per size", () => {
		expect(
			parseWooVariations([
				variation("Size: 12 oz, Grind: Whole Bean", "1800", false),
				variation("Size: 12 oz, Grind: Drip", "1800", true),
				variation("Size: 5 lb, Grind: Whole Bean", "6500", true),
				{ prices: { price: "n/a" }, variation: "Size: 2 lb" },
			])
		).toEqual([
			{ available: true, grams: 340, name: "12 oz", priceCents: 1800 },
			{ available: true, grams: 2268, name: "5 lb", priceCents: 6500 },
		]);
		expect(parseWooVariations({ not: "a list" })).toEqual([]);
	});
});

describe("Store API urls", () => {
	test("listing and variation endpoints on the shop origin", () => {
		expect(wooProductsUrl(`${SHOP}/shop/`, 2)).toBe(
			`${SHOP}/wp-json/wc/store/v1/products?per_page=100&page=2`
		);
		expect(wooVariationsUrl(SHOP, 42)).toBe(
			`${SHOP}/wp-json/wc/store/v1/products?type=variation&parent=42&per_page=100`
		);
	});
});
