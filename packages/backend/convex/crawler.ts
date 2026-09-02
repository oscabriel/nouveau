// Crawler actions: fetch one source, extract (ADR-0001: /products.json
// primary, Firecrawl for bot-protected feeds and HTML-mode sources), then
// commit through crawlSources.applyCrawlResult.

import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import { v } from "convex/values";

import { internal, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation } from "./_generated/server";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import { COMMIT_BATCH_PRODUCTS } from "./constants";
import {
	extractedProduct,
	HTML_EXTRACTION_PROMPT,
	htmlExtractionSchema,
	parseHtmlPage,
	parseProductsJson,
	shopifyProductsUrl,
	walkFeedPages,
} from "./extraction";
import type { ExtractedProduct, ProductsJsonPage } from "./extraction";

const firecrawl = new FirecrawlClient(components.firecrawl);

// products.json bodies can exceed doc limits, so the raw capture only keeps
// bodies under this; bigger feeds skip the capture rather than fail the crawl.
const MAX_RAW_BODY_BYTES = 512 * 1024;
// Bound the durable crawl for an HTML-mode source (product grids paginate).
// Also caps what onFirecrawlCrawlComplete reads back inside one mutation:
// each stored page can approach 1 MB against the 16 MB transaction read
// limit, so keep this well under ~12.
const HTML_CRAWL_PAGE_LIMIT = 10;
// Bound the page iterations when collecting a finished crawl's results.
const MAX_CRAWL_PAGE_ITERATIONS = 10;

interface RawCapture {
	extractionOk: boolean;
	storageId: Id<"_storage">;
}

interface CommitInput {
	crawlSourceId: Id<"crawlSources">;
	fetchedAt: number;
	// Baseline = first successful crawl: populates the catalog and fires no
	// Drop events (alerts start from crawl #2). Decided here, once, so every
	// batch of the crawl agrees.
	isBaseline: boolean;
	products: ExtractedProduct[];
	rawCapture?: RawCapture;
}

/**
 * Commit an extracted catalog in COMMIT_BATCH_PRODUCTS-sized transactions,
 * then finalize (archive rule, health, next due). A batch that fails ends
 * the crawl as crawl_failed; the batches already committed are idempotent
 * against the next crawl.
 */
const commitCatalog = async (
	ctx: ActionCtx,
	input: CommitInput
): Promise<void> => {
	const { crawlSourceId, fetchedAt, products, rawCapture } = input;
	const capture = rawCapture === undefined ? {} : { rawCapture };
	try {
		for (
			let start = 0;
			start < products.length;
			start += COMMIT_BATCH_PRODUCTS
		) {
			// Sequential on purpose: the batches share one source and keeping
			// them serial bounds concurrent load on the catalog tables.
			// eslint-disable-next-line no-await-in-loop
			await ctx.runMutation(internal.crawlSources.applyProductBatch, {
				crawlSourceId,
				eventsAllowed: !input.isBaseline,
				fetchedAt,
				products: products.slice(start, start + COMMIT_BATCH_PRODUCTS),
			});
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await ctx.runMutation(internal.crawlSources.finalizeCrawl, {
			crawlSourceId,
			errorMessage: `catalog commit failed: ${message}`,
			fetchedAt,
			success: false,
			...capture,
		});
		return;
	}
	await ctx.runMutation(internal.crawlSources.finalizeCrawl, {
		crawlSourceId,
		fetchedAt,
		fetchedExternalIds: products.map((product) => product.externalId),
		success: true,
		...capture,
	});
};

interface ProductsJsonInput {
	crawlSourceId: Id<"crawlSources">;
	isBaseline: boolean;
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
		// Whichever fetcher worked for page 1 also fetches the later pages.
		const walked = await walkFeedPages({
			fetchPage: (url) =>
				viaFirecrawl ? scrapePageText(ctx, url) : fetchPageText(url),
			firstPage,
			websiteUrl: input.websiteUrl,
		});
		({ pageError } = walked);
		products = pageError === null ? walked.products : null;
	}

	// The page-1 body is stored because only actions can write file storage;
	// finalizeCrawl records the capture row. Later pages are not captured.
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
		await ctx.runMutation(internal.crawlSources.finalizeCrawl, {
			crawlSourceId: input.crawlSourceId,
			errorMessage:
				pageError ?? "products.json unavailable or empty after HTML fallback",
			fetchedAt,
			success: false,
			...(rawCapture === undefined ? {} : { rawCapture }),
		});
		return;
	}

	await commitCatalog(ctx, {
		crawlSourceId: input.crawlSourceId,
		fetchedAt,
		isBaseline: input.isBaseline,
		products,
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
			isBaseline: source.lastSuccessAt === undefined,
			websiteUrl: roaster.websiteUrl,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Commit an already-extracted catalog for a source. The html-mode completion
 * callback schedules this (a mutation cannot run the batched commit itself);
 * tests drive the commit path through it too.
 */
export const commitExtractedCatalog = internalAction({
	args: {
		crawlSourceId: v.id("crawlSources"),
		fetchedAt: v.number(),
		products: v.array(extractedProduct),
		rawCapture: v.optional(
			v.object({
				extractionOk: v.boolean(),
				storageId: v.id("_storage"),
			})
		),
	},
	handler: async (ctx, args) => {
		const loaded = await ctx.runQuery(internal.crawlSources.getSource, {
			crawlSourceId: args.crawlSourceId,
		});
		if (loaded === null) {
			return null;
		}
		await commitCatalog(ctx, {
			crawlSourceId: args.crawlSourceId,
			fetchedAt: args.fetchedAt,
			isBaseline: loaded.source.lastSuccessAt === undefined,
			products: args.products,
			...(args.rawCapture === undefined ? {} : { rawCapture: args.rawCapture }),
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Firecrawl terminal callback — must be an internal mutation (the component
 * mints a mutation handle for it), run exactly once at a terminal state.
 * Guards status, warns on unstored pages, then hands what the crawl
 * extracted to the batched commit.
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
			await ctx.runMutation(internal.crawlSources.finalizeCrawl, {
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
			await ctx.runMutation(internal.crawlSources.finalizeCrawl, {
				crawlSourceId,
				errorMessage: "HTML extraction found no products",
				fetchedAt,
				success: false,
			});
			return null;
		}
		await ctx.scheduler.runAfter(0, internal.crawler.commitExtractedCatalog, {
			crawlSourceId,
			fetchedAt,
			products,
		});
		return null;
	},
	returns: v.null(),
});
