import { internalMutation } from "./_generated/server";
import { DEFAULT_CADENCE_MINUTES } from "./constants";

// The 20 verified US roasters from issue #3 (all Shopify, /products.json
// confirmed live 2026-08-30). Product page for Coava lives on a subdomain; its
// dedup domain is still the registrable domain.
const SEED_ROASTERS = [
	{
		city: "Rogers",
		domain: "onyxcoffeelab.com",
		name: "Onyx Coffee Lab",
		productPath: "/collections/coffee",
		state: "AR",
	},
	{
		city: "Brooklyn",
		domain: "seycoffee.com",
		name: "Sey Coffee",
		productPath: "/collections/all",
		state: "NY",
	},
	{
		city: "Brooklyn",
		domain: "regaliacoffee.com",
		name: "Regalia",
		productPath: "/collections/all",
		state: "NY",
	},
	{
		city: "San Francisco",
		domain: "blossomcoffeeroasters.com",
		name: "Blossom Coffee Roasters",
		productPath: "/collections/all",
		state: "CA",
	},
	{
		city: "Portland",
		domain: "proudmarycoffee.com",
		name: "Proud Mary Coffee",
		productPath: "/collections/all/coffee",
		state: "OR",
	},
	{
		city: "Lancaster",
		domain: "drinkpassenger.com",
		name: "Passenger Coffee",
		productPath: "/collections/coffee",
		state: "PA",
	},
	{
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
		city: "Chicago",
		domain: "intelligentsia.com",
		name: "Intelligentsia Coffee",
		productPath: "/collections/coffee",
		state: "IL",
	},
	{
		city: "Grand Rapids",
		domain: "madcapcoffee.com",
		name: "Madcap Coffee Company",
		productPath: "/collections/coffee",
		state: "MI",
	},
	{
		city: "Wisconsin Rapids",
		domain: "rubycoffeeroasters.com",
		name: "Ruby Coffee Roasters",
		productPath: "/collections/coffee",
		state: "WI",
	},
	{
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
				const websiteUrl =
					"website" in roaster ? roaster.website : `https://${roaster.domain}`;
				return ctx.db.insert("roasters", {
					city: roaster.city,
					claimed: false,
					domain: roaster.domain,
					name: roaster.name,
					productPageUrl: `${websiteUrl}${roaster.productPath}`,
					slug: slugOf(roaster.domain),
					source: "curated",
					state: roaster.state,
					status: "pending",
					websiteUrl,
				});
			})
		);
		await Promise.all(
			roasterIds.map((roasterId) =>
				ctx.db.insert("crawlSources", {
					cadenceMinutes: DEFAULT_CADENCE_MINUTES,
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
