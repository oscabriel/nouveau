import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_PAGE_READS, PAGE_FACTS_RETRY_MS } from "./lotFacts";
import {
	FIRECRAWL_FALLBACK_PER_MINUTE,
	PAGE_FACTS_PER_HOUR,
	PAGE_SWEEP_PER_CRAWL,
	PAGE_SWEEP_SPACING_MS,
	samePage,
} from "./pageFacts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

interface Fixture {
	lotId: Id<"products">;
	roasterId: Id<"roasters">;
	t: ReturnType<typeof convexTest>;
}

const PAGE_URL = "https://sey.example.com/products/mullugeta";
/** Where a shop sends a dead handle: a collection page, 200 and HTML. */
const COLLECTION_URL = "https://sey.example.com/collections/all";
/** Every field the page validator carries, as a full feed would state them. */
const COMPLETE_FEED = {
	elevation: "1,900 masl",
	process: "Washed",
	producer: "Mullugeta Muntasha",
	region: "Yirgacheffe",
	roastLevel: "Light",
	roasterNotes: ["peach"],
	variety: "Heirloom",
};
const PAGE_MARKDOWN = [
	"# Mullugeta",
	"Process: Natural",
	"Variety: Heirloom",
	"Altitude: 1,900 - 2,100 masl",
	"Tasting notes: peach, melon, red tea.",
	"In the cup we find peach, melon, and red tea.",
].join("\n\n");

/** The same page as the shop serves it: theme chrome around the facts. */
const PAGE_HTML = [
	"<html><body><header><nav><a href='/'>Home</a> | <a href='/shop'>Shop</a></nav></header>",
	"<main><h1>Mullugeta</h1>",
	"<p>Process: Natural</p><p>Variety: Heirloom</p>",
	"<p>Altitude: 1,900 - 2,100 masl</p>",
	"<p>Tasting notes: peach, melon, red tea.</p>",
	"<p>In the cup we find peach, melon, and red tea.</p>",
	"<p>Mullugeta Muntasha's washing station sits above Yirgacheffe town. Cherries are sorted by hand, fermented for 48 hours and dried slowly on raised beds for three weeks.</p></main>",
	"<footer>Subscribe | Terms</footer></body></html>",
].join("\n");

interface ProviderOptions {
	/** The URL the shop's response reports; differs from the ask on a redirect. */
	answeredUrl?: string;
	/** The shop's page body; null means the shop answered with an error. */
	html?: string | null;
	jev?: boolean;
	markdown?: string;
	statusCode?: number;
	/** The shop never answers: the plain fetch aborts on its timeout. */
	timeout?: boolean;
	/** Firecrawl's HTTP status; 429 is its rate limit. */
	firecrawlStatus?: number;
}

/**
 * The providers a read touches. The shop serves the product page itself
 * (`html`; null means the shop answered with an error); Firecrawl is the
 * fallback and returns the page markdown; Jev answers every question with
 * its first real option (Choice) or a yes (Noul), so the stored facts
 * follow from the fixture page.
 */
const stubProviders = ({
	answeredUrl,
	firecrawlStatus = 200,
	html = PAGE_HTML,
	jev = true,
	markdown = PAGE_MARKDOWN,
	statusCode = 200,
	timeout = false,
}: ProviderOptions = {}) => {
	const fetchMock = vi.fn((url: string, init?: RequestInit) => {
		if (url.startsWith(PAGE_URL)) {
			if (timeout) {
				throw new DOMException("The operation timed out", "TimeoutError");
			}
			const response =
				html === null
					? new Response("shop down", { status: 500 })
					: new Response(html, {
							headers: { "content-type": "text/html; charset=utf-8" },
							status: statusCode,
						});
			Object.defineProperty(response, "url", { value: answeredUrl ?? url });
			return response;
		}
		if (url.includes("firecrawl")) {
			if (firecrawlStatus !== 200) {
				return new Response("Rate limit exceeded", {
					headers: { "retry-after": "0" },
					status: firecrawlStatus,
				});
			}
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

	test("a lot with page facts but a field still missing gets another read; a lot at the read cap does not", async () => {
		const partial = await setup({
			copyFetchedAt: Date.now() - PAGE_FACTS_RETRY_MS - 1,
			pageFacts: { process: "Washed" },
			pageReads: 1,
		});
		expect(
			await partial.t.mutation(api.pageFacts.request, { lotId: partial.lotId })
		).toBe("started");
		const capped = await setup({
			copyFetchedAt: Date.now() - PAGE_FACTS_RETRY_MS - 1,
			pageFacts: { process: "Washed" },
			pageReads: MAX_PAGE_READS,
		});
		expect(
			await capped.t.mutation(api.pageFacts.request, { lotId: capped.lotId })
		).toBe("known");
		const scheduled = await capped.t.run((ctx) =>
			ctx.db.system.query("_scheduled_functions").collect()
		);
		expect(scheduled).toHaveLength(0);
	});

	test("a complete lot, an archived lot and a bad id never schedule", async () => {
		const settled = await setup(COMPLETE_FEED);
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

const insertLot = (
	fx: Fixture,
	index: number,
	fields: Record<string, unknown> = {}
) =>
	fx.t.run((ctx) =>
		ctx.db.insert("products", {
			externalId: `s${index}`,
			firstSeenAt: 1000,
			handle: `sweep-${index}`,
			lastSeenAt: 1000,
			missedCrawls: 0,
			name: `Sweep ${index}`,
			roasterId: fx.roasterId,
			status: "current",
			...fields,
		})
	);
const scheduledReads = (fx: Fixture) =>
	fx.t.run(async (ctx) => {
		const rows = await ctx.db.system.query("_scheduled_functions").collect();
		return rows.filter((row) => row.name === "pageFacts:scrape");
	});

describe("pageFacts.sweep", () => {
	test("after a crawl, every current lot missing a page fact is stamped and gets one read; complete, tried, capped and archived lots are left alone", async () => {
		const fx = await setup();
		const settled = await insertLot(fx, 1, COMPLETE_FEED);
		const triedToday = await insertLot(fx, 2, { copyFetchedAt: Date.now() });
		const archived = await insertLot(fx, 3, { status: "archived" });
		const thin = await insertLot(fx, 4);
		const capped = await insertLot(fx, 5, {
			copyFetchedAt: Date.now() - PAGE_FACTS_RETRY_MS - 1,
			pageReads: MAX_PAGE_READS,
		});
		const count = await fx.t.mutation(internal.pageFacts.sweep, {
			roasterId: fx.roasterId,
		});
		expect(count).toBe(2);
		const reads = await scheduledReads(fx);
		expect(reads.map((row) => row.args[0])).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ productId: fx.lotId }),
				expect.objectContaining({ productId: thin }),
			])
		);
		expect(reads).toHaveLength(2);
		const rows = await fx.t.run((ctx) =>
			Promise.all(
				[settled, triedToday, archived, thin, capped].map((id) =>
					ctx.db.get(id)
				)
			)
		);
		expect(rows[0]?.copyFetchedAt).toBeUndefined();
		expect(rows[2]?.copyFetchedAt).toBeUndefined();
		expect(rows[3]?.copyFetchedAt).toEqual(expect.any(Number));
		expect(rows[4]?.copyFetchedAt).toBeLessThan(
			Date.now() - PAGE_FACTS_RETRY_MS
		);
		// The next sweep in the same day finds nothing to do.
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(0);
	});

	test("a sweep reads at most PAGE_SWEEP_PER_CRAWL lots, spaced apart, and the rest wait for the next crawl", async () => {
		const fx = await setup();
		/** Lots past the cap, besides the fixture lot. */
		const extraLots = 5;
		for (let index = 0; index < PAGE_SWEEP_PER_CRAWL + extraLots; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- sequential inserts
			await insertLot(fx, 10 + index);
		}
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(PAGE_SWEEP_PER_CRAWL);
		const reads = await scheduledReads(fx);
		expect(reads).toHaveLength(PAGE_SWEEP_PER_CRAWL);
		const times = reads.map((row) => row.scheduledTime);
		expect(Math.max(...times) - Math.min(...times)).toBe(
			(PAGE_SWEEP_PER_CRAWL - 1) * PAGE_SWEEP_SPACING_MS
		);
		// The lots left over are unstamped, so the next crawl's sweep takes them.
		const leftOver = extraLots + 1;
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(leftOver);
	});

	test("a lot without a shop URL never holds one of the sweep's slots", async () => {
		const fx = await setup();
		// productUrl refuses a handle with spaces, and the lot stores no url.
		for (let index = 0; index < PAGE_SWEEP_PER_CRAWL; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- sequential inserts
			await insertLot(fx, 100 + index, { handle: `no handle ${index}` });
		}
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(1);
		const reads = await scheduledReads(fx);
		expect(reads.map((row) => row.args[0])).toEqual([
			expect.objectContaining({ productId: fx.lotId }),
		]);
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
		// The read is counted and inside the retry window; producer, region
		// and roast level are still missing, so the window's end brings
		// another read.
		expect(stored?.pageReads).toBe(1);
		expect(
			await fx.t.mutation(api.pageFacts.request, { lotId: fx.lotId })
		).toBe("known");
		vi.setSystemTime(Date.now() + PAGE_FACTS_RETRY_MS + 1);
		expect(
			await fx.t.mutation(api.pageFacts.request, { lotId: fx.lotId })
		).toBe("started");
	});

	test("a later read adds its facts over the earlier read's instead of replacing them", async () => {
		const fx = await setup({
			pageFacts: { process: "Natural", variety: "Heirloom" },
			pageReads: 1,
		});
		await fx.t.mutation(internal.pageFacts.store, {
			facts: { producer: "Mullugeta Muntasha", variety: "74158" },
			productId: fx.lotId,
		});
		const stored = await product(fx);
		expect(stored?.pageFacts).toEqual({
			process: "Natural",
			producer: "Mullugeta Muntasha",
			variety: "74158",
		});
		expect(stored?.pageReads).toBe(2);
	});

	test("an empty read keeps the attempt stamp, counts the read and stores no pageFacts", async () => {
		const fx = await setup();
		await fx.t.mutation(internal.pageFacts.store, {
			facts: {},
			productId: fx.lotId,
		});
		const stored = await product(fx);
		expect(stored?.copyFetchedAt).toEqual(expect.any(Number));
		expect(stored?.pageFacts).toBeUndefined();
		expect(stored?.pageReads).toBe(1);
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
	test("the shop's own page and one Jev request; no Firecrawl credit when the page has content", async () => {
		const fx = await setup();
		const fetchMock = stubProviders();
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(
			fetchMock.mock.calls.some(([url]) => String(url).includes("firecrawl"))
		).toBe(false);
		const read = await product(fx);
		expect(read?.pageFacts).toEqual({
			elevation: "1,900 - 2,100 masl",
			process: "Natural",
			tastingNotes: ["peach", "melon", "red tea"],
			variety: "Heirloom",
		});
	});

	test("a shop that answers with an error falls back to one markdown scrape", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ html: null });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(fetchMock).toHaveBeenCalledTimes(3);
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

	test("a rate-limited fallback keeps the stamp but is not a counted read", async () => {
		const fx = await setup();
		stubProviders({ firecrawlStatus: 429, html: null });
		const before = Date.now();
		await fx.t.run((ctx) => ctx.db.patch(fx.lotId, { copyFetchedAt: before }));
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const read = await product(fx);
		expect(read?.pageFacts).toBeUndefined();
		expect(read?.pageReads).toBeUndefined();
		expect(read?.copyFetchedAt).toBe(before);
	});

	test("the Firecrawl fallback has a deployment-wide budget a minute; a deferred read is not counted", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ html: null });
		for (let index = 0; index < FIRECRAWL_FALLBACK_PER_MINUTE + 1; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- reads in sequence, the last one over budget
			await fx.t.action(internal.pageFacts.scrape, {
				productId: fx.lotId,
				url: PAGE_URL,
			});
		}
		const scrapes = fetchMock.mock.calls.filter(([url]) =>
			String(url).includes("firecrawl")
		);
		expect(scrapes).toHaveLength(FIRECRAWL_FALLBACK_PER_MINUTE);
		const read = await product(fx);
		expect(read?.pageReads).toBe(FIRECRAWL_FALLBACK_PER_MINUTE);
	});

	test("a page that is only a script shell falls back to Firecrawl", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({
			html: "<html><body><div id='app'></div><script>render()</script></body></html>",
		});
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(
			fetchMock.mock.calls.some(([url]) => String(url).includes("firecrawl"))
		).toBe(true);
		const read = await product(fx);
		expect(read?.pageFacts?.tastingNotes).toEqual([
			"peach",
			"melon",
			"red tea",
		]);
	});

	test("a shop that redirects the handle to another page is not read as the lot's page; Firecrawl decides", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ answeredUrl: COLLECTION_URL });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(
			fetchMock.mock.calls.some(([url]) => String(url).includes("firecrawl"))
		).toBe(true);
		const read = await product(fx);
		expect(read?.pageFacts?.process).toBe("Natural");
	});

	test("a shop that never answers falls back to Firecrawl instead of failing the read", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ timeout: true });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(
			fetchMock.mock.calls.some(([url]) => String(url).includes("firecrawl"))
		).toBe(true);
		const read = await product(fx);
		expect(read?.pageFacts?.process).toBe("Natural");
	});

	test("the same path with a query string dropped is the page that was asked for", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ answeredUrl: PAGE_URL });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: `${PAGE_URL}?variant=1`,
		});
		expect(
			fetchMock.mock.calls.some(([url]) => String(url).includes("firecrawl"))
		).toBe(false);
		const read = await product(fx);
		expect(read?.pageFacts?.process).toBe("Natural");
	});

	test("samePage ignores a trailing slash and an https upgrade, and nothing else", () => {
		expect(samePage(PAGE_URL, `${PAGE_URL}/`)).toBe(true);
		expect(samePage(PAGE_URL, `${PAGE_URL}?variant=1#top`)).toBe(true);
		expect(samePage(PAGE_URL.replace("https:", "http:"), PAGE_URL)).toBe(true);
		expect(samePage(PAGE_URL, PAGE_URL.replace("https:", "http:"))).toBe(false);
		expect(samePage(PAGE_URL, COLLECTION_URL)).toBe(false);
		expect(samePage(PAGE_URL, PAGE_URL.replace("sey.", "www.sey."))).toBe(
			false
		);
		expect(samePage(PAGE_URL, "not a url")).toBe(false);
	});

	test("a Jev failure stores nothing, counts the read and the lot retries after the window", async () => {
		const fx = await setup();
		stubProviders({ jev: false });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const untouched = await product(fx);
		expect(untouched?.pageFacts).toBeUndefined();
		expect(untouched?.copyFetchedAt).toEqual(expect.any(Number));
		expect(untouched?.pageReads).toBe(1);
	});

	test("an unavailable page stores nothing and still counts as a read", async () => {
		const fx = await setup({ pageReads: 1 });
		stubProviders({ html: null, statusCode: 404 });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const untouched = await product(fx);
		expect(untouched?.pageFacts).toBeUndefined();
		expect(untouched?.copyFetchedAt).toEqual(expect.any(Number));
		expect(untouched?.pageReads).toBe(2);
	});
});
