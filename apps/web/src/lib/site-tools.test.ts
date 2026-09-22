import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { describe, expect, test } from "vitest";

import {
	buildSiteTools,
	describeLot,
	lotAddressFromPath,
	PARAM_DESCRIPTION_LIMIT,
	TOOL_DESCRIPTION_LIMIT,
	TOOL_NAME_LIMIT,
	TOOL_OUTPUT_LIMIT,
} from "./site-tools";
import type { LotPage, SiteToolDeps } from "./site-tools";

const LOT_ID = "products:mullugeta" as Id<"products">;
const OTHER_ID = "products:other" as Id<"products">;

const page: LotPage = {
	logs: [],
	logsTruncated: false,
	lot: {
		available: true,
		description: "Floral and bright. ".repeat(40),
		facts: {
			elevation: null,
			notes: ["jasmine", "bergamot", "honey"],
			origin: "Ethiopia",
			process: "Washed",
			producer: null,
			region: "Guji",
			roastLevel: null,
			variety: "74158",
		},
		handle: "mullugeta",
		id: LOT_ID,
		imageUrl: null,
		name: "Ethiopia Mullugeta Muntasha",
		pageFactsAt: null,
		pageFactsKnown: true,
		status: "current",
		thin: false,
		url: "https://sey.example.com/products/mullugeta",
		variants: Array.from({ length: 12 }, (_, index) => ({
			available: index % 2 === 0,
			grams: 250 * (index + 1),
			grind: null,
			id: `productVariants:${index}` as Id<"productVariants">,
			name: `${250 * (index + 1)}g`,
			priceCents: 2200 + index * 100,
			url: `https://sey.example.com/products/mullugeta?variant=${index}`,
		})),
	},
	roaster: { name: "Sey", slug: "sey" },
};

interface Fake {
	deps: SiteToolDeps;
	saves: Id<"products">[];
}

const fake = (
	overrides: Partial<{
		isAuthenticated: boolean;
		isLoading: boolean;
		pathname: string;
		saved: Id<"products">[];
	}> = {}
): Fake => {
	const saves = [...(overrides.saved ?? [])];
	const deps: SiteToolDeps = {
		auth: () => ({
			isAuthenticated: overrides.isAuthenticated ?? true,
			isLoading: overrides.isLoading ?? false,
		}),
		getLot: (address) =>
			Promise.resolve(
				address.roaster === "sey" && address.lot === "mullugeta" ? page : null
			),
		origin: "https://nouveau.coffee",
		pathname: () => overrides.pathname ?? "/roaster/sey/mullugeta",
		saveLot: (lotId) => {
			saves.push(lotId);
			return Promise.resolve(null);
		},
		savedLotIds: () => Promise.resolve([...saves]),
	};
	return { deps, saves };
};

const tool = (fx: Fake, name: string) => {
	const found = buildSiteTools(fx.deps).find((t) => t.name === name);
	if (found === undefined) {
		throw new Error(`no tool ${name}`);
	}
	return found;
};

describe("site tool contracts", () => {
	test("names, descriptions and parameters fit Chrome's budgets", () => {
		const tools = buildSiteTools(fake().deps);
		expect(tools.map((t) => t.name)).toEqual([
			"get_context",
			"get_lot",
			"save_lot",
		]);
		for (const t of tools) {
			expect(t.name.length).toBeLessThanOrEqual(TOOL_NAME_LIMIT);
			expect(t.name).toMatch(/^[a-z_]+$/u);
			expect(t.description.length).toBeLessThanOrEqual(TOOL_DESCRIPTION_LIMIT);
			expect(t.inputSchema.additionalProperties).toBe(false);
			for (const [param, schema] of Object.entries(t.inputSchema.properties)) {
				expect(param.length).toBeLessThanOrEqual(TOOL_NAME_LIMIT);
				expect(schema.description?.length ?? 0).toBeLessThanOrEqual(
					PARAM_DESCRIPTION_LIMIT
				);
			}
		}
	});

	test("only the reads say read-only", () => {
		const tools = buildSiteTools(fake().deps);
		const readOnly = tools.map((t) => [t.name, t.annotations.readOnlyHint]);
		expect(readOnly).toEqual([
			["get_context", true],
			["get_lot", true],
			["save_lot", false],
		]);
	});
});

describe("lotAddressFromPath", () => {
	test("the lot page and nothing else", () => {
		expect(lotAddressFromPath("/roaster/sey/mullugeta")).toEqual({
			lot: "mullugeta",
			roaster: "sey",
		});
		expect(lotAddressFromPath("/roaster/sey/mullugeta/")).toEqual({
			lot: "mullugeta",
			roaster: "sey",
		});
		expect(lotAddressFromPath("/roaster/sey")).toBeNull();
		expect(lotAddressFromPath("/roasters/sey")).toBeNull();
		expect(lotAddressFromPath("/saved")).toBeNull();
	});
});

describe("get_context", () => {
	test("reports the page, the lot on it, and sign-in, nothing more", async () => {
		const result = await tool(fake(), "get_context").execute({});
		expect(result).toEqual({
			authReady: true,
			lot: { lot: "mullugeta", roaster: "sey" },
			ok: true,
			pathname: "/roaster/sey/mullugeta",
			signedIn: true,
			siteOrigin: "https://nouveau.coffee",
		});
	});

	test("off a lot page the lot is null", async () => {
		const result = await tool(
			fake({ isAuthenticated: false, pathname: "/drops" }),
			"get_context"
		).execute({});
		expect(result).toMatchObject({ lot: null, signedIn: false });
	});
});

describe("get_lot", () => {
	test("reads the current page's lot when given no address", async () => {
		const result = await tool(fake({ saved: [OTHER_ID] }), "get_lot").execute(
			{}
		);
		expect(result).toMatchObject({
			lotId: LOT_ID,
			lotPageUrl: "https://nouveau.coffee/roaster/sey/mullugeta",
			name: "Ethiopia Mullugeta Muntasha",
			ok: true,
			roaster: { name: "Sey", slug: "sey" },
			saved: false,
			shopUrl: "https://sey.example.com/products/mullugeta",
		});
	});

	test("reads an addressed lot from any page", async () => {
		const result = await tool(
			fake({ pathname: "/", saved: [LOT_ID] }),
			"get_lot"
		).execute({ lot: "mullugeta", roaster: "sey" });
		expect(result).toMatchObject({ ok: true, saved: true });
	});

	test("signed out, saved is unknown rather than false", async () => {
		const result = await tool(
			fake({ isAuthenticated: false }),
			"get_lot"
		).execute({});
		expect(result).toMatchObject({ ok: true, saved: null });
	});

	test("no lot on the page and no address is an error, not a guess", async () => {
		const result = await tool(fake({ pathname: "/saved" }), "get_lot").execute(
			{}
		);
		expect(result).toMatchObject({
			error: { code: "no_lot_on_page" },
			ok: false,
		});
	});

	test("half an address is invalid input", async () => {
		const result = await tool(fake(), "get_lot").execute({ roaster: "sey" });
		expect(result).toMatchObject({
			error: { code: "invalid_input" },
			ok: false,
		});
	});

	test("an unknown address is unknown_lot", async () => {
		const result = await tool(fake(), "get_lot").execute({
			lot: "nope",
			roaster: "sey",
		});
		expect(result).toMatchObject({ error: { code: "unknown_lot" }, ok: false });
	});
});

describe("describeLot", () => {
	test("drops logs and unknown facts, clips copy, and fits the output budget", () => {
		const result = describeLot("https://nouveau.coffee", page, null);
		expect(result).not.toHaveProperty("logs");
		expect(result.facts).toEqual({
			notes: ["jasmine", "bergamot", "honey"],
			origin: "Ethiopia",
			process: "Washed",
			region: "Guji",
			variety: "74158",
		});
		expect(result.description?.endsWith("…")).toBe(true);
		expect(result.variants.length).toBeLessThanOrEqual(6);
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(
			TOOL_OUTPUT_LIMIT
		);
	});
});

describe("save_lot", () => {
	test("saves the current page's lot and returns a receipt", async () => {
		const fx = fake();
		const result = await tool(fx, "save_lot").execute({});
		expect(result).toEqual({
			emailAlertsChanged: false,
			lotId: LOT_ID,
			lotPageUrl: "https://nouveau.coffee/roaster/sey/mullugeta",
			name: "Ethiopia Mullugeta Muntasha",
			ok: true,
			status: "saved",
			visibility: "private",
			watchCreated: false,
		});
		expect(fx.saves).toEqual([LOT_ID]);
	});

	test("saving again reports already_saved and writes nothing", async () => {
		const fx = fake({ saved: [LOT_ID] });
		const result = await tool(fx, "save_lot").execute({});
		expect(result).toMatchObject({ ok: true, status: "already_saved" });
		expect(fx.saves).toEqual([LOT_ID]);
	});

	test("signed out, nothing is saved", async () => {
		const fx = fake({ isAuthenticated: false });
		const result = await tool(fx, "save_lot").execute({});
		expect(result).toMatchObject({
			error: { code: "sign_in_required" },
			ok: false,
		});
		expect(fx.saves).toEqual([]);
	});

	test("while sign-in loads, the agent is told to retry", async () => {
		const fx = fake({ isAuthenticated: false, isLoading: true });
		const result = await tool(fx, "save_lot").execute({});
		expect(result).toMatchObject({
			error: { code: "auth_loading" },
			ok: false,
		});
		expect(fx.saves).toEqual([]);
	});

	test("an unknown address saves nothing", async () => {
		const fx = fake();
		const result = await tool(fx, "save_lot").execute({
			lot: "nope",
			roaster: "sey",
		});
		expect(result).toMatchObject({ error: { code: "unknown_lot" }, ok: false });
		expect(fx.saves).toEqual([]);
	});
});
