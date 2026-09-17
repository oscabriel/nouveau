import { describe, expect, test, vi } from "vitest";

import type { FeedPageResponse } from "./extraction";
import { probeShop } from "./platform";

const APEX = "https://shop.example.com";
const WWW = "https://www.shop.example.com";

const shopifyFeed = JSON.stringify({
	products: [
		{
			handle: "kenya",
			id: 1,
			product_type: "Coffee",
			title: "Kenya Karumandi",
			variants: [{ available: true, price: "18.00", title: "250g" }],
		},
	],
});
const wooList = JSON.stringify([
	{
		categories: [{ name: "Coffee" }],
		id: 5,
		is_in_stock: true,
		name: "Daniso Horsa Natural",
		prices: { currency_code: "USD", currency_minor_unit: 2, price: "3000" },
	},
]);

const ok = (text: string): FeedPageResponse => ({ status: 200, text });
const missing = (status = 404): FeedPageResponse => ({ status, text: null });

/** A fetcher answering by URL; anything unlisted is a 404. */
const shop = (answers: Record<string, FeedPageResponse>) =>
	vi.fn((url: string) => {
		const hit = Object.entries(answers).find(([prefix]) =>
			url.startsWith(prefix)
		);
		return Promise.resolve(hit === undefined ? missing() : hit[1]);
	});

describe("probeShop (the platform ladder)", () => {
	test("a Shopify feed with lots is products_json", async () => {
		const fetchPage = shop({ [`${APEX}/products.json`]: ok(shopifyFeed) });
		expect(await probeShop({ fetchPage, websiteUrl: APEX })).toEqual({
			mode: "products_json",
			websiteUrl: APEX,
		});
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	test("an apex 404 with the feed on www lands on www", async () => {
		const fetchPage = shop({ [`${WWW}/products.json`]: ok(shopifyFeed) });
		expect(await probeShop({ fetchPage, websiteUrl: APEX })).toEqual({
			mode: "products_json",
			websiteUrl: WWW,
		});
	});

	test("a feed with no lots falls through to the Store API", async () => {
		const fetchPage = shop({
			[`${APEX}/products.json`]: ok('{"products":[]}'),
			[`${APEX}/wp-json/wc/store/v1/products`]: ok(wooList),
		});
		expect(await probeShop({ fetchPage, websiteUrl: APEX })).toEqual({
			mode: "woocommerce",
			websiteUrl: APEX,
		});
	});

	test("the Store API gets the same www retry", async () => {
		const fetchPage = shop({
			[`${WWW}/wp-json/wc/store/v1/products`]: ok(wooList),
		});
		expect(await probeShop({ fetchPage, websiteUrl: APEX })).toEqual({
			mode: "woocommerce",
			websiteUrl: WWW,
		});
	});

	test("a WordPress site whose Store API is not a product list is not WooCommerce", async () => {
		const fetchPage = shop({
			[`${APEX}/wp-json/wc/store/v1/products`]: ok(
				'{"code":"rest_no_route","message":"No route"}'
			),
		});
		expect(await probeShop({ fetchPage, websiteUrl: APEX })).toEqual({
			mode: "product_pages",
			websiteUrl: APEX,
		});
	});

	test("anything else is product_pages on the given host", async () => {
		const fetchPage = shop({});
		expect(await probeShop({ fetchPage, websiteUrl: WWW })).toEqual({
			mode: "product_pages",
			websiteUrl: WWW,
		});
	});
});
