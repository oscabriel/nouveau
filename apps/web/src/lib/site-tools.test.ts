import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { describe, expect, test, vi } from "vitest";

import {
	buildSiteTools,
	describeFound,
	describeLot,
	FOUND_LOTS_CLIP,
	lotAddressFromPath,
	PARAM_DESCRIPTION_LIMIT,
	SAVED_PAGE_SIZE,
	TOOL_DESCRIPTION_LIMIT,
	TOOL_NAME_LIMIT,
	TOOL_OUTPUT_LIMIT,
} from "./site-tools";
import type {
	FindLotsArgs,
	FoundLots,
	LotAddress,
	LotPage,
	PageRequest,
	SiteToolDeps,
} from "./site-tools";

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

/** A search result with `count` long rows, for the budget check. */
const foundRows = (count: number): FoundLots => ({
	applied: { maxGrams: null, maxPriceCents: 5000, minGrams: 200 },
	considered: count,
	lots: Array.from({ length: count }, (_, index) => ({
		confirmedAt: 1_800_000_000_000,
		grams: 250,
		handle: `a-rather-long-lot-handle-number-${index}`,
		name: `Colombia Finca La Esperanza Pink Bourbon Lot ${index}`,
		priceCents: 2800 + index,
		productId: `products:found${index}` as Id<"products">,
		roasterName: "A Roaster With A Long Name",
		roasterSlug: "a-roaster-with-a-long-slug",
		says: "Sweet and juicy. ".repeat(30),
		url: `https://roaster.example.com/products/lot-${index}`,
		variantName: "250g",
	})),
});

const savedCard = (index: number) => ({
	available: index % 2 === 0,
	fromRunId: null,
	lot: {
		handle: `saved-lot-handle-number-${index}`,
		id: `products:saved${index}` as Id<"products">,
		imageUrl: null,
		name: `Ethiopia Guji Uraga Natural Lot ${index}`,
		status: "current" as const,
		url: `https://sey.example.com/products/saved-${index}`,
	},
	roaster: { name: "Sey Coffee Roasters", slug: "sey" },
	savedAt: 1_800_000_000_000 - index,
	savedId: `savedCoffees:${index}` as Id<"savedCoffees">,
});

interface Fake {
	deps: SiteToolDeps;
	finds: FindLotsArgs[];
	/** Every getLot call, for the cancellation tests. */
	lookups: LotAddress[];
	pages: PageRequest[];
	saves: Id<"products">[];
	unsaves: Id<"products">[];
	visits: string[];
}

const fake = (
	overrides: Partial<{
		isAuthenticated: boolean;
		isLoading: boolean;
		pathname: string;
		saved: Id<"products">[];
		savedCount: number;
		found: FoundLots;
		/** getLot resolves only when this does. */
		lotGate: PromiseWithResolvers<LotPage | null>;
		/** saveLot resolves only when this does. */
		saveGate: PromiseWithResolvers<null>;
		/** What every dependency throws instead of answering. */
		throws: Error;
	}> = {}
): Fake => {
	const saves = [...(overrides.saved ?? [])];
	const unsaves: Id<"products">[] = [];
	const finds: FindLotsArgs[] = [];
	const lookups: LotAddress[] = [];
	const pages: PageRequest[] = [];
	const visits: string[] = [];
	const cards = Array.from({ length: overrides.savedCount ?? 0 }, (_, i) =>
		savedCard(i)
	);
	const deps: SiteToolDeps = {
		auth: () => ({
			isAuthenticated: overrides.isAuthenticated ?? true,
			isLoading: overrides.isLoading ?? false,
		}),
		findLots: (args) => {
			finds.push(args);
			if (overrides.throws !== undefined) {
				return Promise.reject(overrides.throws);
			}
			return Promise.resolve(overrides.found ?? foundRows(0));
		},
		getLot: (address) => {
			lookups.push(address);
			if (overrides.throws !== undefined) {
				return Promise.reject(overrides.throws);
			}
			if (overrides.lotGate !== undefined) {
				return overrides.lotGate.promise;
			}
			return Promise.resolve(
				address.roaster === "sey" && address.lot === "mullugeta" ? page : null
			);
		},
		listSaved: (request) => {
			pages.push(request);
			const start = request.cursor === null ? 0 : Number(request.cursor);
			const slice = cards.slice(start, start + request.numItems);
			const end = start + slice.length;
			return Promise.resolve({
				continueCursor: String(end),
				isDone: end >= cards.length,
				page: slice,
			});
		},
		navigate: (pathname) => {
			visits.push(pathname);
			return Promise.resolve();
		},
		origin: "https://nouveau.coffee",
		pathname: () => overrides.pathname ?? "/roaster/sey/mullugeta",
		saveLot: (lotId) => {
			if (overrides.throws !== undefined) {
				return Promise.reject(overrides.throws);
			}
			saves.push(lotId);
			return overrides.saveGate?.promise ?? Promise.resolve(null);
		},
		savedLotIds: () => Promise.resolve([...saves]),
		unsaveLot: (lotId) => {
			unsaves.push(lotId);
			const at = saves.indexOf(lotId);
			if (at !== -1) {
				saves.splice(at, 1);
			}
			return Promise.resolve(null);
		},
	};
	return { deps, finds, lookups, pages, saves, unsaves, visits };
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
			"find_available_lots",
			"get_lot",
			"list_saved_lots",
			"save_lot",
			"unsave_lot",
			"open_page",
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
			["find_available_lots", true],
			["get_lot", true],
			["list_saved_lots", true],
			["save_lot", false],
			["unsave_lot", false],
			["open_page", false],
		]);
	});

	test("only the writes to the try list ask for confirmation", () => {
		const tools = buildSiteTools(fake().deps);
		const consequential = tools
			.filter((t) => t.annotations.consequentialHint === true)
			.map((t) => t.name);
		expect(consequential).toEqual(["save_lot", "unsave_lot"]);
	});

	test("results that quote roaster copy say so", () => {
		const tools = buildSiteTools(fake().deps);
		const quoting = tools
			.filter((t) => t.annotations.untrustedContentHint === true)
			.map((t) => t.name);
		expect(quoting).toEqual(["find_available_lots", "get_lot"]);
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

describe("find_available_lots", () => {
	test("passes the constraints through and returns address pairs", async () => {
		const fx = fake({ found: foundRows(2) });
		const result = await tool(fx, "find_available_lots").execute({
			maxPriceCents: 5000,
			minGrams: 200,
			preferences: "floral washed",
		});
		expect(fx.finds).toEqual([
			{ maxPriceCents: 5000, minGrams: 200, preferences: "floral washed" },
		]);
		expect(result).toMatchObject({
			applied: { maxGrams: null, maxPriceCents: 5000, minGrams: 200 },
			bounded: true,
			considered: 2,
			ok: true,
		});
		const { lots } = result as ReturnType<typeof describeFound>;
		expect(lots).toHaveLength(2);
		expect(lots[0]).toMatchObject({
			grams: 250,
			lot: "a-rather-long-lot-handle-number-0",
			priceCents: 2800,
			roaster: "a-roaster-with-a-long-slug",
		});
		expect(lots[0]?.says.endsWith("…")).toBe(true);
	});

	test("works signed out", async () => {
		const fx = fake({ found: foundRows(1), isAuthenticated: false });
		const result = await tool(fx, "find_available_lots").execute({
			preferences: "chocolate",
		});
		expect(result).toMatchObject({ ok: true });
	});

	test("empty or missing preferences is invalid input", async () => {
		const fx = fake();
		expect(
			await tool(fx, "find_available_lots").execute({ preferences: "  " })
		).toMatchObject({ error: { code: "invalid_input" }, ok: false });
		expect(await tool(fx, "find_available_lots").execute({})).toMatchObject({
			error: { code: "invalid_input" },
			ok: false,
		});
		expect(fx.finds).toEqual([]);
	});

	test("a full page of long rows fits the output budget", () => {
		const result = describeFound(foundRows(10));
		expect(result.lots).toHaveLength(FOUND_LOTS_CLIP);
		expect(result.considered).toBe(10);
		expect(JSON.stringify(result).length).toBeLessThanOrEqual(
			TOOL_OUTPUT_LIMIT
		);
	});
});

describe("list_saved_lots", () => {
	test("pages newest first with a cursor, within the output budget", async () => {
		const fx = fake({ savedCount: SAVED_PAGE_SIZE + 2 });
		const first = await tool(fx, "list_saved_lots").execute({});
		expect(fx.pages).toEqual([{ cursor: null, numItems: SAVED_PAGE_SIZE }]);
		expect(first).toMatchObject({
			nextCursor: String(SAVED_PAGE_SIZE),
			ok: true,
		});
		const { lots } = first as { lots: unknown[] };
		expect(lots).toHaveLength(SAVED_PAGE_SIZE);
		expect(lots[0]).toEqual({
			available: true,
			lot: "saved-lot-handle-number-0",
			name: "Ethiopia Guji Uraga Natural Lot 0",
			roaster: "sey",
			roasterName: "Sey Coffee Roasters",
			savedAt: 1_800_000_000_000,
			status: "current",
		});
		expect(JSON.stringify(first).length).toBeLessThanOrEqual(TOOL_OUTPUT_LIMIT);

		const second = await tool(fx, "list_saved_lots").execute({
			cursor: String(SAVED_PAGE_SIZE),
		});
		expect(second).toMatchObject({ nextCursor: null, ok: true });
		expect((second as { lots: unknown[] }).lots).toHaveLength(2);
	});

	test("signed out, nothing is read", async () => {
		const fx = fake({ isAuthenticated: false, savedCount: 3 });
		const result = await tool(fx, "list_saved_lots").execute({});
		expect(result).toMatchObject({
			error: { code: "sign_in_required" },
			ok: false,
		});
		expect(fx.pages).toEqual([]);
	});
});

describe("unsave_lot", () => {
	test("removes a save and returns a receipt", async () => {
		const fx = fake({ saved: [LOT_ID, OTHER_ID] });
		const result = await tool(fx, "unsave_lot").execute({});
		expect(result).toEqual({
			lotId: LOT_ID,
			lotPageUrl: "https://nouveau.coffee/roaster/sey/mullugeta",
			name: "Ethiopia Mullugeta Muntasha",
			ok: true,
			status: "unsaved",
		});
		expect(fx.unsaves).toEqual([LOT_ID]);
		expect(fx.saves).toEqual([OTHER_ID]);
	});

	test("a lot that is not saved reports not_saved and writes nothing", async () => {
		const fx = fake({ saved: [OTHER_ID] });
		const result = await tool(fx, "unsave_lot").execute({
			lot: "mullugeta",
			roaster: "sey",
		});
		expect(result).toMatchObject({ ok: true, status: "not_saved" });
		expect(fx.unsaves).toEqual([]);
	});

	test("signed out, nothing is removed", async () => {
		const fx = fake({ isAuthenticated: false, saved: [LOT_ID] });
		const result = await tool(fx, "unsave_lot").execute({});
		expect(result).toMatchObject({
			error: { code: "sign_in_required" },
			ok: false,
		});
		expect(fx.saves).toEqual([LOT_ID]);
	});
});

describe("open_page", () => {
	test("opens the fixed pages", async () => {
		const fx = fake();
		expect(await tool(fx, "open_page").execute({ page: "home" })).toEqual({
			ok: true,
			pathname: "/",
		});
		expect(await tool(fx, "open_page").execute({ page: "saved" })).toEqual({
			ok: true,
			pathname: "/saved",
		});
		expect(fx.visits).toEqual(["/", "/saved"]);
	});

	test("opens a roaster by slug and a lot by address, encoded", async () => {
		const fx = fake({ pathname: "/" });
		expect(
			await tool(fx, "open_page").execute({ page: "roaster", roaster: "sey" })
		).toEqual({ ok: true, pathname: "/roaster/sey" });
		expect(
			await tool(fx, "open_page").execute({
				lot: "mullugeta",
				page: "lot",
				roaster: "sey",
			})
		).toEqual({ ok: true, pathname: "/roaster/sey/mullugeta" });
		expect(fx.visits).toEqual(["/roaster/sey", "/roaster/sey/mullugeta"]);
	});

	test("an unknown lot, a missing roaster, or an unknown page opens nothing", async () => {
		const fx = fake({ pathname: "/" });
		expect(
			await tool(fx, "open_page").execute({
				lot: "nope",
				page: "lot",
				roaster: "sey",
			})
		).toMatchObject({ error: { code: "unknown_lot" }, ok: false });
		expect(
			await tool(fx, "open_page").execute({ page: "roaster" })
		).toMatchObject({ error: { code: "invalid_input" }, ok: false });
		expect(
			await tool(fx, "open_page").execute({ page: "settings" })
		).toMatchObject({ error: { code: "invalid_input" }, ok: false });
		expect(await tool(fx, "open_page").execute({ page: "lot" })).toMatchObject({
			error: { code: "no_lot_on_page" },
			ok: false,
		});
		expect(fx.visits).toEqual([]);
	});
});

describe("cancellation", () => {
	test("a signal already aborted stops the call before any read", async () => {
		const fx = fake();
		const controller = new AbortController();
		controller.abort();
		const result = await tool(fx, "save_lot").execute(
			{},
			{ signal: controller.signal }
		);
		expect(result).toMatchObject({ error: { code: "cancelled" }, ok: false });
		expect(fx.lookups).toEqual([]);
		expect(fx.saves).toEqual([]);
	});

	test("aborting during a read abandons it and never reaches the write", async () => {
		const lotGate = Promise.withResolvers<LotPage | null>();
		const fx = fake({ lotGate });
		const controller = new AbortController();
		const pending = tool(fx, "save_lot").execute(
			{},
			{ signal: controller.signal }
		);
		expect(fx.lookups).toHaveLength(1);
		controller.abort();
		expect(await pending).toMatchObject({
			error: { code: "cancelled" },
			ok: false,
		});
		lotGate.resolve(page);
		await Promise.resolve();
		expect(fx.saves).toEqual([]);
	});

	test("a write already sent runs to the end and the receipt says so", async () => {
		const saveGate = Promise.withResolvers<null>();
		const fx = fake({ saveGate });
		const controller = new AbortController();
		const pending = tool(fx, "save_lot").execute(
			{},
			{ signal: controller.signal }
		);
		await vi.waitFor(() => expect(fx.saves).toEqual([LOT_ID]));
		controller.abort();
		saveGate.resolve(null);
		expect(await pending).toMatchObject({ ok: true, status: "saved" });
	});

	test("reads honour the signal too", async () => {
		const fx = fake({ found: foundRows(1) });
		const controller = new AbortController();
		controller.abort();
		expect(
			await tool(fx, "find_available_lots").execute(
				{ preferences: "floral" },
				{ signal: controller.signal }
			)
		).toMatchObject({ error: { code: "cancelled" }, ok: false });
		expect(
			await tool(fx, "open_page").execute(
				{ page: "saved" },
				{ signal: controller.signal }
			)
		).toMatchObject({ error: { code: "cancelled" }, ok: false });
		expect(fx.finds).toEqual([]);
		expect(fx.visits).toEqual([]);
	});

	test("without a signal, calls run as before", async () => {
		const fx = fake();
		expect(await tool(fx, "save_lot").execute({})).toMatchObject({
			ok: true,
			status: "saved",
		});
	});
});

describe("thrown dependency errors", () => {
	test("come back as a backend_error envelope, never a throw", async () => {
		const fx = fake({ throws: new Error("[CONVEX Q(lots:get)] Server Error") });
		const result = await tool(fx, "get_lot").execute({});
		expect(result).toMatchObject({
			error: { code: "backend_error" },
			ok: false,
		});
		expect((result as { error: { message: string } }).error.message).toContain(
			"Server Error"
		);
	});

	test("a sign-out during the call reads as sign_in_required", async () => {
		const fx = fake({
			throws: new Error("Server Error Uncaught Error: Sign in required"),
		});
		const result = await tool(fx, "save_lot").execute({});
		expect(result).toMatchObject({
			error: { code: "sign_in_required" },
			ok: false,
		});
		expect(fx.saves).toEqual([]);
	});
});
