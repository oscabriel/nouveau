// Crawler actions: fetch one source, extract (ADR-0001: /products.json
// primary, Firecrawl for bot-protected feeds and HTML-mode sources), then
// commit through crawlSources.applyCrawlResult.

import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";

import { internal, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
	HTML_EXTRACTION_PROMPT,
	htmlExtractionSchema,
	parseHtmlPage,
	parseProductsJson,
	PRODUCTS_JSON_PAGE_SIZE,
	shopifyProductsUrl,
} from "./extraction";
import type { ExtractedProduct, ProductsJsonPage } from "./extraction";

const firecrawl = new FirecrawlClient(components.firecrawl);

// products.json bodies can exceed doc limits, so the raw capture only keeps
// bodies under this; bigger feeds skip the capture rather than fail the crawl.
const MAX_RAW_BODY_BYTES = 512 * 1024;
// Stop walking products.json pages here even if the feed is still full
// (4 x 250 = 1000 products; the biggest seeded roasters sit around 300).
const MAX_PRODUCTS_JSON_PAGES = 4;
// Bound the durable crawl for an HTML-mode source (product grids paginate).
// Also caps what onFirecrawlCrawlComplete reads back inside one mutation:
// each stored page can approach 1 MB against the 16 MB transaction read
// limit, so keep this well under ~12.
const HTML_CRAWL_PAGE_LIMIT = 10;
// Bound the page iterations when collecting a finished crawl's results.
const MAX_CRAWL_PAGE_ITERATIONS = 10;

interface ProductsJsonInput {
	crawlSourceId: Id<"crawlSources">;
	roasterId: Id<"roasters">;
	websiteUrl: string;
}

const fetchPageText = async (url: string): Promise<string | null> => {
	try {
		const res = await fetch(url, {
			headers: { accept: "application/json" },
			redirect: "follow",
		});
		if (!res.ok) {
			return null;
		}
		return await res.text();
	} catch {
		return null;
	}
};

// Bot protection or a non-Shopify response: let Firecrawl render it.
const scrapePageText = async (
	ctx: ActionCtx,
	url: string
): Promise<string | null> => {
	const doc = await firecrawl.scrape(ctx, url, { formats: ["rawHtml"] });
	const text = doc.rawHtml ?? "";
	return text.length > 0 ? text : null;
};

const parsePage = (text: string): ProductsJsonPage | null => {
	try {
		return parseProductsJson(text);
	} catch {
		return null;
	}
};

interface FeedWalkResult {
	pageError: string | null;
	products: ExtractedProduct[];
}

/**
 * Walk the feed pages after the first while the raw feed reports a full page,
 * merging products by externalId. A page lost mid-walk fails the whole walk
 * instead of returning a partial catalog, which would miss-count the tail
 * products toward the 3-strike archive.
 */
const walkFeedPages = async (
	ctx: ActionCtx,
	input: {
		firstPage: ProductsJsonPage;
		viaFirecrawl: boolean;
		websiteUrl: string;
	}
): Promise<FeedWalkResult> => {
	const collected = new Map<string, ExtractedProduct>();
	for (const product of input.firstPage.products) {
		collected.set(product.externalId, product);
	}
	let { feedCount } = input.firstPage;
	let page = 1;
	while (
		feedCount === PRODUCTS_JSON_PAGE_SIZE &&
		page < MAX_PRODUCTS_JSON_PAGES
	) {
		page += 1;
		const url = shopifyProductsUrl(input.websiteUrl, page);
		// Pages are sequential by design: each full page decides whether the
		// next one exists.
		// eslint-disable-next-line no-await-in-loop
		const text = await (input.viaFirecrawl
			? scrapePageText(ctx, url)
			: fetchPageText(url));
		const parsed = text === null ? null : parsePage(text);
		if (parsed === null) {
			return {
				pageError: `products.json page ${page} unavailable; partial catalog discarded`,
				products: [],
			};
		}
		for (const product of parsed.products) {
			collected.set(product.externalId, product);
		}
		({ feedCount } = parsed);
	}
	if (feedCount === PRODUCTS_JSON_PAGE_SIZE) {
		console.warn(
			`${input.websiteUrl}: products.json still full at page ${page}; catalog may exceed the crawl cap`
		);
	}
	return { pageError: null, products: [...collected.values()] };
};

/**
 * products_json mode: plain fetch first (ADR-0001 primary), Firecrawl scrape
 * as fallback for bot-protected feeds. Shopify caps the feed at 250 items per
 * page (Sey and Intelligentsia hit it), so a full first page walks the rest
 * of the feed. An unparseable or empty feed counts as a failed crawl after
 * the fallback, per the build spec.
 */
const crawlProductsJson = async (
	ctx: ActionCtx,
	input: ProductsJsonInput
): Promise<void> => {
	const fetchedAt = Date.now();
	const firstUrl = shopifyProductsUrl(input.websiteUrl);

	// Page 1 picks the fetcher: whichever works also fetches later pages.
	const bodyText = await fetchPageText(firstUrl);
	let firstPage = bodyText === null ? null : parsePage(bodyText);
	let viaFirecrawl = false;
	let fallbackText: string | null = null;
	if (firstPage === null || firstPage.products.length === 0) {
		fallbackText = await scrapePageText(ctx, firstUrl);
		const parsed = fallbackText === null ? null : parsePage(fallbackText);
		if (parsed !== null && parsed.products.length > 0) {
			firstPage = parsed;
			viaFirecrawl = true;
		}
	}

	let products: ExtractedProduct[] | null = null;
	let pageError: string | null = null;
	if (firstPage !== null && firstPage.products.length > 0) {
		const walked = await walkFeedPages(ctx, {
			firstPage,
			viaFirecrawl,
			websiteUrl: input.websiteUrl,
		});
		({ pageError } = walked);
		products = pageError === null ? walked.products : null;
	}

	// The page-1 body is stored because only actions can write file storage;
	// applyCrawlResult records the capture row. Later pages are not captured.
	const captureText = bodyText ?? fallbackText;
	const rawCapture =
		captureText !== null && captureText.length <= MAX_RAW_BODY_BYTES
			? {
					extractionOk: products !== null,
					storageId: await ctx.storage.store(
						new Blob([captureText], { type: "application/json" })
					),
				}
			: undefined;

	if (products === null) {
		await ctx.runMutation(internal.crawlSources.applyCrawlResult, {
			crawlSourceId: input.crawlSourceId,
			errorMessage:
				pageError ?? "products.json unavailable or empty after HTML fallback",
			fetchedAt,
			success: false,
			...(rawCapture === undefined ? {} : { rawCapture }),
		});
		return;
	}

	await ctx.runMutation(internal.crawlSources.applyCrawlResult, {
		crawlSourceId: input.crawlSourceId,
		fetchedAt,
		products,
		success: true,
		...(rawCapture === undefined ? {} : { rawCapture }),
	});
};

interface HtmlCrawlInput {
	crawlSourceId: Id<"crawlSources">;
	roasterId: Id<"roasters">;
	url: string;
}

/**
 * html mode: durable Firecrawl crawl with structured extraction. Results are
 * committed by the completion callback, which carries the source ids through
 * `context`.
 */
const startHtmlCrawl = async (
	ctx: ActionCtx,
	input: HtmlCrawlInput
): Promise<void> => {
	// Webhook mode needs a reachable deployment and the secret to verify
	// deliveries; without the secret (local dev), poll instead.
	const useWebhook = env.FIRECRAWL_WEBHOOK_SECRET !== undefined;
	await firecrawl.startCrawl(ctx, {
		context: {
			crawlSourceId: input.crawlSourceId,
			roasterId: input.roasterId,
		},
		onComplete: internal.crawler.onFirecrawlCrawlComplete,
		options: {
			limit: HTML_CRAWL_PAGE_LIMIT,
			scrapeOptions: {
				formats: [
					{
						prompt: HTML_EXTRACTION_PROMPT,
						schema: htmlExtractionSchema,
						type: "json",
					},
				],
			},
		},
		url: input.url,
		...(useWebhook ? {} : { mode: "poll" as const }),
	});
};

const collectCrawlProducts = async (
	ctx: MutationCtx,
	input: { crawlId: string }
): Promise<ExtractedProduct[]> => {
	const products: ExtractedProduct[] = [];
	const seen = new Set<string>();
	let cursor: string | null = null;
	for (let page = 0; page < MAX_CRAWL_PAGE_ITERATIONS; page += 1) {
		// Pagination is sequential by design: each request returns the next
		// cursor, so the awaits cannot run in parallel.
		// eslint-disable-next-line no-await-in-loop
		const result = await firecrawl.listPages(ctx, {
			crawlId: input.crawlId,
			paginationOpts: { cursor, numItems: 64 },
		});
		for (const doc of result.page) {
			if (doc.json === undefined) {
				continue;
			}
			for (const product of parseHtmlPage(doc.json, doc.url)) {
				if (seen.has(product.externalId)) {
					continue;
				}
				seen.add(product.externalId);
				products.push(product);
			}
		}
		if (result.isDone) {
			break;
		}
		cursor = result.continueCursor;
	}
	return products;
};

export const crawlSource = internalAction({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		const loaded = await ctx.runQuery(internal.crawlSources.getSource, {
			crawlSourceId: args.crawlSourceId,
		});
		if (loaded === null) {
			return null;
		}
		const { roaster, source } = loaded;

		if (source.mode === "html") {
			await startHtmlCrawl(ctx, {
				crawlSourceId: source._id,
				roasterId: source.roasterId,
				url: roaster.productPageUrl,
			});
			return null;
		}

		await crawlProductsJson(ctx, {
			crawlSourceId: source._id,
			roasterId: source.roasterId,
			websiteUrl: roaster.websiteUrl,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Firecrawl terminal callback — must be an internal mutation (the component
 * mints a mutation handle for it), run exactly once at a terminal state.
 * Guards status, warns on unstored pages, then commits what the crawl
 * extracted.
 */
export const onFirecrawlCrawlComplete = internalMutation({
	args: {
		context: v.optional(v.any()),
		crawlId: v.string(),
		error: v.optional(v.string()),
		jobId: v.optional(v.string()),
		pageCount: v.number(),
		status: v.union(
			v.literal("completed"),
			v.literal("failed"),
			v.literal("cancelled")
		),
		unstored: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const context = args.context as
			| { crawlSourceId?: string; roasterId?: string }
			| undefined;
		const crawlSourceId = context?.crawlSourceId as
			| Id<"crawlSources">
			| undefined;
		if (crawlSourceId === undefined) {
			return null;
		}

		if (args.status !== "completed") {
			await ctx.runMutation(internal.crawlSources.applyCrawlResult, {
				crawlSourceId,
				errorMessage: args.error ?? `Crawl ${args.status}`,
				fetchedAt: Date.now(),
				success: false,
			});
			return null;
		}
		if (args.unstored !== undefined && args.unstored > 0) {
			console.warn(
				`crawl ${args.crawlId}: ${args.unstored} pages too large to store`
			);
		}

		const products = await collectCrawlProducts(ctx, { crawlId: args.crawlId });
		const fetchedAt = Date.now();
		if (products.length === 0) {
			await ctx.runMutation(internal.crawlSources.applyCrawlResult, {
				crawlSourceId,
				errorMessage: "HTML extraction found no products",
				fetchedAt,
				success: false,
			});
			return null;
		}
		await ctx.runMutation(internal.crawlSources.applyCrawlResult, {
			crawlSourceId,
			fetchedAt,
			products,
			success: true,
		});
		return null;
	},
	returns: v.null(),
});
