import { v } from "convex/values";

import { internalMutation } from "./_generated/server";
import { DEFAULT_CADENCE_MINUTES } from "./constants";

// The 20 verified US roasters from issue #3 (all Shopify, /products.json
// confirmed live 2026-08-30). Product page for Coava lives on a subdomain; its
// dedup domain is still the registrable domain.
//
// `cadenceMinutes` (#33): two weeks of dev dropEvents showed the drop
// roasters release inside one-hour windows on a fixed weekday (Proud Mary
// Wed 11-15, Verve Fri 07, Onyx Thu 11, Ruby Wed 07, Sey Wed 16-19); a
// 60-minute cadence lands anywhere in that hour, 15 lands within it. 30 for
// roasters with a few detections a week; the rest take the 60 default.
const SEED_ROASTERS = [
	{
		cadenceMinutes: 15,
		city: "Rogers",
		domain: "onyxcoffeelab.com",
		name: "Onyx Coffee Lab",
		productPath: "/collections/coffee",
		state: "AR",
	},
	{
		cadenceMinutes: 15,
		city: "Brooklyn",
		domain: "seycoffee.com",
		name: "Sey Coffee",
		productPath: "/collections/all",
		state: "NY",
	},
	{
		cadenceMinutes: 30,
		city: "Brooklyn",
		domain: "regaliacoffee.com",
		name: "Regalia",
		productPath: "/collections/all",
		state: "NY",
	},
	{
		cadenceMinutes: 30,
		city: "San Francisco",
		domain: "blossomcoffeeroasters.com",
		name: "Blossom Coffee Roasters",
		productPath: "/collections/all",
		state: "CA",
	},
	{
		cadenceMinutes: 15,
		city: "Portland",
		domain: "proudmarycoffee.com",
		name: "Proud Mary Coffee",
		productPath: "/collections/all/coffee",
		state: "OR",
	},
	{
		cadenceMinutes: 15,
		city: "Lancaster",
		domain: "drinkpassenger.com",
		name: "Passenger Coffee",
		productPath: "/collections/coffee",
		state: "PA",
		// The apex is a headless front with no products.json; the Shopify shop
		// (and its feed) live on www.
		website: "https://www.drinkpassenger.com",
	},
	{
		cadenceMinutes: 15,
		city: "Santa Cruz",
		domain: "vervecoffee.com",
		name: "Verve Coffee Roasters",
		productPath: "/collections/coffee",
		state: "CA",
	},
	{
		city: "San Francisco",
		domain: "sightglasscoffee.com",
		name: "Sightglass Coffee",
		productPath: "/collections/coffee",
		state: "CA",
	},
	{
		city: "Portland",
		domain: "heartroasters.com",
		name: "Heart Coffee Roasters",
		productPath: "/collections/beans",
		state: "OR",
	},
	{
		city: "Portland",
		domain: "coavacoffee.com",
		name: "Coava Coffee Roasters",
		productPath: "/collections/all",
		state: "OR",
		website: "https://shop.coavacoffee.com",
	},
	{
		city: "Portland",
		domain: "stumptowncoffee.com",
		name: "Stumptown Coffee Roasters",
		productPath: "/collections/all",
		state: "OR",
	},
	{
		cadenceMinutes: 30,
		city: "Chicago",
		domain: "intelligentsia.com",
		name: "Intelligentsia Coffee",
		productPath: "/collections/coffee",
		state: "IL",
	},
	{
		cadenceMinutes: 30,
		city: "Grand Rapids",
		domain: "madcapcoffee.com",
		name: "Madcap Coffee Company",
		productPath: "/collections/coffee",
		state: "MI",
	},
	{
		cadenceMinutes: 15,
		city: "Wisconsin Rapids",
		domain: "rubycoffeeroasters.com",
		name: "Ruby Coffee Roasters",
		productPath: "/collections/coffee",
		state: "WI",
	},
	{
		cadenceMinutes: 15,
		city: "Topeka",
		domain: "ptscoffee.com",
		name: "PT's Coffee Roasting Co.",
		productPath: "/collections/coffee",
		state: "KS",
	},
	{
		city: "Lakewood",
		domain: "sweetbloomcoffee.com",
		name: "Sweet Bloom Coffee",
		productPath: "/collections/coffee",
		state: "CO",
	},
	{
		cadenceMinutes: 30,
		city: "Durham",
		domain: "counterculturecoffee.com",
		name: "Counter Culture Coffee",
		productPath: "/shop",
		state: "NC",
	},
	{
		city: "Philadelphia",
		domain: "lacolombe.com",
		name: "La Colombe Coffee Roasters",
		productPath: "/collections/coffee",
		state: "PA",
	},
	{
		cadenceMinutes: 30,
		city: "San Antonio",
		domain: "meritcoffee.com",
		name: "Merit Coffee Co.",
		productPath: "/collections/coffee",
		state: "TX",
	},
	{
		city: "Atlanta",
		domain: "eastpole.coffee",
		name: "East Pole Coffee Co.",
		productPath: "/collections/coffee",
		state: "GA",
	},
] as const;

const slugOf = (domain: string): string => domain.replace(/\.[^.]+$/u, "");

type SeedRoaster = (typeof SEED_ROASTERS)[number];

const cadenceOf = (roaster: SeedRoaster): number =>
	"cadenceMinutes" in roaster
		? roaster.cadenceMinutes
		: DEFAULT_CADENCE_MINUTES;

const urlsOf = (
	roaster: SeedRoaster
): { productPageUrl: string; websiteUrl: string } => {
	const websiteUrl =
		"website" in roaster ? roaster.website : `https://${roaster.domain}`;
	return { productPageUrl: `${websiteUrl}${roaster.productPath}`, websiteUrl };
};

// Idempotent: re-running skips roasters whose slug already exists.
// Roasters enter as `pending` and flip to `active` when their baseline crawl
// lands (data-driven, per the locked behavioral rules).
export const seedCuratedRoasters = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const existing = await ctx.db.query("roasters").take(1000);
		const seenSlugs = new Set(existing.map((roaster) => roaster.slug));
		const fresh = SEED_ROASTERS.filter(
			(roaster) => !seenSlugs.has(slugOf(roaster.domain))
		);

		const roasterIds = await Promise.all(
			fresh.map((roaster) => {
				const { productPageUrl, websiteUrl } = urlsOf(roaster);
				return ctx.db.insert("roasters", {
					city: roaster.city,
					claimed: false,
					domain: roaster.domain,
					name: roaster.name,
					productPageUrl,
					slug: slugOf(roaster.domain),
					source: "curated",
					state: roaster.state,
					status: "pending",
					websiteUrl,
				});
			})
		);
		await Promise.all(
			roasterIds.map((roasterId, index) =>
				ctx.db.insert("crawlSources", {
					cadenceMinutes: cadenceOf(fresh[index]),
					consecutiveFailures: 0,
					health: "watching",
					mode: "products_json",
					nextCrawlDueAt: now,
					roasterId,
				})
			)
		);

		return {
			inserted: roasterIds.length,
			skipped: SEED_ROASTERS.length - roasterIds.length,
		};
	},
});

/**
 * Operator tool (#33): bring an existing deployment's crawl sources onto the
 * seed cadence table. Matches roasters by slug; a roaster not in the table
 * keeps whatever cadence it has. Idempotent.
 */
export const applySeedCadence = internalMutation({
	args: {},
	handler: async (ctx) => {
		const results = await Promise.all(
			SEED_ROASTERS.map(async (seed) => {
				const roaster = await ctx.db
					.query("roasters")
					.withIndex("by_slug", (q) => q.eq("slug", slugOf(seed.domain)))
					.unique();
				if (roaster === null) {
					return "missing";
				}
				const source = await ctx.db
					.query("crawlSources")
					.withIndex("by_roaster_id", (q) => q.eq("roasterId", roaster._id))
					.unique();
				if (source === null) {
					return "missing";
				}
				const cadenceMinutes = cadenceOf(seed);
				if (source.cadenceMinutes === cadenceMinutes) {
					return "unchanged";
				}
				await ctx.db.patch(source._id, { cadenceMinutes });
				return "patched";
			})
		);
		return {
			patched: results.filter((result) => result === "patched").length,
			unchanged: results.filter((result) => result === "unchanged").length,
		};
	},
	returns: v.object({ patched: v.number(), unchanged: v.number() }),
});

/**
 * Operator tool: bring an existing deployment's roaster shop URLs onto the
 * seed table (a table fix such as the 17abf56 paste that gave La Colombe
 * Passenger's www host). Matches roasters by slug; a roaster not in the
 * table keeps its URLs. Idempotent.
 */
export const applySeedUrls = internalMutation({
	args: {},
	handler: async (ctx) => {
		const results = await Promise.all(
			SEED_ROASTERS.map(async (seed) => {
				const roaster = await ctx.db
					.query("roasters")
					.withIndex("by_slug", (q) => q.eq("slug", slugOf(seed.domain)))
					.unique();
				if (roaster === null) {
					return "missing";
				}
				const urls = urlsOf(seed);
				if (
					roaster.websiteUrl === urls.websiteUrl &&
					roaster.productPageUrl === urls.productPageUrl
				) {
					return "unchanged";
				}
				await ctx.db.patch(roaster._id, urls);
				return "patched";
			})
		);
		return {
			patched: results.filter((result) => result === "patched").length,
			unchanged: results.filter((result) => result === "unchanged").length,
		};
	},
	returns: v.object({ patched: v.number(), unchanged: v.number() }),
});
