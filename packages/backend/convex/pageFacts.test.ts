import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { PAGE_FACTS_PER_HOUR } from "./pageFacts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	lotId: Id<"products">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
}

const PAGE_URL = "https://sey.example.com/products/mullugeta";
const PAGE_MARKDOWN = [
	"# Mullugeta",
	"Process: Natural",
	"Variety: Heirloom",
	"Altitude: 1,900 - 2,100 masl",
	"Tasting notes: peach, melon, red tea.",
	"In the cup we find peach, melon, and red tea.",
].join("\n\n");

/**
 * The two providers a read touches: Firecrawl returns the page markdown;
 * Jev answers every question with its first real option (Choice) or a yes
 * (Noul), so the stored facts follow from the fixture markdown.
 */
const stubProviders = ({
	jev = true,
	markdown = PAGE_MARKDOWN,
	statusCode = 200,
} = {}) => {
	const fetchMock = vi.fn((url: string, init?: RequestInit) => {
		if (url.includes("firecrawl")) {
			return Response.json({
				data: {
					markdown,
					metadata: { sourceURL: PAGE_URL, statusCode },
				},
				success: true,
			});
		}
		if (url.includes("typesafe")) {
			if (!jev) {
				return new Response("nope", { status: 500 });
			}
			const body = JSON.parse(String(init?.body)) as {
				questions: Record<
					string,
					{
						criteria?: Record<string, string | null>;
						type: string;
					}
				>;
			};
			const answers: Record<string, unknown> = {};
			for (const [key, question] of Object.entries(body.questions)) {
				if (question.type === "choice") {
					const choices = Object.keys(question.criteria ?? {}).find(
						(option) => option !== "none"
					);
					answers[key] = {
						choice: choices ?? "",
						confidence: 0.9,
						probabilities: {},
						type: "choice",
					};
				} else {
					answers[key] = { noul: 0.9, type: "noul" };
				}
			}
			return Response.json({
				answers,
				model: "jev-1.13.0",
				usage: { input_tokens: 900, output_tokens: 40 },
			});
		}
		throw new Error(`Unexpected fetch ${url}`);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
	vi.stubEnv("TYPESAFE_API_KEY", "test-key");
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

const setup = async (
	lotFields: Record<string, unknown> = {}
): Promise<Fixture> => {
	const t = convexTest(schema, modules);
	registerRateLimiter(t);
	registerFirecrawl(t);
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
			origin: "Ethiopia",
			roasterId: roaster,
			status: "current",
			...lotFields,
		});
		return { lot, roaster };
	});
	return { lotId: ids.lot, roasterId: ids.roaster, t };
};

const product = (fx: Fixture) => fx.t.run((ctx) => ctx.db.get(fx.lotId));

describe("pageFacts.request", () => {
	test("a thin lot's first look stamps the product and schedules one read; the next look waits", async () => {
		const fx = await setup();
		expect(
			await fx.t.mutation(api.pageFacts.request, { lotId: fx.lotId })
		).toBe("started");
		const stamped = await product(fx);
		expect(stamped?.copyFetchedAt).toEqual(expect.any(Number));
		expect(stamped?.pageFacts).toBeUndefined();
		// A second viewer in the same minute shares the read.
		expect(
			await fx.t.mutation(api.pageFacts.request, { lotId: fx.lotId })
		).toBe("known");
		const scheduled = await fx.t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect()
		);
		expect(scheduled).toHaveLength(1);
	});

	test("a settled lot, an archived lot and a bad id never schedule", async () => {
		const settled = await setup({
			process: "Washed",
			roasterNotes: ["peach"],
			variety: "Heirloom",
		});
		expect(
			await settled.t.mutation(api.pageFacts.request, { lotId: settled.lotId })
		).toBe("known");
		const archived = await setup({ status: "archived" });
		expect(
			await archived.t.mutation(api.pageFacts.request, {
				lotId: archived.lotId,
			})
		).toBe("none");
		expect(
			await archived.t.mutation(api.pageFacts.request, { lotId: "nonsense" })
		).toBe("none");
		const scheduled = await settled.t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect()
		);
		expect(scheduled).toHaveLength(0);
	});

	test("the deployment-wide hourly cap answers limited and leaves the lot unstamped", async () => {
		const fx = await setup();
		// Other thin lots burn the window first.
		for (let index = 0; index < PAGE_FACTS_PER_HOUR; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- sequential quota burn
			const other = await fx.t.run((ctx) =>
				ctx.db.insert("products", {
					externalId: `p${index + 2}`,
					firstSeenAt: 1000,
					handle: `lot-${index}`,
					lastSeenAt: 1000,
					missedCrawls: 0,
					name: `Lot ${index}`,
					roasterId: fx.roasterId,
					status: "current",
				})
			);
			// oxlint-disable-next-line no-await-in-loop -- sequential quota burn
			const result = await fx.t.mutation(api.pageFacts.request, {
				lotId: other,
			});
			expect(result).toBe("started");
		}
		expect(
			await fx.t.mutation(api.pageFacts.request, { lotId: fx.lotId })
		).toBe("limited");
		const unstamped = await product(fx);
		expect(unstamped?.copyFetchedAt).toBeUndefined();
	});
});

describe("pageFacts.store and the lot page", () => {
	test("verified facts land on the product and the lot page merges them under the feed", async () => {
		const fx = await setup();
		await fx.t.mutation(internal.pageFacts.store, {
			facts: {
				elevation: "1,900 - 2,100 masl",
				process: "Natural",
				tastingNotes: ["peach", "melon", "red tea"],
				variety: "Heirloom",
			},
			productId: fx.lotId,
		});
		const stored = await product(fx);
		expect(stored?.pageFacts).toEqual({
			elevation: "1,900 - 2,100 masl",
			process: "Natural",
			tastingNotes: ["peach", "melon", "red tea"],
			variety: "Heirloom",
		});
		const page = await fx.t.query(api.lots.get, { lotId: fx.lotId });
		expect(page?.lot).toMatchObject({
			facts: {
				elevation: "1,900 - 2,100 masl",
				notes: ["peach", "melon", "red tea"],
				origin: "Ethiopia",
				process: "Natural",
				variety: "Heirloom",
			},
			pageFactsKnown: true,
			thin: false,
		});
		// The lot is settled: no further reads.
		expect(
			await fx.t.mutation(api.pageFacts.request, { lotId: fx.lotId })
		).toBe("known");
	});

	test("an empty read keeps the attempt stamp and no pageFacts", async () => {
		const fx = await setup();
		await fx.t.mutation(internal.pageFacts.store, {
			facts: {},
			productId: fx.lotId,
		});
		const stored = await product(fx);
		expect(stored?.copyFetchedAt).toEqual(expect.any(Number));
		expect(stored?.pageFacts).toBeUndefined();
	});

	test("the feed write never touches pageFacts", async () => {
		const fx = await setup();
		await fx.t.mutation(internal.pageFacts.store, {
			facts: { variety: "Heirloom" },
			productId: fx.lotId,
		});
		// A crawl-style write with authoritative lotCopy that lacks variety.
		await fx.t.run((ctx) =>
			ctx.db.patch(fx.lotId, { process: "Washed", roasterNotes: undefined })
		);
		const kept = await product(fx);
		expect(kept?.pageFacts).toEqual({ variety: "Heirloom" });
	});
});

describe("pageFacts.scrape", () => {
	test("one markdown scrape and one Jev request; the picks become facts", async () => {
		const fx = await setup();
		const fetchMock = stubProviders();
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const scrape = fetchMock.mock.calls.find(([url]) =>
			String(url).includes("firecrawl")
		);
		expect(JSON.parse(String(scrape?.[1]?.body)).formats).toEqual(["markdown"]);
		const read = await product(fx);
		expect(read?.pageFacts).toEqual({
			elevation: "1,900 - 2,100 masl",
			process: "Natural",
			tastingNotes: ["peach", "melon", "red tea"],
			variety: "Heirloom",
		});
	});

	test("a Jev failure stores nothing and the lot retries after the window", async () => {
		const fx = await setup();
		stubProviders({ jev: false });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const untouched = await product(fx);
		expect(untouched?.pageFacts).toBeUndefined();
		expect(untouched?.copyFetchedAt).toEqual(expect.any(Number));
	});

	test("an unavailable page stores nothing", async () => {
		const fx = await setup();
		stubProviders({ statusCode: 404 });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const untouched = await product(fx);
		expect(untouched?.pageFacts).toBeUndefined();
	});
});
