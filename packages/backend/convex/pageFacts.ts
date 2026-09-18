// Page facts on demand (ADR-0005, option C). A lot's rendered product page
// is read the first time someone looks at a thin lot: the lot page asks
// through `request`, the recommendation worker asks for a candidate. One
// Firecrawl markdown scrape (one credit, cached), then code over-finds
// candidate spans per field and ONE Jev request picks one candidate per
// field (or none). Every pick is verbatim on the page by construction and
// passes the shared per-field shape (extraction.verifyPageFacts), then is
// stored in `products.pageFacts`, which the feed write never touches.

import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import {
	env,
	internalAction,
	internalMutation,
	mutation,
} from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
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
 * Thin lots one crawl's sweep reads (ADR-0008). The first sweep of a
 * catalog is a backfill spread over crawls; after that a crawl finds only
 * its new lots, so the cap mostly bounds a Jev outage's retry cost.
 */
export const PAGE_SWEEP_PER_CRAWL = 25;
/** Reads in one sweep are spaced so a shop sees one request at a time. */
export const PAGE_SWEEP_SPACING_MS = 2000;
/** Current lots one sweep considers; above any real catalog (Sey ~900). */
const PAGE_SWEEP_SCAN = 1000;
/**
 * Variety, elevation and producer do not change between crawls, so a page
 * Firecrawl read within a day is good enough (a fresh scrape is slower and
 * fails more often; a cached one costs the same credit). No custom headers
 * here: they bypass the cache, and the facts do not depend on the market.
 */
export const PAGE_FACTS_MAX_AGE_MS = 24 * 60 * 60_000;

const limiter = new RateLimiter(components.rateLimiter, {
	pageFacts: { kind: "fixed window", period: HOUR, rate: PAGE_FACTS_PER_HOUR },
});
const firecrawl = new FirecrawlClient(components.firecrawl);

/**
 * Jev's context rot: accuracy falls as the state grows, so the page state
 * is the head of the markdown (the main content Firecrawl already trimmed;
 * specs sit at the top of a product page), not the whole document. Jev's
 * own limit is 32k tokens for state; this stays far below it.
 */
const JEV_STATE_LIMIT = 12_000;
/** The escape-hatch option on every field Choice. */
const NONE_OPTION = "none";
/** A Noul at or above this is a yes. */
const YES = 0.5;
/** A page read contributes at most this many description sentences. */
const MAX_PAGE_SENTENCES = 3;
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
	// The lot has its facts, or a read is in flight or inside the retry window.
	v.literal("known"),
	v.literal("limited"),
	// No such lot, or nothing to read (archived, no shop URL).
	v.literal("none")
);

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
		await ctx.db.patch("products", productId, { copyFetchedAt: Date.now() });
		await ctx.scheduler.runAfter(0, internal.pageFacts.scrape, {
			productId,
			url,
		});
		return "started";
	},
	returns: requestResultValidator,
});

/**
 * The crawl-end sweep (ADR-0008): every current lot of the roaster that is
 * still thin after the feed merge, has no page facts, and was not tried
 * inside the retry window gets stamped and one scheduled read, up to
 * PAGE_SWEEP_PER_CRAWL per crawl. Same stamp-then-schedule as `request`,
 * so a viewer's ask and the sweep never read the same lot twice. Returns
 * how many reads it scheduled.
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
			.take(PAGE_SWEEP_SCAN);
		const due = lots
			.filter((lot) => needsPageFacts(lot, now))
			.slice(0, PAGE_SWEEP_PER_CRAWL);
		let scheduled = 0;
		for (const lot of due) {
			const url = lotShopUrl(roaster, lot);
			if (url === null) {
				continue;
			}
			// Sequential on purpose: the stamp and the schedule are one step
			// per lot, and the spacing is the lot's position in the sweep.
			// oxlint-disable-next-line no-await-in-loop
			await ctx.db.patch("products", lot._id, { copyFetchedAt: now });
			// oxlint-disable-next-line no-await-in-loop
			await ctx.scheduler.runAfter(
				scheduled * PAGE_SWEEP_SPACING_MS,
				internal.pageFacts.scrape,
				{ productId: lot._id, url }
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
	markdown: string;
	/** Description sentences Jev approved, in page order. */
	sentences: string[];
}

/**
 * The product page's text from the shop itself: one plain request, no
 * credit. Null when the shop errors, times out, serves something other
 * than HTML, or serves a script shell; the caller falls back to Firecrawl.
 */
const fetchPageText = async (url: string): Promise<string | null> => {
	let response: Response;
	try {
		response = await fetch(url, {
			headers: PAGE_FETCH_HEADERS,
			signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
		});
	} catch {
		return null;
	}
	if (
		!response.ok ||
		!(response.headers.get("content-type") ?? "").includes("text/html")
	) {
		return null;
	}
	return pageTextFromHtml(await response.text());
};

/** The page through Firecrawl's markdown scrape (one credit, cached a day). */
const scrapePageText = async (ctx: ActionCtx, url: string): Promise<string> => {
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
	const markdown =
		(await fetchPageText(url)) ?? (await scrapePageText(ctx, url));
	const empty: PageRead = { facts: {}, markdown, sentences: [] };
	const apiKey = env.TYPESAFE_API_KEY;
	// Without the key the read still succeeds: the lot keeps its attempt
	// stamp, the passages fall back to the regex path, and the next read
	// after the retry window picks the Jev path up once the key is set.
	if (apiKey === undefined || apiKey === "" || markdown === "") {
		return empty;
	}
	const candidates = pageFactCandidates(markdown);
	const sentenceSpans = sentenceCandidates(markdown, known);
	const answer = await askJev(
		apiKey,
		`pageFacts ${url}`,
		markdown.slice(0, JEV_STATE_LIMIT),
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
		markdown,
		...picksFromAnswers(answer.answers, candidates, sentenceSpans),
	};
};

export const scrape = internalAction({
	args: { productId: v.id("products"), url: v.string() },
	handler: async (ctx, args) => {
		let facts: PageFacts = {};
		try {
			({ facts } = await readPageFacts(ctx, args.url));
		} catch {
			// copyFetchedAt is already stamped; the lot is retried after the
			// window. Nothing is stored for a page that could not be read.
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

/**
 * Store what the page said. An empty read keeps the attempt stamp and no
 * `pageFacts`, so the lot is asked again after PAGE_FACTS_RETRY_MS; a read
 * with facts settles the lot. Never touches a feed column.
 */
export const store = internalMutation({
	args: { facts: pageFactsValidator, productId: v.id("products") },
	handler: async (ctx, args) => {
		const product = await ctx.db.get("products", args.productId);
		if (product === null) {
			return null;
		}
		const now = Date.now();
		await ctx.db.patch(
			"products",
			args.productId,
			Object.keys(args.facts).length === 0
				? { copyFetchedAt: now }
				: { copyFetchedAt: now, pageFacts: args.facts }
		);
		return null;
	},
	returns: v.null(),
});
