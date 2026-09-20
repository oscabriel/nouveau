import { MINUTE } from "@convex-dev/rate-limiter";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { register as registerFirecrawl } from "@firecrawl/firecrawl-convex/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { MAX_PAGE_READS, PAGE_FACTS_RETRY_MS } from "./lotFacts";
import {
	FIRECRAWL_PLAN_SCRAPES_PER_MINUTE,
	FIRECRAWL_READS_PER_MINUTE,
	MAX_READ_DEFERRALS,
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
	/** The page as Firecrawl renders it. */
	rendered?: string;
	statusCode?: number;
	/** The shop never answers: the plain fetch aborts on its timeout. */
	timeout?: boolean;
	/** Firecrawl's HTTP status; 429 is its rate limit. */
	firecrawlStatus?: number;
}

/** The line Jev's stub picks per field: the fixture's spec lines, as the reader offers them. */
const STUB_PICKS: Record<string, RegExp> = {
	elevation: /1,900/u,
	process: /Natural/u,
	variety: /Heirloom/u,
};

/**
 * The providers a read touches. Firecrawl renders the product page
 * (`rendered`) and is asked first; the shop serves the page itself
 * (`html`; null means the shop answered with an error) and is the fallback
 * when Firecrawl cannot answer; Jev picks the fixture's spec line
 * for each field it states (Choice) and passes a note line or a sentence
 * that mentions peach (Noul), so the stored facts follow from the page.
 */
const stubProviders = ({
	answeredUrl,
	firecrawlStatus = 200,
	html = PAGE_HTML,
	jev = true,
	rendered = PAGE_HTML,
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
					html: rendered,
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
						instructions: string;
						type: string;
					}
				>;
			};
			const answers: Record<string, unknown> = {};
			for (const [key, question] of Object.entries(body.questions)) {
				if (question.type === "choice") {
					const wanted = STUB_PICKS[key];
					const line = Object.keys(question.criteria ?? {}).find((option) =>
						wanted === undefined ? false : wanted.test(option)
					);
					answers[key] = {
						choice: line ?? "none",
						confidence: 0.9,
						probabilities: {},
						type: "choice",
					};
				} else {
					answers[key] = {
						noul: question.instructions.includes("peach") ? 0.9 : 0.1,
						type: "noul",
					};
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
				expect.objectContaining({
					name: "Ethiopia Mullugeta Muntasha",
					productId: fx.lotId,
				}),
				expect.objectContaining({ name: "Sweep 4", productId: thin }),
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

	test("a sold-out lot never holds one of the sweep's slots; it reads once a size is purchasable again", async () => {
		const fx = await setup();
		// Sey's feed keeps years of sold-out lots current; the fixture lot has
		// no rollup yet (no variants seen), which is not evidence of sold out.
		const soldOut = await insertLot(fx, 200, { anyAvailable: false });
		const onSale = await insertLot(fx, 201, { anyAvailable: true });
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(2);
		const reads = await scheduledReads(fx);
		expect(reads.map((row) => row.args[0])).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ productId: fx.lotId }),
				expect.objectContaining({ productId: onSale }),
			])
		);
		expect(reads).toHaveLength(2);

		await fx.t.run((ctx) => ctx.db.patch(soldOut, { anyAvailable: true }));
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(1);
		const later = await scheduledReads(fx);
		expect(later.map((row) => row.args[0])).toContainEqual(
			expect.objectContaining({ productId: soldOut })
		);
	});
});

describe("pageFacts.resetReads", () => {
	const READ_TODAY = {
		copyFetchedAt: Date.now(),
		pageFacts: { tastingNotes: ["Blend jasmine", "mango"] },
		pageReads: 2,
	};

	test("clears the count and the stamp on the roaster's current lots, so the next sweep reads them; facts stay unless asked", async () => {
		const fx = await setup(READ_TODAY);
		const archived = await insertLot(fx, 1, {
			...READ_TODAY,
			status: "archived",
		});
		const otherRoaster = await fx.t.run(async (ctx) => {
			const roaster = await ctx.db.insert("roasters", {
				city: "Denver",
				claimed: false,
				domain: "bloom.example.com",
				name: "Bloom",
				productPageUrl: "https://bloom.example.com/collections/coffee",
				slug: "bloom",
				source: "curated",
				state: "CO",
				status: "active",
				websiteUrl: "https://bloom.example.com",
			});
			return ctx.db.insert("products", {
				...READ_TODAY,
				externalId: "b1",
				firstSeenAt: 1000,
				handle: "wuri",
				lastSeenAt: 1000,
				missedCrawls: 0,
				name: "Wuri",
				roasterId: roaster,
				status: "current",
			});
		});
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(0);
		expect(
			await fx.t.mutation(internal.pageFacts.resetReads, {
				roasterId: fx.roasterId,
			})
		).toBe(1);
		const reset = await product(fx);
		expect(reset?.pageReads).toBeUndefined();
		expect(reset?.copyFetchedAt).toBeUndefined();
		expect(reset?.pageFacts).toEqual(READ_TODAY.pageFacts);
		const untouched = await fx.t.run((ctx) =>
			Promise.all([ctx.db.get(archived), ctx.db.get(otherRoaster)])
		);
		expect(untouched[0]?.pageReads).toBe(2);
		expect(untouched[1]?.pageReads).toBe(2);
		expect(
			await fx.t.mutation(internal.pageFacts.sweep, { roasterId: fx.roasterId })
		).toBe(1);
	});

	test("with clearFacts the stored page facts go too, and a lot with nothing to clear is not counted", async () => {
		const fx = await setup(READ_TODAY);
		await insertLot(fx, 2);
		expect(
			await fx.t.mutation(internal.pageFacts.resetReads, {
				clearFacts: true,
				roasterId: fx.roasterId,
			})
		).toBe(1);
		const reset = await product(fx);
		expect(reset?.pageFacts).toBeUndefined();
		expect(reset?.pageReads).toBeUndefined();
		expect(reset?.copyFetchedAt).toBeUndefined();
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
		const page = await fx.t.query(api.lots.get, {
			lot: "mullugeta",
			roaster: "sey",
		});
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
	// Sweet Bloom's featured-products block once passed Jev's "the one
	// coffee sold on this page" question with another blend's notes. The
	// read now names the lot, in the state and in every question.
	test("the read names the lot in Jev's state and questions; a read without a name still asks", async () => {
		const fx = await setup();
		const fetchMock = stubProviders();
		await fx.t.action(internal.pageFacts.scrape, {
			name: "Ethiopia Mullugeta Muntasha",
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const jev = fetchMock.mock.calls.find(([url]) =>
			String(url).includes("typesafe")
		);
		const body = JSON.parse(String(jev?.[1]?.body)) as {
			questions: Record<
				string,
				{ criteria?: Record<string, string | null>; instructions: string }
			>;
			state: string;
		};
		expect(body.state.startsWith("Coffee: Ethiopia Mullugeta Muntasha\n")).toBe(
			true
		);
		expect(Object.keys(body.questions)).toEqual(
			expect.arrayContaining(["process", "variety", "note_0"])
		);
		for (const question of Object.values(body.questions)) {
			expect(question.instructions).toContain('"Ethiopia Mullugeta Muntasha"');
		}
		// One Choice per field over the page's lines (ADR-0010), and one Noul
		// per note-shaped line, the line spelled out in the question.
		expect(Object.keys(body.questions.process?.criteria ?? {})).toEqual(
			expect.arrayContaining(["Mullugeta", "Process: Natural", "none"])
		);
		expect(body.questions.note_0?.instructions).toContain(
			'"Tasting notes: peach, melon, red tea."'
		);
		fetchMock.mockClear();
		await fx.t.run((ctx) =>
			ctx.db.patch(fx.lotId, { copyFetchedAt: undefined, pageReads: undefined })
		);
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const unnamed = fetchMock.mock.calls.find(([url]) =>
			String(url).includes("typesafe")
		);
		const unnamedBody = JSON.parse(String(unnamed?.[1]?.body)) as {
			questions: Record<string, { instructions: string }>;
			state: string;
		};
		expect(unnamedBody.state.startsWith("Coffee:")).toBe(false);
		expect(unnamedBody.questions.note_0?.instructions).toContain(
			"the one coffee sold on this product page"
		);
	});

	test("Firecrawl's rendered page first, html format only, then one Jev request; the shop itself is not asked", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ html: null });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const scrape = fetchMock.mock.calls.find(([url]) =>
			String(url).includes("firecrawl")
		);
		expect(JSON.parse(String(scrape?.[1]?.body)).formats).toEqual(["html"]);
		const read = await product(fx);
		expect(read?.pageFacts).toEqual({
			elevation: "1,900 - 2,100 masl",
			process: "Natural",
			tastingNotes: ["peach", "melon", "red tea"],
			variety: "Heirloom",
		});
	});

	test("Firecrawl's rate limit falls back to the shop's own page at no credit; the read counts", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ firecrawlStatus: 429 });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		// The component retries the 429 on its own before giving up.
		const asked = fetchMock.mock.calls.map(([url]) => String(url));
		expect(asked.filter((url) => url.startsWith(PAGE_URL))).toHaveLength(1);
		expect(asked.filter((url) => url.includes("typesafe"))).toHaveLength(1);
		const read = await product(fx);
		expect(read?.pageFacts).toEqual({
			elevation: "1,900 - 2,100 masl",
			process: "Natural",
			tastingNotes: ["peach", "melon", "red tea"],
			variety: "Heirloom",
		});
		expect(read?.pageReads).toBe(1);
		expect(await scheduledReads(fx)).toHaveLength(0);
	});

	test("a rate-limited read the shop cannot cover keeps the stamp, is not counted, and runs again after Firecrawl's minute", async () => {
		const fx = await setup();
		stubProviders({ firecrawlStatus: 429, html: null });
		const before = Date.now();
		await fx.t.run((ctx) => ctx.db.patch(fx.lotId, { copyFetchedAt: before }));
		await fx.t.action(internal.pageFacts.scrape, {
			name: "Ethiopia Mullugeta Muntasha",
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const read = await product(fx);
		expect(read?.pageFacts).toBeUndefined();
		expect(read?.pageReads).toBeUndefined();
		expect(read?.copyFetchedAt).toBe(before);
		const [retry] = await scheduledReads(fx);
		expect(retry?.scheduledTime).toBe(before + MINUTE);
		expect(retry?.args[0]).toEqual(
			expect.objectContaining({
				deferrals: 1,
				name: "Ethiopia Mullugeta Muntasha",
				productId: fx.lotId,
				url: PAGE_URL,
			})
		);
	});

	test("reads share a deployment-wide Firecrawl budget, one at a time at the plan's rate; a read past it is not counted, reserves its slot and runs there", async () => {
		const fx = await setup();
		const fetchMock = stubProviders({ html: null });
		const stamp = Date.now();
		await fx.t.run((ctx) => ctx.db.patch(fx.lotId, { copyFetchedAt: stamp }));
		// Two reads in the same instant: the budget admits one and holds the
		// next slot for the other, one interval later.
		for (let index = 0; index < 2; index += 1) {
			// oxlint-disable-next-line no-await-in-loop -- reads in sequence, the second over budget
			await fx.t.action(internal.pageFacts.scrape, {
				productId: fx.lotId,
				url: PAGE_URL,
			});
		}
		const scrapes = () =>
			fetchMock.mock.calls.filter(([url]) => String(url).includes("firecrawl"));
		expect(scrapes()).toHaveLength(1);
		const deferred = await product(fx);
		expect(deferred?.pageReads).toBe(1);
		expect(deferred?.copyFetchedAt).toBe(stamp);
		// The shop was asked once for the deferred read, at no credit.
		expect(
			fetchMock.mock.calls.filter(([url]) => String(url).startsWith(PAGE_URL))
		).toHaveLength(1);
		const [retry] = await scheduledReads(fx);
		expect(retry?.scheduledTime).toBeCloseTo(
			stamp + MINUTE / FIRECRAWL_READS_PER_MINUTE,
			-1
		);
		expect(retry?.args[0]).toEqual(
			expect.objectContaining({ deferrals: 1, reserved: true })
		);
		await fx.t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(scrapes()).toHaveLength(2);
		const read = await product(fx);
		expect(read?.pageReads).toBe(2);
		expect(read?.pageFacts?.process).toBe("Natural");
	});

	test("the budget never admits more than the plan's minute in any sixty seconds: no burst", () => {
		// A token bucket admits capacity + rate in a fixed window; Firecrawl's
		// window is fixed, so the burst must be one and the rate one under.
		expect(FIRECRAWL_READS_PER_MINUTE).toBe(
			FIRECRAWL_PLAN_SCRAPES_PER_MINUTE - 1
		);
	});

	test("a read put off MAX_READ_DEFERRALS times gives up to the lot's next window: stamp kept, nothing scheduled", async () => {
		const fx = await setup();
		stubProviders({ firecrawlStatus: 429, html: null });
		const before = Date.now();
		await fx.t.run((ctx) => ctx.db.patch(fx.lotId, { copyFetchedAt: before }));
		await fx.t.action(internal.pageFacts.scrape, {
			deferrals: MAX_READ_DEFERRALS,
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const read = await product(fx);
		expect(read?.pageReads).toBeUndefined();
		expect(read?.copyFetchedAt).toBe(before);
		expect(await scheduledReads(fx)).toHaveLength(0);
	});

	test("a reserved rerun that meets Firecrawl's rate limit keeps its slot for the next try", async () => {
		const fx = await setup();
		stubProviders({ firecrawlStatus: 429, html: null });
		await fx.t.action(internal.pageFacts.scrape, {
			deferrals: 1,
			productId: fx.lotId,
			reserved: true,
			url: PAGE_URL,
		});
		const [retry] = await scheduledReads(fx);
		expect(retry?.args[0]).toEqual(
			expect.objectContaining({ deferrals: 2, reserved: true })
		);
	});

	/** A read that could not reach the page: no facts, no count, one retry scheduled. */
	const expectDeferred = async (fx: Fixture) => {
		const read = await product(fx);
		expect(read?.pageFacts).toBeUndefined();
		expect(read?.pageReads).toBeUndefined();
		expect(await scheduledReads(fx)).toHaveLength(1);
	};

	test("with Firecrawl rate-limited, a shop page that is only a script shell defers the read", async () => {
		const fx = await setup();
		stubProviders({
			firecrawlStatus: 429,
			html: "<html><body><div id='app'></div><script>render()</script></body></html>",
		});
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		await expectDeferred(fx);
	});

	test("with Firecrawl rate-limited, a shop that redirects the handle to another page is not read as the lot's page", async () => {
		const fx = await setup();
		stubProviders({ answeredUrl: COLLECTION_URL, firecrawlStatus: 429 });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		await expectDeferred(fx);
	});

	test("with Firecrawl rate-limited, a shop that never answers defers the read instead of failing it", async () => {
		const fx = await setup();
		stubProviders({ firecrawlStatus: 429, timeout: true });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		await expectDeferred(fx);
	});

	test("the same path with a query string dropped is the page that was asked for", async () => {
		const fx = await setup();
		stubProviders({ answeredUrl: PAGE_URL, firecrawlStatus: 429 });
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: `${PAGE_URL}?variant=1`,
		});
		const read = await product(fx);
		expect(read?.pageFacts?.process).toBe("Natural");
		expect(read?.pageReads).toBe(1);
	});

	test("samePage allows a trailing slash, an https upgrade, the www host and a renamed handle, and nothing else", () => {
		expect(samePage(PAGE_URL, `${PAGE_URL}/`)).toBe(true);
		expect(samePage(PAGE_URL, `${PAGE_URL}?variant=1#top`)).toBe(true);
		expect(samePage(PAGE_URL.replace("https:", "http:"), PAGE_URL)).toBe(true);
		expect(samePage(PAGE_URL, PAGE_URL.replace("https:", "http:"))).toBe(false);
		expect(samePage(PAGE_URL, COLLECTION_URL)).toBe(false);
		// Sey answers from www; Sweet Bloom renamed hometown to hometown-blend.
		expect(samePage(PAGE_URL, PAGE_URL.replace("sey.", "www.sey."))).toBe(true);
		expect(samePage(PAGE_URL.replace("sey.", "www.sey."), PAGE_URL)).toBe(true);
		expect(samePage(PAGE_URL, `${PAGE_URL}-blend`)).toBe(true);
		// Another shop's product page is not this shop's.
		expect(samePage(PAGE_URL, PAGE_URL.replace("sey.", "other."))).toBe(false);
		expect(samePage(PAGE_URL, "https://sey.example.com/products/")).toBe(false);
		expect(samePage(PAGE_URL, "not a url")).toBe(false);
	});

	test("a shop that answers a renamed handle from its www host is read as the lot's page", async () => {
		const fx = await setup();
		stubProviders({
			answeredUrl: "https://www.sey.example.com/products/mullugeta-2026",
			firecrawlStatus: 429,
		});
		await fx.t.action(internal.pageFacts.scrape, {
			productId: fx.lotId,
			url: PAGE_URL,
		});
		const read = await product(fx);
		expect(read?.pageFacts?.tastingNotes).toEqual([
			"peach",
			"melon",
			"red tea",
		]);
		expect(read?.pageReads).toBe(1);
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
