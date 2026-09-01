// Crawl source state machine: baseline rule, health tracking, the 3-strike
// archive, Drop event emission, and the scheduler queue (build order step 2).

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
	ARCHIVE_STRIKES,
	PRUNE_BATCH,
	rawCaptureRetentionMs,
	stalenessThresholdMs,
	TICK_BATCH,
} from "./constants";
import { extractedProduct } from "./extraction";
import type { ExtractedProduct } from "./extraction";
import schema from "./schema";

/** Source + roaster fields the crawler action needs. */
export const getSource = internalQuery({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		const source = await ctx.db.get(args.crawlSourceId);
		if (source === null) {
			return null;
		}
		const roaster = await ctx.db.get(source.roasterId);
		if (roaster === null) {
			return null;
		}
		return { roaster, source };
	},
	returns: v.union(
		v.null(),
		v.object({
			roaster: schema.doc("roasters"),
			source: schema.doc("crawlSources"),
		})
	),
});

interface DiffInput {
	eventsAllowed: boolean;
	fetchedAt: number;
	next: { available: boolean; grams?: number; priceCents: number };
	productId: Id<"products">;
	roasterId: Id<"roasters">;
	variant: Doc<"productVariants">;
}

/**
 * Compare one fetched variant against the stored one, patch it, and emit the
 * matching Drop event. Availability moves outrank price moves; a variant
 * coming back in stock while its price also changed cites both.
 */
const diffVariant = async (
	ctx: MutationCtx,
	input: DiffInput
): Promise<void> => {
	const { next, variant } = input;
	await ctx.db.patch(variant._id, {
		available: next.available,
		...(next.grams === undefined ? {} : { grams: next.grams }),
		priceCents: next.priceCents,
	});
	if (!input.eventsAllowed) {
		return;
	}

	const priceChanged = variant.priceCents !== next.priceCents;
	const priceFields = {
		...(priceChanged ? { newPriceCents: next.priceCents } : {}),
		...(priceChanged ? { oldPriceCents: variant.priceCents } : {}),
	};

	if (variant.available !== next.available) {
		await ctx.db.insert("dropEvents", {
			detectedAt: input.fetchedAt,
			...priceFields,
			productId: input.productId,
			roasterId: input.roasterId,
			type: next.available ? "back_in_stock" : "sold_out",
			variantId: variant._id,
		});
		return;
	}
	if (priceChanged) {
		await ctx.db.insert("dropEvents", {
			detectedAt: input.fetchedAt,
			...priceFields,
			productId: input.productId,
			roasterId: input.roasterId,
			type: next.priceCents < variant.priceCents ? "price_drop" : "price_rise",
			variantId: variant._id,
		});
	}
};

interface ApplyVariantsInput {
	eventsAllowed: boolean;
	fetchedAt: number;
	product: ExtractedProduct;
	productId: Id<"products">;
	roasterId: Id<"roasters">;
}

/**
 * Upsert one product's variants and emit its Drop events. A variant the
 * catalog has never seen is a "new" event; known variants diff against their
 * stored state. Variants are matched by display name (the schema keeps no
 * Shopify variant id).
 */
const applyVariants = async (
	ctx: MutationCtx,
	input: ApplyVariantsInput
): Promise<void> => {
	const existingVariants = await ctx.db
		.query("productVariants")
		.withIndex("by_product_id", (q) => q.eq("productId", input.productId))
		.collect();
	const existingByName = new Map(
		existingVariants.map((doc) => [doc.name, doc])
	);
	// Variants are matched by name, so a feed repeating a name (last wins)
	// must not double-insert the same variant in the Promise.all below.
	const fetchedByName = new Map(
		input.product.variants.map((variant) => [variant.name, variant])
	);

	await Promise.all(
		[...fetchedByName.values()].map(async (variant) => {
			const prior = existingByName.get(variant.name);
			if (prior === undefined) {
				const variantId = await ctx.db.insert("productVariants", {
					available: variant.available,
					...(variant.grams === undefined ? {} : { grams: variant.grams }),
					name: variant.name,
					priceCents: variant.priceCents,
					productId: input.productId,
				});
				if (input.eventsAllowed) {
					await ctx.db.insert("dropEvents", {
						detectedAt: input.fetchedAt,
						newPriceCents: variant.priceCents,
						productId: input.productId,
						roasterId: input.roasterId,
						type: "new",
						variantId,
					});
				}
				return;
			}
			await diffVariant(ctx, {
				eventsAllowed: input.eventsAllowed,
				fetchedAt: input.fetchedAt,
				next: variant,
				productId: input.productId,
				roasterId: input.roasterId,
				variant: prior,
			});
		})
	);
};

/**
 * Commit one crawl outcome in a single transaction: raw capture, catalog
 * upserts, Drop event diffing, 3-strike archiving, health, and the next due
 * date. Called by the crawler action (products_json mode) and by the Firecrawl
 * completion callback (html mode).
 */
export const applyCrawlResult = internalMutation({
	args: {
		crawlSourceId: v.id("crawlSources"),
		errorMessage: v.optional(v.string()),
		fetchedAt: v.number(),
		products: v.optional(v.array(extractedProduct)),
		rawCapture: v.optional(
			v.object({
				extractionOk: v.boolean(),
				storageId: v.id("_storage"),
			})
		),
		success: v.boolean(),
	},
	handler: async (ctx, args) => {
		const source = await ctx.db.get(args.crawlSourceId);
		if (source === null) {
			return null;
		}
		const cadenceMs = source.cadenceMinutes * 60_000;

		// The body itself lives in file storage (stored by the action; doc
		// limits don't apply there). extractionOk records whether extraction
		// succeeded, so a failed parse still leaves a diagnostic capture.
		if (args.rawCapture !== undefined) {
			await ctx.db.insert("rawCaptures", {
				capturedAt: args.fetchedAt,
				extractionOk: args.rawCapture.extractionOk,
				roasterId: source.roasterId,
				storageId: args.rawCapture.storageId,
			});
		}

		if (!args.success) {
			const failures = source.consecutiveFailures + 1;
			await ctx.db.patch(source._id, {
				consecutiveFailures: failures,
				health: "crawl_failed",
				lastCheckedAt: args.fetchedAt,
				lastErrorAt: args.fetchedAt,
				lastErrorMessage: args.errorMessage ?? "Unknown crawl error",
				nextCrawlDueAt: args.fetchedAt + cadenceMs,
			});
			return null;
		}

		const products = args.products ?? [];
		const now = args.fetchedAt;
		// Baseline = first successful crawl: populates the catalog and fires
		// no Drop events (alerts start from crawl #2).
		const isBaseline = source.lastSuccessAt === undefined;

		// Every product this roaster currently has. Bounded by one roaster's
		// catalog via the composite index, not the whole table.
		const existing = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_external_id", (q) =>
				q.eq("roasterId", source.roasterId)
			)
			.collect();
		const existingByExternalId = new Map(
			existing.map((doc) => [doc.externalId, doc])
		);

		await Promise.all(
			products.map(async (product) => {
				const current = existingByExternalId.get(product.externalId);
				if (current === undefined) {
					const productId = await ctx.db.insert("products", {
						externalId: product.externalId,
						firstSeenAt: now,
						handle: product.handle,
						lastSeenAt: now,
						missedCrawls: 0,
						name: product.name,
						roasterId: source.roasterId,
						status: "current",
					});
					await applyVariants(ctx, {
						eventsAllowed: !isBaseline,
						fetchedAt: now,
						product,
						productId,
						roasterId: source.roasterId,
					});
					return;
				}
				await applyVariants(ctx, {
					eventsAllowed: !isBaseline,
					fetchedAt: now,
					product,
					productId: current._id,
					roasterId: source.roasterId,
				});
				await ctx.db.patch(current._id, {
					lastSeenAt: now,
					missedCrawls: 0,
					name: product.name,
					status: "current",
				});
			})
		);

		// 3-strike archive: a current product absent from 3 consecutive
		// successful crawls flips to archived (keeps firstSeenAt/lastSeenAt).
		const fetchedIds = new Set(products.map((product) => product.externalId));
		await Promise.all(
			existing
				.filter(
					(doc) => doc.status === "current" && !fetchedIds.has(doc.externalId)
				)
				.map(async (doc) => {
					const missed = (doc.missedCrawls ?? 0) + 1;
					if (missed >= ARCHIVE_STRIKES) {
						await ctx.db.patch(doc._id, { status: "archived" });
						return;
					}
					await ctx.db.patch(doc._id, { missedCrawls: missed });
				})
		);

		// pending -> active is data-driven: a baseline capture is the gate.
		const roaster = await ctx.db.get(source.roasterId);
		if (roaster !== null && roaster.status === "pending") {
			await ctx.db.patch(roaster._id, { status: "active" });
		}

		await ctx.db.patch(source._id, {
			consecutiveFailures: 0,
			health: "watching",
			lastCheckedAt: now,
			lastSuccessAt: now,
			nextCrawlDueAt: now + cadenceMs,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Scheduler tick: claim every source whose crawl is due and hand it to the
 * crawler action. The claim (due date pushed to now + cadence) keeps a
 * concurrent tick from double-running the same source; applyCrawlResult sets
 * the real next due date when the crawl commits.
 */
export const tick = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const due = await ctx.db
			.query("crawlSources")
			.withIndex("by_next_crawl_due_at", (q) => q.lte("nextCrawlDueAt", now))
			.take(TICK_BATCH);
		await Promise.all(
			due.map(async (source) => {
				await ctx.db.patch(source._id, {
					nextCrawlDueAt: now + source.cadenceMinutes * 60_000,
				});
				await ctx.scheduler.runAfter(0, internal.crawler.crawlSource, {
					crawlSourceId: source._id,
				});
			})
		);
		return null;
	},
	returns: v.null(),
});

/**
 * Retention sweep: raw capture bodies are diagnostics, not product data, and
 * hourly crawls across 20 sources add ~100 MB/day of file storage. Deletes
 * captures past the retention window (blob first, then the row) in batches,
 * rescheduling itself while a full batch keeps coming back.
 */
export const pruneRawCaptures = internalMutation({
	args: {},
	handler: async (ctx) => {
		const cutoff = Date.now() - rawCaptureRetentionMs();
		const stale = await ctx.db
			.query("rawCaptures")
			.withIndex("by_captured_at", (q) => q.lte("capturedAt", cutoff))
			.take(PRUNE_BATCH);
		await Promise.all(
			stale.map(async (capture) => {
				await ctx.storage.delete(capture.storageId);
				await ctx.db.delete(capture._id);
			})
		);
		if (stale.length === PRUNE_BATCH) {
			await ctx.scheduler.runAfter(
				0,
				internal.crawlSources.pruneRawCaptures,
				{}
			);
		}
		return null;
	},
	returns: v.null(),
});

/**
 * Stale sweep: a source that is "watching" but has had no successful crawl
 * within 2x its cadence (minimum 1 hour) flips to stale. crawl_failed already
 * says the last crawl failed; stale says silence has dragged on.
 */
export const sweepStale = internalMutation({
	args: {},
	handler: async (ctx) => {
		const now = Date.now();
		const watching = await ctx.db
			.query("crawlSources")
			.withIndex("by_health", (q) => q.eq("health", "watching"))
			.take(100);
		await Promise.all(
			watching
				.filter((source) => {
					const threshold = stalenessThresholdMs(source.cadenceMinutes);
					return (
						source.lastSuccessAt === undefined ||
						now - source.lastSuccessAt > threshold
					);
				})
				.map(async (source) => {
					await ctx.db.patch(source._id, { health: "stale" });
				})
		);
		return null;
	},
	returns: v.null(),
});
