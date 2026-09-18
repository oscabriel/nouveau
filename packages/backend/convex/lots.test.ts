import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { LOT_PAGE_LOGS_LIMIT } from "./constants";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	archivedLotId: string;
	lotId: string;
	roasterId: string;
	t: ReturnType<typeof convexTest>;
	userId: string;
}

const setup = async (
	lotFields: Partial<Record<string, unknown>> = {}
): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const roaster = await ctx.db.insert("roasters", {
			city: "Brooklyn",
			claimed: false,
			domain: "sey.example.com",
			name: "Sey",
			productPageUrl: "https://sey.example.com/collections/coffee",
			slug: "sey",
			source: "curated",
			state: "NY",
			status: "active",
			websiteUrl: "https://sey.example.com",
		});
		const lot = await ctx.db.insert("products", {
			externalId: "p1",
			firstSeenAt: 1000,
			handle: "mullugeta",
			lastSeenAt: 1000,
			missedCrawls: 0,
			name: "Ethiopia Mullugeta Muntasha",
			roasterId: roaster,
			status: "current",
			...lotFields,
		});
		const userId = await ctx.db.insert("users", {
			name: "Taster One",
			providerAccountId: "google-1",
		});
		return { lot, roaster, userId };
	});
	return {
		archivedLotId: "",
		lotId: ids.lot,
		roasterId: ids.roaster,
		t,
		userId: ids.userId,
	};
};

const addLog = (
	fx: Fixture,
	loggedAt: number,
	overrides: Record<string, unknown> = {}
): Promise<string> =>
	fx.t.run((ctx) =>
		ctx.db.insert("logs", {
			loggedAt,
			productId: fx.lotId,
			userId: fx.userId,
			...overrides,
		})
	);

describe("lots.get", () => {
	test("a lot without the rollup reads as unknown stock, not sold out", async () => {
		const fx = await setup();
		await fx.t.run(async (ctx) => {
			await ctx.db.insert("productVariants", {
				available: true,
				grams: 250,
				name: "250g",
				priceCents: 1800,
				productId: fx.lotId,
			});
		});
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page?.lot.available).toBeNull();
		expect(page?.lot.variants).toHaveLength(1);
	});

	test("returns the size table with deep links and the stock boundary", async () => {
		const fx = await setup({ anyAvailable: true, minPriceCents: 1800 });
		await fx.t.run(async (ctx) => {
			await ctx.db.insert("productVariants", {
				available: false,
				grams: 1000,
				name: "1kg / Whole Bean",
				priceCents: 5600,
				productId: fx.lotId,
			});
			await ctx.db.insert("productVariants", {
				available: true,
				externalId: "424242",
				grams: 250,
				name: "250g / Grind for Espresso",
				priceCents: 1800,
				productId: fx.lotId,
			});
		});
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page?.lot.available).toBe(true);
		expect(page?.lot.variants).toHaveLength(2);
		// In-stock sizes go first; the grind option splits off the name.
		const [espresso, wholeBean] = page?.lot.variants ?? [];
		expect(espresso).toMatchObject({
			grams: 250,
			grind: "Grind for Espresso",
			priceCents: 1800,
		});
		expect(wholeBean).toMatchObject({
			available: false,
			grams: 1000,
			grind: "Whole Bean",
		});
		// A variant id deep-links to the exact size; no id links the lot page.
		expect(espresso?.url).toBe(
			"https://sey.example.com/products/mullugeta?variant=424242"
		);
		expect(wholeBean?.url).toBe("https://sey.example.com/products/mullugeta");
	});

	test("resolves the lot, its roaster and its logs newest first", async () => {
		const fx = await setup({
			description: "A washed lot from Urrao.",
			origin: "Colombia",
			process: "Washed",
			roasterNotes: ["peach", "melon", "red tea"],
		});
		await addLog(fx, 2000, { notes: "peach for days", rating: 4 });
		await addLog(fx, 1000);
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page).toMatchObject({
			logsTruncated: false,
			lot: {
				description: "A washed lot from Urrao.",
				facts: {
					notes: ["peach", "melon", "red tea"],
					origin: "Colombia",
					process: "Washed",
					variety: null,
				},
				handle: "mullugeta",
				name: "Ethiopia Mullugeta Muntasha",
				pageFactsAt: null,
				pageFactsKnown: false,
				status: "current",
				// Variety is still missing, so the lot page will ask the page.
				thin: true,
				url: "https://sey.example.com/products/mullugeta",
			},
			roaster: { name: "Sey", slug: "sey" },
		});
		expect(page?.logs.map((log) => log.loggedAt)).toEqual([2000, 1000]);
		expect(page?.logs[0]?.lot.name).toBe("Ethiopia Mullugeta Muntasha");
		expect(page?.logs[0]?.rating).toBe(4);
	});

	test("a malformed or unknown id resolves to null", async () => {
		const fx = await setup();
		expect(await fx.t.query(api.lots.get, { lotId: "garbage" })).toBeNull();
		expect(
			await fx.t.query(api.lots.get, {
				lotId: "0000000000000000000000000000000",
			})
		).toBeNull();
	});

	test("an archived lot still resolves (logs keep resolving, §14.1)", async () => {
		const fx = await setup({ status: "archived" });
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page?.lot.status).toBe("archived");
	});

	test("logs beyond the cap truncate with the flag", async () => {
		const fx = await setup();
		await Promise.all(
			Array.from({ length: LOT_PAGE_LOGS_LIMIT + 1 }, (_, i) =>
				addLog(fx, 1000 + i)
			)
		);
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page?.logs).toHaveLength(LOT_PAGE_LOGS_LIMIT);
		expect(page?.logsTruncated).toBe(true);
	});

	test("a lot with no logs renders empty", async () => {
		const fx = await setup();
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page?.logs).toEqual([]);
		expect(page?.logsTruncated).toBe(false);
	});
});
