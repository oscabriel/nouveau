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

/**
 * Shopify's storefront `/meta.json` names the shop's registered country and
 * base currency. Fallback for a theme without the localization globals, or a
 * shop whose homepage redirects off Shopify (Passenger's headless apex).
 */
export const confirmsUsUsdMeta = (text: string): boolean => {
	try {
		const value: unknown = JSON.parse(text);
		return (
			typeof value === "object" &&
			value !== null &&
			"country" in value &&
			value.country === "US" &&
			"currency" in value &&
			value.currency === "USD"
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

/**
 * Fetch one shop page (following redirects on the same shop) and return the
 * landed url when `confirms` accepts the body; null otherwise, including
 * when the shop is unreachable.
 */
const confirmedUrl = async (
	requested: string,
	accept: string,
	confirms: (body: string) => boolean
): Promise<string | null> => {
	try {
		const response = await fetch(requested, {
			headers: { ...SHOPIFY_FETCH_HEADERS, accept },
			redirect: "follow",
			signal: AbortSignal.timeout(10_000),
		});
		// Mocked and some polyfilled responses report an empty url.
		const landed = response.url || requested;
		if (!(response.ok && sameShop(requested, landed))) {
			return null;
		}
		return confirms(await response.text()) ? landed : null;
	} catch {
		return null;
	}
};

/**
 * A missing confirmation excludes recommendations, but does not fail a crawl.
 * The homepage globals are the primary signal; `/meta.json` is the fallback.
 */
export const confirmShopMarket = async (
	websiteUrl: string,
	confirmedAt: number
) => {
	const url =
		(await confirmedUrl(
			new URL("/", websiteUrl).href,
			"text/html",
			confirmsUsUsd
		)) ??
		(await confirmedUrl(
			new URL("/meta.json", websiteUrl).href,
			"application/json",
			confirmsUsUsdMeta
		));
	if (url === null) {
		return;
	}
	return {
		confirmedAt,
		country: "US" as const,
		currency: "USD" as const,
		url,
	};
};
