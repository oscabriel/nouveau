import { v } from "convex/values";

import { SHOPIFY_FETCH_HEADERS } from "./extraction";

export const shopMarketValidator = v.object({
	confirmedAt: v.number(),
	country: v.literal("US"),
	currency: v.literal("USD"),
	// The page that carried the confirmation, after redirects.
	url: v.string(),
});

// Fail closed for themes without Shopify's explicit localization globals.
const COUNTRY = /Shopify\.country\s*=\s*["']US["']\s*;/u;
const CURRENCY = /Shopify\.currency\s*=\s*(?<currency>\{[^;]+\})\s*;/u;

export const confirmsUsUsd = (html: string): boolean => {
	const currency = CURRENCY.exec(html)?.groups?.currency;
	if (!COUNTRY.test(html) || !currency) {
		return false;
	}
	try {
		const value: unknown = JSON.parse(currency);
		return (
			typeof value === "object" &&
			value !== null &&
			"active" in value &&
			value.active === "USD"
		);
	} catch {
		return false;
	}
};

// Roasters are US shops on two-label domains, so the last two labels identify
// the site. `heartroasters.com` and `www.heartroasters.com` are the same shop;
// a redirect to another registrable domain is not a confirmation of this one.
const registrableDomain = (hostname: string): string =>
	hostname.toLowerCase().split(".").slice(-2).join(".");

/** Shopify apex domains commonly 301 to `www`; follow, but stay on the shop. */
export const sameShop = (requested: string, landed: string): boolean => {
	try {
		const from = new URL(requested);
		const to = new URL(landed);
		return (
			to.protocol === "https:" &&
			registrableDomain(from.hostname) === registrableDomain(to.hostname)
		);
	} catch {
		return false;
	}
};

/** A missing confirmation excludes recommendations, but does not fail a crawl. */
export const confirmShopMarket = async (
	websiteUrl: string,
	confirmedAt: number
) => {
	const requested = new URL("/", websiteUrl).href;
	try {
		const response = await fetch(requested, {
			headers: { ...SHOPIFY_FETCH_HEADERS, accept: "text/html" },
			redirect: "follow",
			signal: AbortSignal.timeout(10_000),
		});
		// Mocked and some polyfilled responses report an empty url.
		const landed = response.url || requested;
		if (
			!(response.ok && sameShop(requested, landed)) ||
			!confirmsUsUsd(await response.text())
		) {
			return;
		}
		return {
			confirmedAt,
			country: "US" as const,
			currency: "USD" as const,
			url: landed,
		};
	} catch {
		// An unreachable shop has no confirmed market.
	}
};
