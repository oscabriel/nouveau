// Page facts (ADR-0005 option C, scheduled as ADR-0008 amends it). A lot's
// rendered product page is read while a page fact is still missing after
// the merge: the crawl-end sweep asks for the roaster's lots, the lot page
// asks through `request`, the recommendation worker asks for a candidate.
// One page text (the shop's own page, else a Firecrawl markdown scrape),
// then code over-finds candidate spans per field and ONE Jev request picks
// one candidate per field (or none). Every pick is verbatim on the page by
// construction and passes the shared per-field shape
// (extraction.verifyPageFacts), then is stored in `products.pageFacts`,
// which the feed write never touches.

import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	env,
	internalAction,
	internalMutation,
	mutation,
} from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
	pageFactCandidates,
	pageTextFromHtml,
	verifyPageFacts,
} from "./extraction";
import type { PageFactField } from "./extraction";
import { askJev, JEV_MODEL, jevChoice, jevNoul } from "./jev";
import type { JevQuestion } from "./jev";
import { needsPageFacts, pageFactsValidator } from "./lotFacts";
import type { PageFacts } from "./lotFacts";
import { lotShopUrl } from "./lotUrl";
import { sentenceCandidates } from "./recommendationRules";

/** Anyone can open a lot page, so the spend is capped deployment-wide. */
export const PAGE_FACTS_PER_HOUR = 20;
/**
 * Firecrawl fallbacks a minute, deployment-wide, across every sweep and the
 * recommendation worker. One cron tick crawls every source, and a shop that
 * needs the fallback for every lot (Sey renders client-side) would otherwise
 * send nineteen roasters' worth of scrapes at once into Firecrawl's
 * per-minute limit. A read the budget defers keeps its schedule stamp and is
 * not a counted attempt.
 */
export const FIRECRAWL_FALLBACK_PER_MINUTE = 60;
/**
 * Lots one crawl's sweep reads (ADR-0008). The first sweeps of a catalog
 * are a backfill spread over crawls; after that a crawl finds only its new
 * lots and the retries the cap allows, so this mostly bounds a Jev outage's
 * retry cost.
 */
export const PAGE_SWEEP_PER_CRAWL = 25;
/** Reads in one sweep are spaced so a shop sees one request at a time. */
export const PAGE_SWEEP_SPACING_MS = 2000;
/** Current lots one sweep considers; above any real catalog (Sey ~900). */
const PAGE_SWEEP_SCAN_LIMIT = 1000;
/**
 * Variety, elevation and producer do not change between crawls, so a page
 * Firecrawl read within a day is good enough (a fresh scrape is slower and
 * fails more often; a cached one costs the same credit). No custom headers
 * here: they bypass the cache, and the facts do not depend on the market.
 */
export const PAGE_FACTS_MAX_AGE_MS = 24 * 60 * 60_000;

const limiter = new RateLimiter(components.rateLimiter, {
	firecrawlFallback: {
		capacity: FIRECRAWL_FALLBACK_PER_MINUTE,
		kind: "token bucket",
		period: MINUTE,
		rate: FIRECRAWL_FALLBACK_PER_MINUTE,
	},
	pageFacts: { kind: "fixed window", period: HOUR, rate: PAGE_FACTS_PER_HOUR },
});

/** The fallback budget had no room: the page was never asked, so the lot waits for its next window. */
class ReadDeferredError extends Error {
	override name = "ReadDeferredError";
}
const firecrawl = new FirecrawlClient(components.firecrawl);

/**
 * Jev's context rot: accuracy falls as the state grows, so the page state
 * is the head of the page text (chrome already dropped; specs sit at the
 * top of a product page), not the whole document. Jev's
 * own limit is 32k tokens for state; this stays far below it.
 */
const JEV_STATE_LIMIT = 12_000;
/** The escape-hatch option on every field Choice. */
const NONE_OPTION = "none";
/** A Noul at or above this is a yes. */
const YES = 0.5;
/** A page read contributes at most this many description sentences. */
const MAX_PAGE_SENTENCES = 3;
/** Firecrawl's rate limit: the page was never asked, so the try is not a read (see scrape). */
const RATE_LIMITED_STATUS = 429;
/** Whether the fallback failed on Firecrawl's rate limit rather than on the page. */
const isRateLimited = (error: unknown): boolean =>
	error instanceof ConvexError &&
	typeof error.data === "object" &&
	error.data !== null &&
	(error.data as { status?: unknown }).status === RATE_LIMITED_STATUS;
/** A shop that has not answered by then is read through Firecrawl instead. */
const PAGE_FETCH_TIMEOUT_MS = 15_000;
/** Shopify and WooCommerce themes serve a browser the full page; a bare client UA can get a challenge page. */
const PAGE_FETCH_HEADERS: Record<string, string> = {
	accept: "text/html",
	"user-agent":
		"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 nouveau-crawler",
};

/** The Choice question for one fact field, over its candidate spans. */
const CHOICE_FIELDS: readonly (readonly [
	Exclude<PageFactField, "tastingNotes">,
	string,
])[] = [
	[
		"elevation",
		"Which of these states the elevation or altitude at which the one coffee sold on this product page was grown?",
	],
	[
		"process",
		"Which of these terms names the process used for the one coffee sold on this product page?",
	],
	[
		"producer",
		"Which of these names the producer, farm, or washing station of the one coffee sold on this product page?",
	],
	[
		"region",
		"Which of these names the growing region of the one coffee sold on this product page? A country alone is not a region.",
	],
	[
		"roastLevel",
		"Which of these states the roast level of the one coffee sold on this product page?",
	],
	[
		"variety",
		"Which of these names the variety or varieties of the one coffee sold on this product page?",
	],
];

const NOTE_QUESTION: JevQuestion = {
	instructions:
		'On this product page, is "%NOTE%" a tasting note of the one coffee sold here — a flavor or aroma word — rather than a roast level, a certification, brewing guidance, or something else the shop sells?',
	type: "noul",
};

const SENTENCE_QUESTION: JevQuestion = {
	instructions:
		"Does this sentence describe the one coffee sold on this product page — its flavor, aroma, character, or growing details — rather than the roaster, the shop, shipping, brewing advice, or other products?",
	type: "noul",
};

/**
 * The page read's questions: one Choice per field that has candidates, one
 * Noul per note candidate and per description-sentence candidate, all in a
 * single /v1/systemone request (Jev evaluates them against the state in
 * parallel, so extra questions cost almost nothing).
 */
export const pageJevQuestions = (
	candidates: ReturnType<typeof pageFactCandidates>,
	sentences: readonly string[]
): Record<string, JevQuestion> => {
	const questions: Record<string, JevQuestion> = {};
	for (const [field, instructions] of CHOICE_FIELDS) {
		const spans = candidates[field];
		if (spans.length === 0) {
			continue;
		}
		questions[field] = {
			criteria: {
				...Object.fromEntries(spans.map((span) => [span, null])),
				[NONE_OPTION]:
					"The page does not state this about this specific coffee.",
			},
			instructions,
			type: "choice",
		};
	}
	for (const [index, note] of candidates.tastingNotes.entries()) {
		questions[`note_${index}`] = {
			...NOTE_QUESTION,
			instructions: NOTE_QUESTION.instructions.replaceAll("%NOTE%", note),
		};
	}
	for (const index of sentences.keys()) {
		questions[`sentence_${index}`] = SENTENCE_QUESTION;
	}
	return questions;
};

/**
 * The picks out of one answer map, copied verbatim from the candidates.
 * A choice outside the sent options or the none hatch is a protocol error
 * and leaves the field unset, never defaulted.
 */
const picksFromAnswers = (
	answers: Record<string, unknown>,
	candidates: ReturnType<typeof pageFactCandidates>,
	sentences: readonly string[]
): { facts: PageFacts; sentences: string[] } => {
	const picks: PageFacts = {};
	for (const [field] of CHOICE_FIELDS) {
		if (candidates[field].length === 0) {
			continue;
		}
		const chosen = jevChoice(answers[field], [
			...candidates[field],
			NONE_OPTION,
		]);
		if (chosen === null || chosen.choice === NONE_OPTION) {
			continue;
		}
		picks[field] = chosen.choice;
	}
	const notes: string[] = [];
	for (const [index, note] of candidates.tastingNotes.entries()) {
		const yes = jevNoul(answers[`note_${index}`]);
		if (yes !== null && yes >= YES) {
			notes.push(note);
		}
	}
	if (notes.length > 0) {
		picks.tastingNotes = notes;
	}
	const approved: string[] = [];
	for (const [index, sentence] of sentences.entries()) {
		const yes = jevNoul(answers[`sentence_${index}`]);
		if (yes !== null && yes >= YES) {
			approved.push(sentence);
		}
	}
	return {
		facts: verifyPageFacts(picks),
		sentences: approved.slice(0, MAX_PAGE_SENTENCES),
	};
};

export const requestResultValidator = v.union(
	v.literal("started"),
	// Nothing more to read: the lot has its facts, has had MAX_PAGE_READS
	// reads, or a read is in flight or inside the retry window.
	v.literal("known"),
	v.literal("limited"),
	// No such lot, or nothing to read (archived, no shop URL).
	v.literal("none")
);

/**
 * The stamp-then-schedule step every read goes through: `copyFetchedAt`
 * is set now, so another viewer or the sweep sees the lot inside the retry
 * window and does not read it twice, and the scrape is scheduled
 * `delayMs` out.
 */
const scheduleRead = async (
	ctx: MutationCtx,
	productId: Id<"products">,
	url: string,
	now: number,
	delayMs: number
): Promise<void> => {
	await ctx.db.patch("products", productId, { copyFetchedAt: now });
	await ctx.scheduler.runAfter(delayMs, internal.pageFacts.scrape, {
		productId,
		url,
	});
};

/**
 * The lot page's ask. Idempotent under concurrent viewers: the first request
 * stamps `copyFetchedAt`, so the rest see "known" and wait on the same
 * reactive query. No identity needed: the page is public and the limiter is
 * the guard.
 */
export const request = mutation({
	args: { lotId: v.string() },
	handler: async (ctx, args) => {
		const productId = ctx.db.normalizeId("products", args.lotId);
		if (productId === null) {
			return "none";
		}
		const product = await ctx.db.get("products", productId);
		if (product === null || product.status !== "current") {
			return "none";
		}
		if (!needsPageFacts(product, Date.now())) {
			return "known";
		}
		const roaster = await ctx.db.get("roasters", product.roasterId);
		const url = roaster === null ? null : lotShopUrl(roaster, product);
		if (url === null) {
			return "none";
		}
		const quota = await limiter.limit(ctx, "pageFacts");
		if (!quota.ok) {
			return "limited";
		}
		await scheduleRead(ctx, productId, url, Date.now(), 0);
		return "started";
	},
	returns: requestResultValidator,
});

/**
 * The crawl-end sweep (ADR-0008): every current lot of the roaster that is
 * still missing a page fact after the feed merge, is under the read cap,
 * was not tried inside the retry window, and has a shop URL gets stamped
 * and one scheduled read, up to PAGE_SWEEP_PER_CRAWL per crawl. Same
 * stamp-then-schedule as `request`, so a viewer's ask and the sweep never
 * read the same lot twice. Returns how many reads it scheduled.
 */
export const sweep = internalMutation({
	args: { roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const roaster = await ctx.db.get("roasters", args.roasterId);
		if (roaster === null) {
			return 0;
		}
		const now = Date.now();
		const lots = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_status_and_last_seen_at", (q) =>
				q.eq("roasterId", args.roasterId).eq("status", "current")
			)
			.order("desc")
			.take(PAGE_SWEEP_SCAN_LIMIT);
		// A lot without a shop URL can never be read, so it is dropped before
		// the slice rather than holding one of the crawl's slots every time.
		const due: { productId: Id<"products">; url: string }[] = [];
		for (const lot of lots) {
			const url = lotShopUrl(roaster, lot);
			if (url !== null && needsPageFacts(lot, now)) {
				due.push({ productId: lot._id, url });
			}
		}
		let scheduled = 0;
		for (const { productId, url } of due.slice(0, PAGE_SWEEP_PER_CRAWL)) {
			// oxlint-disable-next-line no-await-in-loop -- sequential on purpose: the stamp and the schedule are one step per lot, and the spacing is the lot's position in the sweep
			await scheduleRead(
				ctx,
				productId,
				url,
				now,
				scheduled * PAGE_SWEEP_SPACING_MS
			);
			scheduled += 1;
		}
		return scheduled;
	},
	returns: v.number(),
});

/** What one page read yields: facts for the product, sentences for evidence. */
export interface PageRead {
	facts: PageFacts;
	/** The page as block text: the shop's HTML stripped, or Firecrawl's markdown. */
	pageText: string;
	/** Description sentences Jev approved, in page order. */
	sentences: string[];
}

const TRAILING_SLASHES = /\/+$/u;
/** The apex and its www host are the same shop (Sey answers from www). */
const WWW_PREFIX = /^www\./iu;
/** A Shopify product page; a renamed handle 301s here from the old one. */
const PRODUCT_PATH = /^\/products\/[^/]+$/u;

/**
 * Whether the page the shop answered with is the lot's page: the same shop
 * (host, ignoring a leading www and an http to https upgrade) and either
 * the same path (query string and trailing slash ignored) or another
 * product path, which is how Shopify answers a renamed handle. A shop that
 * 301s a dead handle to its collection page answers 200 with HTML, and
 * that must not be read as the lot's page.
 */
export const samePage = (requested: string, answered: string): boolean => {
	let asked: URL;
	let got: URL;
	try {
		asked = new URL(requested);
		got = new URL(answered);
	} catch {
		return false;
	}
	const upgraded = asked.protocol === "http:" && got.protocol === "https:";
	const sameShop =
		asked.host.replace(WWW_PREFIX, "") === got.host.replace(WWW_PREFIX, "") &&
		(asked.protocol === got.protocol || upgraded);
	const askedPath = asked.pathname.replace(TRAILING_SLASHES, "");
	const gotPath = got.pathname.replace(TRAILING_SLASHES, "");
	const renamedProduct =
		PRODUCT_PATH.test(askedPath) && PRODUCT_PATH.test(gotPath);
	return sameShop && (askedPath === gotPath || renamedProduct);
};

/**
 * The product page's text from the shop itself: one plain request, no
 * credit. Null when the shop errors, times out, redirects to another page,
 * serves something other than HTML, fails mid-body, or serves a script
 * shell; the caller falls back to Firecrawl.
 */
const fetchPageText = async (url: string): Promise<string | null> => {
	try {
		const response = await fetch(url, {
			headers: PAGE_FETCH_HEADERS,
			signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
		});
		// A Response built by hand reports "" as its url; only a real
		// redirect target can differ from what was asked for.
		const answered = response.url === "" ? url : response.url;
		if (
			!response.ok ||
			!samePage(url, answered) ||
			!(response.headers.get("content-type") ?? "").includes("text/html")
		) {
			return null;
		}
		return pageTextFromHtml(await response.text());
	} catch {
		return null;
	}
};

/** The page through Firecrawl's markdown scrape (one credit, cached a day). */
const scrapePageText = async (ctx: ActionCtx, url: string): Promise<string> => {
	const budget = await limiter.limit(ctx, "firecrawlFallback");
	if (!budget.ok) {
		throw new ReadDeferredError("Firecrawl fallback budget spent this minute");
	}
	const page = await firecrawl.scrape(ctx, url, {
		formats: ["markdown"],
		maxAge: PAGE_FACTS_MAX_AGE_MS,
		onlyMainContent: true,
		timeout: 30_000,
	});
	const { metadata } = page;
	if (metadata?.statusCode !== 200 || metadata.sourceURL !== url) {
		throw new Error("Source page unavailable");
	}
	return page.markdown ?? "";
};

/**
 * One product page and one Jev request, verified. The page comes from the
 * shop itself when a plain fetch yields content (ADR-0008), else through a
 * markdown-only Firecrawl scrape. Shared by the scheduled scrape and the
 * recommendation worker so both write the same thing. `known` is the
 * catalog copy the evidence must be new against (empty for the lot-page
 * ask). Throws when the page is unavailable both ways; the caller decides
 * what a failure means for it.
 */
export const readPageFacts = async (
	ctx: ActionCtx,
	url: string,
	known = ""
): Promise<PageRead> => {
	const pageText =
		(await fetchPageText(url)) ?? (await scrapePageText(ctx, url));
	const empty: PageRead = { facts: {}, pageText, sentences: [] };
	const apiKey = env.TYPESAFE_API_KEY;
	// Without the key the read still succeeds: the lot keeps its attempt
	// stamp, the passages fall back to the regex path, and the next read
	// after the retry window picks the Jev path up once the key is set.
	if (apiKey === undefined || apiKey === "" || pageText === "") {
		return empty;
	}
	const candidates = pageFactCandidates(pageText);
	const sentenceSpans = sentenceCandidates(pageText, known);
	const answer = await askJev(
		apiKey,
		`pageFacts ${url}`,
		pageText.slice(0, JEV_STATE_LIMIT),
		pageJevQuestions(candidates, sentenceSpans)
	);
	if (answer === null) {
		return empty;
	}
	if (answer.model !== JEV_MODEL) {
		console.warn(
			`jev pageFacts ${url}: answered by ${answer.model}, pinned ${JEV_MODEL}`
		);
	}
	return {
		pageText,
		...picksFromAnswers(answer.answers, candidates, sentenceSpans),
	};
};

export const scrape = internalAction({
	args: { productId: v.id("products"), url: v.string() },
	handler: async (ctx, args) => {
		let facts: PageFacts = {};
		try {
			({ facts } = await readPageFacts(ctx, args.url));
		} catch (error) {
			// A deferred or rate-limited fallback never reached the page: the
			// stamp from the schedule stands, so the lot is retried after the
			// window, but the try does not spend one of its MAX_PAGE_READS.
			if (error instanceof ReadDeferredError || isRateLimited(error)) {
				return null;
			}
			// Nothing is stored for a page that could not be read, but the
			// attempt counts: the lot is retried after the window until the
			// read cap, not forever.
			await ctx.runMutation(internal.pageFacts.recordFailedRead, {
				productId: args.productId,
			});
			return null;
		}
		await ctx.runMutation(internal.pageFacts.store, {
			facts,
			productId: args.productId,
		});
		return null;
	},
	returns: v.null(),
});

/** The bookkeeping every read outcome writes: the stamp and the counter. */
const attemptPatch = (
	product: Doc<"products">
): { copyFetchedAt: number; pageReads: number } => ({
	copyFetchedAt: Date.now(),
	pageReads: (product.pageReads ?? 0) + 1,
});

/**
 * Store what the page said. The attempt is stamped and counted whatever it
 * found; facts it found are merged over the ones an earlier read stored,
 * so a second read adds fields without dropping the first read's. A lot is
 * asked again after PAGE_FACTS_RETRY_MS while a field is still missing,
 * up to MAX_PAGE_READS times. Never touches a feed column.
 */
export const store = internalMutation({
	args: { facts: pageFactsValidator, productId: v.id("products") },
	handler: async (ctx, args) => {
		const product = await ctx.db.get("products", args.productId);
		if (product === null) {
			return null;
		}
		await ctx.db.patch(
			"products",
			args.productId,
			Object.keys(args.facts).length === 0
				? attemptPatch(product)
				: {
						...attemptPatch(product),
						pageFacts: { ...product.pageFacts, ...args.facts },
					}
		);
		return null;
	},
	returns: v.null(),
});

/**
 * A page that could not be read either way still counts as an attempt, so
 * a lot whose page is gone or challenges the crawler stops at the read cap
 * instead of retrying daily forever. Never touches a feed column.
 */
export const recordFailedRead = internalMutation({
	args: { productId: v.id("products") },
	handler: async (ctx, args) => {
		const product = await ctx.db.get("products", args.productId);
		if (product === null) {
			return null;
		}
		await ctx.db.patch("products", args.productId, attemptPatch(product));
		return null;
	},
	returns: v.null(),
});
