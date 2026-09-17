// Crawler actions: fetch one source by its mode (ADR-0001 /products.json,
// ADR-0006 WooCommerce Store API and Firecrawl product pages), extract, then
// commit through crawlSources.applyProductBatch / finalizeCrawl.

import { FirecrawlClient } from "@firecrawl/firecrawl-convex";
import type { Infer } from "convex/values";
import { v } from "convex/values";

import { internal, components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import {
	COMMIT_BATCH_PRODUCTS,
	MAX_PRODUCT_PAGES,
	MAX_SITEMAPS,
	MAX_WOO_VARIATION_FETCHES,
	PRODUCT_PAGES_FULL_INTERVAL_MS,
	PRODUCT_SCRAPE_CONCURRENCY,
	shouldStoreRawCapture,
} from "./constants";
import {
	extractedProduct,
	fetchFirstFeedPage,
	parseProductsJson,
	SHOPIFY_FETCH_HEADERS,
	shopifyProductsUrl,
	walkFeedPages,
} from "./extraction";
import type {
	ExtractedProduct,
	FeedPageResponse,
	ProductsJsonPage,
} from "./extraction";
import { probeShop } from "./platform";
import {
	parseProductPage,
	productSitemaps,
	productUrlsFromLinks,
	sitemapLocations,
} from "./productPages";
import { confirmShopMarket } from "./shopMarket";
import type { shopMarketValidator } from "./shopMarket";
import { sourceModeValidator } from "./sourceMode";
import {
	MAX_WOO_PAGES,
	parseWooListing,
	parseWooVariations,
	wooProductsUrl,
	wooVariationsUrl,
} from "./woocommerce";
import type { WooListingPage } from "./woocommerce";

const firecrawl = new FirecrawlClient(components.firecrawl);

// products.json bodies can exceed doc limits, so the raw capture only keeps
// bodies under this; bigger feeds skip the capture rather than fail the crawl.
const MAX_RAW_BODY_BYTES = 512 * 1024;
// One product page scrape; Firecrawl's own default is longer than a crawl
// should wait for a single lot.
const SCRAPE_TIMEOUT_MS = 30_000;

type ShopMarket = Infer<typeof shopMarketValidator>;

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
	market?: ShopMarket;
	products: ExtractedProduct[];
	rawCapture?: RawCapture;
	// externalIds the lot classifier rejected (§16); finalizeCrawl purges any
	// still in the catalog.
	rejectedExternalIds?: string[];
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
	const rejected =
		input.rejectedExternalIds === undefined
			? {}
			: { rejectedExternalIds: input.rejectedExternalIds };
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
		market: input.market,
		success: true,
		...capture,
		...rejected,
	});
};

const failCrawl = (
	ctx: ActionCtx,
	input: {
		crawlSourceId: Id<"crawlSources">;
		errorMessage: string;
		fetchedAt: number;
		rawCapture?: RawCapture;
	}
): Promise<null> =>
	ctx.runMutation(internal.crawlSources.finalizeCrawl, {
		crawlSourceId: input.crawlSourceId,
		errorMessage: input.errorMessage,
		fetchedAt: input.fetchedAt,
		success: false,
		...(input.rawCapture === undefined ? {} : { rawCapture: input.rawCapture }),
	});

/**
 * Store the page-1 body as a raw capture when the retention rule says so
 * (#33): a failed extraction always, a success at most once a day per
 * roaster. Only actions can write file storage; finalizeCrawl records the
 * row. Bodies over the cap skip the capture rather than fail the crawl.
 */
const captureBody = async (
	ctx: ActionCtx,
	input: {
		contentType: string;
		extractionOk: boolean;
		lastOkCaptureAt?: number;
		now: number;
		text: string | null;
	}
): Promise<RawCapture | undefined> => {
	if (
		input.text === null ||
		input.text.length > MAX_RAW_BODY_BYTES ||
		!shouldStoreRawCapture({
			extractionOk: input.extractionOk,
			lastOkCaptureAt: input.lastOkCaptureAt,
			now: input.now,
		})
	) {
		return;
	}
	return {
		extractionOk: input.extractionOk,
		storageId: await ctx.storage.store(
			new Blob([input.text], { type: input.contentType })
		),
	};
};

/**
 * The shop's market when the shop's own data priced every lot in USD. The
 * Shopify path reads the storefront globals instead (shopMarket.ts); a
 * WooCommerce listing or a product page states its currency per price, so
 * an all-USD catalog is the same confirmation. Country is inferred from the
 * currency: Nouveau watches US roasters, and a non-US shop pricing in USD
 * would be excluded at the directory, not here.
 */
const marketFromCurrencies = (
	currencies: readonly string[],
	websiteUrl: string,
	confirmedAt: number
): ShopMarket | undefined =>
	currencies.length > 0 && currencies.every((code) => code === "USD")
		? { confirmedAt, country: "US", currency: "USD", url: websiteUrl }
		: undefined;

interface SourceInput {
	crawlSourceId: Id<"crawlSources">;
	isBaseline: boolean;
	/** When the roaster's last successful raw capture was taken, if ever (#33). */
	lastOkCaptureAt?: number;
	roasterId: Id<"roasters">;
	websiteUrl: string;
}

const fetchFeedPage = async (
	url: string,
	headers: Record<string, string> = SHOPIFY_FETCH_HEADERS
): Promise<FeedPageResponse> => {
	try {
		const res = await fetch(url, { headers, redirect: "follow" });
		if (!res.ok) {
			return { status: res.status, text: null };
		}
		return { status: res.status, text: await res.text() };
	} catch {
		return { status: 0, text: null };
	}
};

const fetchPageText = async (
	url: string,
	headers?: Record<string, string>
): Promise<string | null> => {
	const response = await fetchFeedPage(url, headers);
	return response.text;
};

/**
 * Run `task` over `items` at most `size` at a time. Bounds what one crawl
 * throws at a shop or at Firecrawl: the plan's concurrency limit throttles
 * beyond a few scrapes at once, and a shop's origin deserves the same care.
 */
const inChunks = async <T>(
	items: readonly T[],
	size: number,
	task: (item: T) => Promise<void>
): Promise<void> => {
	for (let start = 0; start < items.length; start += size) {
		// Sequential chunks by design; see above.
		// eslint-disable-next-line no-await-in-loop
		await Promise.all(items.slice(start, start + size).map(task));
	}
};

// Bot protection or a non-Shopify response: let Firecrawl render it.
const scrapePageText = async (
	ctx: ActionCtx,
	url: string
): Promise<string | null> => {
	const doc = await firecrawl.scrape(ctx, url, {
		formats: ["rawHtml"],
		headers: SHOPIFY_FETCH_HEADERS,
	});
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
	input: SourceInput
): Promise<void> => {
	const fetchedAt = Date.now();

	// Page 1 picks the host (apex, or www. after an apex 404) and the fetcher:
	// whichever works also fetches later pages and confirms the market.
	const first = await fetchFirstFeedPage({
		fetchPage: fetchFeedPage,
		websiteUrl: input.websiteUrl,
	});
	const { websiteUrl } = first;
	if (websiteUrl !== input.websiteUrl) {
		await ctx.runMutation(internal.crawlSources.recordFeedOrigin, {
			roasterId: input.roasterId,
			websiteUrl,
		});
	}
	const firstUrl = shopifyProductsUrl(websiteUrl);
	const market = await confirmShopMarket(websiteUrl, fetchedAt);

	const bodyText = first.text;
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
	let rejectedExternalIds: string[] = [];
	let pageError: string | null = null;
	if (firstPage !== null && firstPage.products.length > 0) {
		// Whichever fetcher worked for page 1 also fetches the later pages.
		const walked = await walkFeedPages({
			fetchPage: (url) =>
				viaFirecrawl ? scrapePageText(ctx, url) : fetchPageText(url),
			firstPage,
			websiteUrl,
		});
		({ pageError, rejectedExternalIds } = walked);
		products = pageError === null ? walked.products : null;
	}

	const rawCapture = await captureBody(ctx, {
		contentType: "application/json",
		extractionOk: products !== null,
		lastOkCaptureAt: input.lastOkCaptureAt,
		now: fetchedAt,
		text: bodyText ?? fallbackText,
	});

	if (products === null) {
		await failCrawl(ctx, {
			crawlSourceId: input.crawlSourceId,
			errorMessage:
				pageError ?? "products.json unavailable or empty after HTML fallback",
			fetchedAt,
			...(rawCapture === undefined ? {} : { rawCapture }),
		});
		return;
	}

	await commitCatalog(ctx, {
		crawlSourceId: input.crawlSourceId,
		fetchedAt,
		isBaseline: input.isBaseline,
		market,
		products,
		rejectedExternalIds,
		...(rawCapture === undefined ? {} : { rawCapture }),
	});
};

const WOO_FETCH_HEADERS: Record<string, string> = {
	accept: "application/json",
};

const parseWooPage = (text: string): WooListingPage | null => {
	try {
		return parseWooListing(text);
	} catch {
		return null;
	}
};

/** X-WP-TotalPages from a Store API response, defaulting to one page. */
const wooTotalPages = (res: Response): number => {
	const total = Number(res.headers.get("x-wp-totalpages") ?? "1");
	return Number.isFinite(total) && total > 0 ? Math.floor(total) : 1;
};

/**
 * woocommerce mode (ADR-0006): walk the Store API listing, then expand the
 * parents whose sizes carry their own prices with one variation fetch each,
 * bounded. A listing page lost mid-walk fails the crawl rather than commit a
 * partial catalog (the tail would take archive strikes it does not deserve).
 */
const crawlWooCommerce = async (
	ctx: ActionCtx,
	input: SourceInput
): Promise<void> => {
	const fetchedAt = Date.now();
	let firstText: string | null = null;
	let totalPages = 1;
	try {
		const res = await fetch(wooProductsUrl(input.websiteUrl), {
			headers: WOO_FETCH_HEADERS,
			redirect: "follow",
		});
		if (res.ok) {
			firstText = await res.text();
			totalPages = wooTotalPages(res);
		}
	} catch {
		firstText = null;
	}
	const first = firstText === null ? null : parseWooPage(firstText);

	const products = new Map<string, ExtractedProduct>();
	const rejected = new Set<string>();
	const currencies = new Set<string>();
	const variationParents: WooListingPage["variationParents"] = [];
	let pageError: string | null = null;
	const absorb = (page: WooListingPage): void => {
		for (const product of page.products) {
			products.set(product.externalId, product);
		}
		for (const id of page.rejectedExternalIds) {
			rejected.add(id);
		}
		for (const code of page.currencies) {
			currencies.add(code);
		}
		variationParents.push(...page.variationParents);
	};
	if (first !== null) {
		absorb(first);
		const lastPage = Math.min(totalPages, MAX_WOO_PAGES);
		for (let page = 2; page <= lastPage; page += 1) {
			// Sequential by design: one shop, one listing, in order.
			// eslint-disable-next-line no-await-in-loop
			const text = await fetchPageText(
				wooProductsUrl(input.websiteUrl, page),
				WOO_FETCH_HEADERS
			);
			const parsed = text === null ? null : parseWooPage(text);
			if (parsed === null) {
				pageError = `Store API page ${page} unavailable; partial catalog discarded`;
				break;
			}
			absorb(parsed);
		}
		if (totalPages > MAX_WOO_PAGES) {
			console.warn(
				`${input.websiteUrl}: Store API reports ${totalPages} pages; catalog exceeds the crawl cap`
			);
		}
	}

	const extractionOk =
		first !== null && pageError === null && products.size + rejected.size > 0;
	const rawCapture = await captureBody(ctx, {
		contentType: "application/json",
		extractionOk,
		lastOkCaptureAt: input.lastOkCaptureAt,
		now: fetchedAt,
		text: firstText,
	});
	if (!extractionOk) {
		await failCrawl(ctx, {
			crawlSourceId: input.crawlSourceId,
			errorMessage:
				pageError ?? "WooCommerce Store API unavailable or listed no products",
			fetchedAt,
			...(rawCapture === undefined ? {} : { rawCapture }),
		});
		return;
	}

	// Sizes with their own prices replace the listing's single variant. A
	// variation fetch that fails leaves the listing variant in place.
	const expansions = variationParents.slice(0, MAX_WOO_VARIATION_FETCHES);
	if (variationParents.length > expansions.length) {
		console.warn(
			`${input.websiteUrl}: ${variationParents.length} variable products, expanding ${expansions.length}`
		);
	}
	await inChunks(
		expansions,
		PRODUCT_SCRAPE_CONCURRENCY,
		async ({ externalId, parentId }) => {
			const text = await fetchPageText(
				wooVariationsUrl(input.websiteUrl, parentId),
				WOO_FETCH_HEADERS
			);
			if (text === null) {
				return;
			}
			let variants: ExtractedProduct["variants"] = [];
			try {
				variants = parseWooVariations(JSON.parse(text));
			} catch {
				return;
			}
			const product = products.get(externalId);
			if (product !== undefined && variants.length > 0) {
				products.set(externalId, { ...product, variants });
			}
		}
	);

	await commitCatalog(ctx, {
		crawlSourceId: input.crawlSourceId,
		fetchedAt,
		isBaseline: input.isBaseline,
		market: marketFromCurrencies([...currencies], input.websiteUrl, fetchedAt),
		products: [...products.values()],
		rejectedExternalIds: [...rejected],
		...(rawCapture === undefined ? {} : { rawCapture }),
	});
};

/**
 * Product URLs from the shop's sitemap: the index's product sitemaps (or the
 * index itself when it is a plain urlset), filtered to product paths. The
 * fallback for a collection page that listed nothing; a sitemap also names
 * every retired page, so it is never the first choice.
 */
const productUrlsFromSitemap = async (
	websiteUrl: string
): Promise<string[]> => {
	const { origin } = new URL(websiteUrl);
	const index = await fetchPageText(`${origin}/sitemap.xml`);
	if (index === null) {
		return [];
	}
	const locations = sitemapLocations(index);
	const children = productSitemaps(
		locations.filter((loc) => /\.xml(?:\?|$)/iu.test(loc))
	).slice(0, MAX_SITEMAPS);
	if (children.length === 0) {
		return productUrlsFromLinks(locations, origin);
	}
	const bodies = await Promise.all(children.map((loc) => fetchPageText(loc)));
	return productUrlsFromLinks(
		bodies.flatMap((body) => (body === null ? [] : sitemapLocations(body))),
		origin
	);
};

interface CollectionRead {
	links: string[];
	/** `changeTracking.changeStatus`, or null when Firecrawl returned none. */
	changeStatus: string | null;
	ok: boolean;
}

/**
 * One scrape of the collection page: its product links, and whether the
 * page changed since the last crawl (Firecrawl compares markdown snapshots
 * per URL and team; `maxAge` is ignored with changeTracking, and
 * onlyMainContent must stay constant between scrapes for the comparison to
 * hold). 1 credit.
 */
const readCollectionPage = async (
	ctx: ActionCtx,
	url: string
): Promise<CollectionRead> => {
	try {
		const doc = await firecrawl.scrape(ctx, url, {
			formats: ["markdown", "links", "changeTracking"],
			onlyMainContent: true,
			timeout: SCRAPE_TIMEOUT_MS,
		});
		const status = doc.changeTracking?.changeStatus;
		return {
			changeStatus: typeof status === "string" ? status : null,
			links: (doc.links ?? []).filter(
				(link): link is string => typeof link === "string"
			),
			ok: doc.metadata?.statusCode === 200,
		};
	} catch {
		return { changeStatus: null, links: [], ok: false };
	}
};

interface ProductPagesInput extends SourceInput {
	collectionUrl: string;
	lastFullCrawlAt?: number;
}

/**
 * product_pages mode (ADR-0006): the collection page gates the crawl, then
 * each product page is read through Firecrawl's product format. The scrape
 * set is the grid's product links first (what the shop sells now), then the
 * catalog's current lots (so a lot that left the grid is still read, and
 * archived once its page is gone), then the sitemap only if the grid listed
 * nothing; capped at MAX_PRODUCT_PAGES credits. An unchanged grid skips the
 * product scrapes unless the baseline is pending or the last full read is
 * older than PRODUCT_PAGES_FULL_INTERVAL_MS (a size selling out can leave
 * the grid unchanged).
 */
const crawlProductPages = async (
	ctx: ActionCtx,
	input: ProductPagesInput
): Promise<void> => {
	const fetchedAt = Date.now();
	const collection = await readCollectionPage(ctx, input.collectionUrl);
	if (!collection.ok) {
		await failCrawl(ctx, {
			crawlSourceId: input.crawlSourceId,
			errorMessage: `collection page unavailable: ${input.collectionUrl}`,
			fetchedAt,
		});
		return;
	}
	const fullReadDue =
		input.lastFullCrawlAt === undefined ||
		fetchedAt - input.lastFullCrawlAt >= PRODUCT_PAGES_FULL_INTERVAL_MS;
	if (
		collection.changeStatus === "same" &&
		!(input.isBaseline || fullReadDue)
	) {
		await ctx.runMutation(internal.crawlSources.finalizeCrawl, {
			catalogUnchanged: true,
			crawlSourceId: input.crawlSourceId,
			fetchedAt,
			success: true,
		});
		return;
	}

	const { origin } = new URL(input.websiteUrl);
	const known: string[] = await ctx.runQuery(
		internal.crawlSources.listCurrentLotUrls,
		{ roasterId: input.roasterId }
	);
	let urls = productUrlsFromLinks([...collection.links, ...known], origin);
	if (urls.length === 0) {
		urls = await productUrlsFromSitemap(input.websiteUrl);
	}
	if (urls.length > MAX_PRODUCT_PAGES) {
		console.warn(
			`${input.websiteUrl}: ${urls.length} product pages, reading ${MAX_PRODUCT_PAGES}`
		);
		urls = urls.slice(0, MAX_PRODUCT_PAGES);
	}
	if (urls.length === 0) {
		await failCrawl(ctx, {
			crawlSourceId: input.crawlSourceId,
			errorMessage: "no product pages found on the collection page or sitemap",
			fetchedAt,
		});
		return;
	}

	const products: ExtractedProduct[] = [];
	const rejected: string[] = [];
	const currencies = new Set<string>();
	let unreadable = 0;
	const readOne = async (url: string): Promise<void> => {
		let raw: unknown;
		try {
			// Stock and price must be live: Firecrawl's default cache is two
			// days old, so the cache is bypassed here on purpose.
			const doc = await firecrawl.scrape(ctx, url, {
				formats: ["product"],
				maxAge: 0,
				timeout: SCRAPE_TIMEOUT_MS,
			});
			raw = doc.metadata?.statusCode === 200 ? doc.product : undefined;
		} catch {
			raw = undefined;
		}
		const parsed = parseProductPage(raw, url);
		if (parsed.product !== null) {
			products.push(parsed.product);
			for (const code of parsed.currencies) {
				currencies.add(code);
			}
		} else if (parsed.rejected) {
			rejected.push(url);
		} else {
			unreadable += 1;
		}
	};
	await inChunks(urls, PRODUCT_SCRAPE_CONCURRENCY, readOne);

	if (products.length === 0 && rejected.length === 0) {
		await failCrawl(ctx, {
			crawlSourceId: input.crawlSourceId,
			errorMessage: `no structured product data on ${unreadable} product pages`,
			fetchedAt,
		});
		return;
	}
	if (unreadable > 0) {
		console.warn(
			`${input.websiteUrl}: ${unreadable} of ${urls.length} product pages had no product data`
		);
	}
	await commitCatalog(ctx, {
		crawlSourceId: input.crawlSourceId,
		fetchedAt,
		isBaseline: input.isBaseline,
		market: marketFromCurrencies([...currencies], input.websiteUrl, fetchedAt),
		products,
		rejectedExternalIds: rejected,
	});
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
		const input: SourceInput = {
			crawlSourceId: source._id,
			isBaseline: source.lastSuccessAt === undefined,
			roasterId: roaster._id,
			websiteUrl: roaster.websiteUrl,
			...(loaded.lastOkCaptureAt === undefined
				? {}
				: { lastOkCaptureAt: loaded.lastOkCaptureAt }),
		};
		switch (source.mode) {
			case "products_json": {
				await crawlProductsJson(ctx, input);
				break;
			}
			case "woocommerce": {
				await crawlWooCommerce(ctx, input);
				break;
			}
			case "product_pages": {
				await crawlProductPages(ctx, {
					...input,
					collectionUrl: roaster.productPageUrl,
					...(source.lastFullCrawlAt === undefined
						? {}
						: { lastFullCrawlAt: source.lastFullCrawlAt }),
				});
				break;
			}
			default: {
				break;
			}
		}
		return null;
	},
	returns: v.null(),
});

/**
 * Operator tool: run the platform ladder (platform.ts) against a source's
 * shop and store the mode it lands on. Moves the roaster to `www.` when
 * that host answered. The submission flow (§7.1) will call the same probe.
 */
export const detectSourceMode = internalAction({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		const loaded = await ctx.runQuery(internal.crawlSources.getSource, {
			crawlSourceId: args.crawlSourceId,
		});
		if (loaded === null) {
			return null;
		}
		const probe = await probeShop({
			fetchPage: (url) =>
				fetchFeedPage(
					url,
					url.includes("/wp-json/") ? WOO_FETCH_HEADERS : SHOPIFY_FETCH_HEADERS
				),
			websiteUrl: loaded.roaster.websiteUrl,
		});
		if (probe.websiteUrl !== loaded.roaster.websiteUrl) {
			await ctx.runMutation(internal.crawlSources.recordFeedOrigin, {
				roasterId: loaded.roaster._id,
				websiteUrl: probe.websiteUrl,
			});
		}
		await ctx.runMutation(internal.crawlSources.setSourceMode, {
			crawlSourceId: args.crawlSourceId,
			mode: probe.mode,
		});
		return probe.mode;
	},
	returns: v.union(v.null(), sourceModeValidator),
});

/**
 * Commit an already-extracted catalog for a source. Tests drive the commit
 * path through it (batched applyProductBatch, then finalizeCrawl). Confirms
 * the shop market like the products_json path does, so the recommendation
 * eligibility gate (`confirmedAt === observedAt(source)`) can be exercised:
 * the confirmation stamps `fetchedAt`, which finalizeCrawl writes as
 * `lastSuccessAt` and `lastFullCrawlAt`. Fails closed: no confirmation, absent market, crawl still
 * succeeds.
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
		rejectedExternalIds: v.optional(v.array(v.string())),
	},
	handler: async (ctx, args) => {
		const loaded = await ctx.runQuery(internal.crawlSources.getSource, {
			crawlSourceId: args.crawlSourceId,
		});
		if (loaded === null) {
			return null;
		}
		const market = await confirmShopMarket(
			loaded.roaster.websiteUrl,
			args.fetchedAt
		);
		await commitCatalog(ctx, {
			crawlSourceId: args.crawlSourceId,
			fetchedAt: args.fetchedAt,
			isBaseline: loaded.source.lastSuccessAt === undefined,
			market,
			products: args.products,
			...(args.rawCapture === undefined ? {} : { rawCapture: args.rawCapture }),
			...(args.rejectedExternalIds === undefined
				? {}
				: { rejectedExternalIds: args.rejectedExternalIds }),
		});
		return null;
	},
	returns: v.null(),
});
