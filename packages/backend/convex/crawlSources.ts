// Crawl source state machine: baseline rule, health tracking, the 3-strike
// archive, Drop event emission, and the scheduler queue (build order step 2).

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
	ARCHIVE_STRIKES,
	MAX_CITED_VARIANTS,
	MAX_PRODUCT_PAGES,
	MAX_WEIGHT_OPTIONS,
	PRUNE_BATCH,
	rawCaptureRetentionMs,
	stalenessThresholdMs,
	TICK_BATCH,
} from "./constants";
import { extractedProduct } from "./extraction";
import type { ExtractedProduct, ExtractedVariant } from "./extraction";
import { isCrawlRunning } from "./health";
import { notifyWatchersOfEvent } from "./notifications";
import schema from "./schema";
import { shopMarketValidator } from "./shopMarket";
import { sourceModeValidator } from "./sourceMode";
import { ensureWatch } from "./watches";

/**
 * Source + roaster fields the crawler action needs, plus when the roaster's
 * last successful raw capture was taken (the crawler stores a new success
 * capture at most once a day, #33).
 */
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
		const lastOkCapture = await ctx.db
			.query("rawCaptures")
			.withIndex("by_roaster_id_and_extraction_ok_and_captured_at", (q) =>
				q.eq("roasterId", roaster._id).eq("extractionOk", true)
			)
			.order("desc")
			.first();
		return {
			roaster,
			source,
			...(lastOkCapture === null
				? {}
				: { lastOkCaptureAt: lastOkCapture.capturedAt }),
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			lastOkCaptureAt: v.optional(v.number()),
			roaster: schema.doc("roasters"),
			source: schema.doc("crawlSources"),
		})
	),
});

/**
 * One variant's move as the crawl observed it, taken while patching: the
 * event vocabulary's kind, the variant id, and the prices on both sides of
 * the move. A burst collects these and emits at most one event per kind.
 */
interface VariantMove {
	kind: "back_in_stock" | "sold_out" | "price_drop" | "price_rise";
	newPriceCents: number;
	oldPriceCents: number;
	variantId: Id<"productVariants">;
}

interface DiffInput {
	eventsAllowed: boolean;
	fetchedAt: number;
	next: {
		available: boolean;
		externalId?: string;
		grams?: number;
		priceCents: number;
	};
	productId: Id<"products">;
	roasterId: Id<"roasters">;
	variant: Doc<"productVariants">;
}

/**
 * Compare one fetched variant against the stored one, patch it, and report
 * the move without emitting: one crawl of one product is one burst, and the
 * burst emits at most one event per kind (#19 generalized). Availability
 * outranks price for the same variant, so a variant that came back in stock
 * while its price also changed reports one back_in_stock move citing both
 * prices. Null when nothing moved.
 */
const diffVariant = async (
	ctx: MutationCtx,
	input: DiffInput
): Promise<VariantMove | null> => {
	const { next, variant } = input;
	const oldPriceCents = variant.priceCents;
	await ctx.db.patch(variant._id, {
		available: next.available,
		// The id backfills on the next crawl after the source added it; a
		// name-matched variant keeps its name identity while gaining the link.
		...(next.externalId === undefined || next.externalId === variant.externalId
			? {}
			: { externalId: next.externalId }),
		...(next.grams === undefined ? {} : { grams: next.grams }),
		observedAt: input.fetchedAt,
		priceCents: next.priceCents,
		sizeObservedAt: next.grams === undefined ? undefined : input.fetchedAt,
	});
	if (!input.eventsAllowed) {
		return null;
	}
	if (variant.available !== next.available) {
		return {
			kind: next.available ? "back_in_stock" : "sold_out",
			newPriceCents: next.priceCents,
			oldPriceCents,
			variantId: variant._id,
		};
	}
	if (oldPriceCents !== next.priceCents) {
		return {
			kind: next.priceCents < oldPriceCents ? "price_drop" : "price_rise",
			newPriceCents: next.priceCents,
			oldPriceCents,
			variantId: variant._id,
		};
	}
	return null;
};

/**
 * One collapsed Drop event: the type, the headline variant the cards and
 * emails name, its price fields, and every moved variant cited in
 * `variantIds`.
 */
interface BurstEvent {
	newPriceCents?: number;
	oldPriceCents?: number;
	type: "back_in_stock" | "new" | "price_drop" | "price_rise" | "sold_out";
	variantId: Id<"productVariants">;
	variantIds: Id<"productVariants">[];
}

const emitBurstEvents = async (
	ctx: MutationCtx,
	input: {
		events: BurstEvent[];
		fetchedAt: number;
		productId: Id<"products">;
		roasterId: Id<"roasters">;
	}
): Promise<void> => {
	for (const event of input.events) {
		// eslint-disable-next-line no-await-in-loop -- at most five events per burst; each insert fans out to watchers before the next
		const eventId = await ctx.db.insert("dropEvents", {
			detectedAt: input.fetchedAt,
			...(event.newPriceCents === undefined
				? {}
				: { newPriceCents: event.newPriceCents }),
			...(event.oldPriceCents === undefined
				? {}
				: { oldPriceCents: event.oldPriceCents }),
			productId: input.productId,
			roasterId: input.roasterId,
			type: event.type,
			variantId: event.variantId,
			...(event.variantIds.length > 1
				? { variantIds: event.variantIds.slice(0, MAX_CITED_VARIANTS) }
				: {}),
		});
		// eslint-disable-next-line no-await-in-loop -- paired with the insert above
		await notifyWatchersOfEvent(ctx, eventId);
	}
};

interface ApplyVariantsInput {
	eventsAllowed: boolean;
	fetchedAt: number;
	// True when upsertProduct inserted the product row during this same crawl:
	// the lot's first sighting. Every size is new at once and they are one
	// fact, so they share one "new" event citing the cheapest size (#19).
	isNewProduct: boolean;
	product: ExtractedProduct;
	productId: Id<"products">;
	roasterId: Id<"roasters">;
}

/**
 * A headline rule: positive when `move` outranks `best`. Ties keep `best`,
 * so the first qualifying move in feed order wins.
 */
type Outranks = (best: VariantMove, move: VariantMove) => number;

/** The bigger price move, up or down (ties: the cheaper new price). */
const biggerMove: Outranks = (best, move) =>
	Math.abs(move.oldPriceCents - move.newPriceCents) -
		Math.abs(best.oldPriceCents - best.newPriceCents) ||
	best.newPriceCents - move.newPriceCents;

/** The cheaper size to buy now. */
const cheaperNow: Outranks = (best, move) =>
	best.newPriceCents - move.newPriceCents;

/** The cheaper size before the move (what a sold-out size used to cost). */
const cheaperBefore: Outranks = (best, move) =>
	best.oldPriceCents - move.oldPriceCents;

/** The move a burst's event names, under one rule; undefined for none. */
const pickHeadline = (
	moves: VariantMove[],
	outranks: Outranks
): VariantMove | undefined => {
	let headline: VariantMove | undefined;
	for (const move of moves) {
		if (headline === undefined || outranks(headline, move) > 0) {
			headline = move;
		}
	}
	return headline;
};

/**
 * The variant rollup the lot page and the roaster-grid filters read, taken
 * from the fetched variants (the feed is the truth on stock and price every
 * crawl): whether any size is purchaseable, the cheapest size's price, and
 * the distinct bag sizes ascending (capped). Written in the same patch as
 * the product's other feed fields, so it never drifts by more than one
 * crawl.
 */
export const variantRollup = (
	variants: readonly ExtractedVariant[]
): {
	anyAvailable?: boolean;
	minPriceCents?: number;
	weightOptions?: number[];
} => {
	if (variants.length === 0) {
		return {};
	}
	const grams = [
		...new Set(
			variants
				.map((variant) => variant.grams)
				.filter((value): value is number => value !== undefined)
		),
	];
	return {
		anyAvailable: variants.some((variant) => variant.available),
		minPriceCents: Math.min(...variants.map((variant) => variant.priceCents)),
		// oxlint-disable-next-line unicorn/no-array-sort -- ES2021 backend; slice copies first
		weightOptions: grams.slice(0, MAX_WEIGHT_OPTIONS).sort((a, b) => a - b),
	};
};

/**
 * The collapsed events one burst emits, planned from the reported moves:
 * at most one event per kind, each naming a headline variant and carrying
 * every moved variant in `variantIds`.
 *
 * Availability moves headline the cheapest restocked size, so the card
 * names the price a customer can actually pay first; the price fields are
 * cited only when the headline's own price moved. Price moves headline the
 * biggest delta (ties: cheaper new price), availability-unchanged variants
 * only — a variant that both restocked and repriced is already covered by
 * its back_in_stock event. The sold-out burst cites the cheapest size that
 * sold out; it is stored but not alert-worthy, so no card or email rides
 * on it.
 */
const planBurstEvents = (moves: VariantMove[]): BurstEvent[] => {
	const burstEvents: BurstEvent[] = [];
	const ofKind = (kind: VariantMove["kind"]) =>
		moves.filter((move) => move.kind === kind);

	const restocks = ofKind("back_in_stock");
	const restock = pickHeadline(restocks, cheaperNow);
	if (restock !== undefined) {
		burstEvents.push({
			...(restock.oldPriceCents === restock.newPriceCents
				? {}
				: {
						newPriceCents: restock.newPriceCents,
						oldPriceCents: restock.oldPriceCents,
					}),
			type: "back_in_stock",
			variantId: restock.variantId,
			variantIds: restocks.map((move) => move.variantId),
		});
	}

	for (const kind of ["price_drop", "price_rise"] as const) {
		const priceMoves = ofKind(kind);
		const headline = pickHeadline(priceMoves, biggerMove);
		if (headline !== undefined) {
			burstEvents.push({
				newPriceCents: headline.newPriceCents,
				oldPriceCents: headline.oldPriceCents,
				type: kind,
				variantId: headline.variantId,
				variantIds: priceMoves.map((move) => move.variantId),
			});
		}
	}

	const soldOut = ofKind("sold_out");
	const soldOutHeadline = pickHeadline(soldOut, cheaperBefore);
	if (soldOutHeadline !== undefined) {
		burstEvents.push({
			type: "sold_out",
			variantId: soldOutHeadline.variantId,
			variantIds: soldOut.map((move) => move.variantId),
		});
	}

	return burstEvents;
};

/**
 * Upsert one product's variants and emit its Drop events. A variant the
 * catalog has never seen joins a "new" event; known variants diff against
 * their stored state and the burst emits at most one event per kind. On a
 * lot's first sighting every size is new at once, so the events collapse to
 * one citing the cheapest size (#19); sizes added to a known lot later
 * collapse the same way. Variants are matched by display name (the schema
 * keeps no source variant id as identity).
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
	// must not double-insert the same variant below.
	const fetchedByName = new Map(
		input.product.variants.map((variant) => [variant.name, variant])
	);

	const targets = [...fetchedByName.values()].map((variant) => ({
		next: variant,
		prior: existingByName.get(variant.name) ?? null,
	}));
	// Partition before writing: known variants diff against their stored
	// state, unknown ones insert and are kept for the event emission below.
	const diffTargets: {
		next: ExtractedVariant;
		prior: Doc<"productVariants">;
	}[] = [];
	const addTargets: ExtractedVariant[] = [];
	for (const { next, prior } of targets) {
		if (prior === null) {
			addTargets.push(next);
			continue;
		}
		diffTargets.push({ next, prior });
	}

	const added = await Promise.all(
		addTargets.map(async (next) => {
			const variantId = await ctx.db.insert("productVariants", {
				available: next.available,
				...(next.externalId === undefined
					? {}
					: { externalId: next.externalId }),
				...(next.grams === undefined ? {} : { grams: next.grams }),
				name: next.name,
				observedAt: input.fetchedAt,
				priceCents: next.priceCents,
				productId: input.productId,
				sizeObservedAt: next.grams === undefined ? undefined : input.fetchedAt,
			});
			return { priceCents: next.priceCents, variantId };
		})
	);
	const reported = await Promise.all(
		diffTargets.map(({ next, prior }) =>
			diffVariant(ctx, {
				eventsAllowed: input.eventsAllowed,
				fetchedAt: input.fetchedAt,
				next,
				productId: input.productId,
				roasterId: input.roasterId,
				variant: prior,
			})
		)
	);
	const moves = reported.filter((move): move is VariantMove => move !== null);

	if (!input.eventsAllowed) {
		return;
	}

	await emitBurstEvents(ctx, {
		events: planBurstEvents(moves),
		fetchedAt: input.fetchedAt,
		productId: input.productId,
		roasterId: input.roasterId,
	});

	if (added.length === 0) {
		return;
	}
	// One "new" event per burst (#19, also for sizes added to a known lot):
	// first minimum wins, so a price tie cites the size the feed listed
	// first. added is non-empty here (guarded above).
	let cheapest:
		| { priceCents: number; variantId: Id<"productVariants"> }
		| undefined;
	for (const item of added) {
		if (cheapest === undefined || item.priceCents < cheapest.priceCents) {
			cheapest = item;
		}
	}
	if (cheapest !== undefined) {
		await emitBurstEvents(ctx, {
			events: [
				{
					newPriceCents: cheapest.priceCents,
					type: "new",
					variantId: cheapest.variantId,
					variantIds: added.map((item) => item.variantId),
				},
			],
			fetchedAt: input.fetchedAt,
			productId: input.productId,
			roasterId: input.roasterId,
		});
	}
};

interface UpsertProductInput {
	eventsAllowed: boolean;
	fetchedAt: number;
	product: ExtractedProduct;
	roasterId: Id<"roasters">;
}

/**
 * §14.4 lot-copy fields for the product write. When the source carries
 * `lotCopy` it is authoritative for the roaster's copy: every field is
 * written, and an `undefined` one clears the stored value (patch deletes the
 * field; insert skips it), so a roaster who removes their tasting prose does
 * not keep stale descriptors shown as their verbatim words. A source without
 * `lotCopy` (HTML mode) leaves the stored copy alone.
 */
const lotCopyFields = (product: ExtractedProduct): Partial<Doc<"products">> => {
	if (product.lotCopy === undefined) {
		return {};
	}
	// pageFacts and copyFetchedAt are not here on purpose: the page scrape
	// owns them (ADR-0005), so a feed write can never clear a page fact.
	const {
		description,
		elevation,
		imageUrl,
		origin,
		process,
		producer,
		productType,
		region,
		roastLevel,
		roasterNotes,
		tags,
		variety,
	} = product.lotCopy;
	return {
		description,
		elevation,
		imageUrl,
		origin,
		process,
		producer,
		productType,
		region,
		roastLevel,
		roasterNotes,
		tags,
		variety,
	};
};

/** Insert or refresh one product (by roaster + externalId) and its variants. */
const upsertProduct = async (
	ctx: MutationCtx,
	input: UpsertProductInput
): Promise<void> => {
	const { fetchedAt: now, product, roasterId } = input;
	const current = await ctx.db
		.query("products")
		.withIndex("by_roaster_and_external_id", (q) =>
			q.eq("roasterId", roasterId).eq("externalId", product.externalId)
		)
		.unique();
	let productId: Id<"products">;
	// The variant rollup comes from this crawl's fetched variants (the feed's
	// own stock and price), not the stored ones: the feed is the truth.
	const rollup = variantRollup(product.variants);
	if (current === null) {
		productId = await ctx.db.insert("products", {
			externalId: product.externalId,
			firstSeenAt: now,
			handle: product.handle,
			lastSeenAt: now,
			missedCrawls: 0,
			name: product.name,
			roasterId,
			status: "current",
			...lotCopyFields(product),
			...(product.url === undefined ? {} : { url: product.url }),
			...rollup,
		});
	} else {
		productId = current._id;
		await ctx.db.patch(productId, {
			lastSeenAt: now,
			missedCrawls: 0,
			name: product.name,
			status: "current",
			...lotCopyFields(product),
			...(product.url === undefined ? {} : { url: product.url }),
			...rollup,
		});
	}
	await applyVariants(ctx, {
		eventsAllowed: input.eventsAllowed,
		fetchedAt: now,
		isNewProduct: current === null,
		product,
		productId,
		roasterId,
	});
};

/**
 * Commit one batch of a crawl's catalog: product upserts, variant diffing,
 * and Drop event emission. A whole catalog no longer fits one transaction
 * (Proud Mary: 722 products, 5,500 variants), so the crawler action slices
 * it into COMMIT_BATCH_PRODUCTS-sized calls and then runs finalizeCrawl.
 * Re-running a batch is idempotent: diffs against already-updated variants
 * emit nothing.
 */
export const applyProductBatch = internalMutation({
	args: {
		crawlSourceId: v.id("crawlSources"),
		// Decided once per crawl by the action (baseline crawls fire nothing)
		// so every batch of the same crawl agrees.
		eventsAllowed: v.boolean(),
		fetchedAt: v.number(),
		products: v.array(extractedProduct),
	},
	handler: async (ctx, args) => {
		const source = await ctx.db.get(args.crawlSourceId);
		if (source === null) {
			return null;
		}
		await Promise.all(
			args.products.map((product) =>
				upsertProduct(ctx, {
					eventsAllowed: args.eventsAllowed,
					fetchedAt: args.fetchedAt,
					product,
					roasterId: source.roasterId,
				})
			)
		);
		return null;
	},
	returns: v.null(),
});

/**
 * Delete a Drop event and its notification ledger rows. A notification cites
 * its event by id and nothing resolves it the other way, but the rows would
 * otherwise dangle forever.
 */
const deleteDropEvent = async (
	ctx: MutationCtx,
	eventId: Id<"dropEvents">
): Promise<void> => {
	const notifications = await ctx.db
		.query("notifications")
		.withIndex("by_drop_event_id", (q) => q.eq("dropEventId", eventId))
		.collect();
	await Promise.all(notifications.map((n) => ctx.db.delete(n._id)));
	await ctx.db.delete(eventId);
};

/**
 * Remove a non-lot from the catalog: its variants, its drop events, then the
 * row. If anyone logged it, archive it instead so the log keeps its lot.
 */
const purgeNonLot = async (
	ctx: MutationCtx,
	doc: Doc<"products">
): Promise<void> => {
	const logged = await ctx.db
		.query("logs")
		.withIndex("by_product_and_logged_at", (q) => q.eq("productId", doc._id))
		.first();
	if (logged !== null) {
		if (doc.status === "current") {
			await ctx.db.patch(doc._id, { status: "archived" });
		}
		return;
	}
	const [variants, events] = await Promise.all([
		ctx.db
			.query("productVariants")
			.withIndex("by_product_id", (q) => q.eq("productId", doc._id))
			.collect(),
		ctx.db
			.query("dropEvents")
			.withIndex("by_product", (q) => q.eq("productId", doc._id))
			.collect(),
	]);
	await Promise.all([
		...variants.map((variant) => ctx.db.delete(variant._id)),
		...events.map((event) => deleteDropEvent(ctx, event._id)),
	]);
	await ctx.db.delete(doc._id);
};

/**
 * Close out one crawl after its batches: raw capture, failure bookkeeping or
 * the 3-strike archive, non-lot purge, roaster activation, health, the next
 * due date, and the runningSince stamp cleared either way.
 * The archive pass reads the roaster's whole catalog (one index range), which
 * is fine up to a few thousand products.
 */
export const finalizeCrawl = internalMutation({
	args: {
		// product_pages: the collection page was unchanged since the last
		// crawl, so no product was read. The crawl still counts as a success
		// (the shop answered) but the catalog is left exactly as it was: no
		// archive strikes, no purge, no lastFullCrawlAt.
		catalogUnchanged: v.optional(v.boolean()),
		crawlSourceId: v.id("crawlSources"),
		errorMessage: v.optional(v.string()),
		fetchedAt: v.number(),
		// externalIds of every product the crawl saw; drives the archive rule.
		fetchedExternalIds: v.optional(v.array(v.string())),
		market: v.optional(shopMarketValidator),
		rawCapture: v.optional(
			v.object({
				extractionOk: v.boolean(),
				storageId: v.id("_storage"),
			})
		),
		// externalIds the lot classifier rejected (§16); purged if still here.
		rejectedExternalIds: v.optional(v.array(v.string())),
		success: v.boolean(),
	},
	handler: async (ctx, args) => {
		const source = await ctx.db.get(args.crawlSourceId);
		if (source === null) {
			return null;
		}
		const now = args.fetchedAt;
		const cadenceMs = source.cadenceMinutes * 60_000;

		// The body itself lives in file storage (stored by the action; doc
		// limits don't apply there). extractionOk records whether extraction
		// succeeded, so a failed parse still leaves a diagnostic capture.
		if (args.rawCapture !== undefined) {
			await ctx.db.insert("rawCaptures", {
				capturedAt: now,
				extractionOk: args.rawCapture.extractionOk,
				roasterId: source.roasterId,
				storageId: args.rawCapture.storageId,
			});
		}

		if (!args.success) {
			await ctx.db.patch(source._id, {
				consecutiveFailures: source.consecutiveFailures + 1,
				health: "crawl_failed",
				lastCheckedAt: now,
				lastErrorAt: now,
				lastErrorMessage: args.errorMessage ?? "Unknown crawl error",
				nextCrawlDueAt: now + cadenceMs,
				runningSince: undefined,
			});
			return null;
		}

		if (args.catalogUnchanged === true) {
			await ctx.db.patch(source._id, {
				consecutiveFailures: 0,
				health: "watching",
				lastCheckedAt: now,
				lastErrorMessage: undefined,
				lastSuccessAt: now,
				nextCrawlDueAt: now + cadenceMs,
				runningSince: undefined,
			});
			return null;
		}

		const fetchedIds = new Set(args.fetchedExternalIds);
		const rejectedIds = new Set(args.rejectedExternalIds);
		const existing = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_external_id", (q) =>
				q.eq("roasterId", source.roasterId)
			)
			.collect();

		// Non-lot purge (§16): a product the classifier now rejects never was a
		// lot, so it leaves the catalog outright (variants and events too)
		// rather than waiting out three strikes. One a taster has logged is
		// archived instead: logs never lose their lot (§14.1). Capped per crawl:
		// each purge costs three reads and a handful of deletes, and a rule
		// tightening on a Sey-sized catalog could otherwise blow the transaction.
		// The feed names the rejects again next crawl, so the rest follow then.
		await Promise.all(
			existing
				.filter((doc) => rejectedIds.has(doc.externalId))
				.slice(0, PRUNE_BATCH)
				.map((doc) => purgeNonLot(ctx, doc))
		);

		// 3-strike archive: a current product absent from 3 consecutive
		// successful crawls flips to archived (keeps firstSeenAt/lastSeenAt).
		await Promise.all(
			existing
				.filter(
					(doc) =>
						doc.status === "current" &&
						!(fetchedIds.has(doc.externalId) || rejectedIds.has(doc.externalId))
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
		// A submitted roaster's submitter starts watching it here (§7.1 step
		// 6): the watch exists the moment the shop is readable.
		const roaster = await ctx.db.get(source.roasterId);
		if (roaster !== null && roaster.status === "pending") {
			await ctx.db.patch(roaster._id, { status: "active" });
			if (roaster.submittedByUserId !== undefined) {
				await ensureWatch(ctx, roaster.submittedByUserId, roaster._id);
			}
		}

		await ctx.db.patch(source._id, {
			consecutiveFailures: 0,
			health: "watching",
			lastCheckedAt: now,
			// A success ends the error story; the timestamp stays as history.
			lastErrorMessage: undefined,
			lastFullCrawlAt: now,
			lastSuccessAt: now,
			market: args.market,
			nextCrawlDueAt: now + cadenceMs,
			runningSince: undefined,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * The shop pages of a source's current lots, for the product_pages crawl:
 * a lot that left the collection grid is still read (and archived by the
 * 3-strike rule once its page is gone) instead of vanishing silently.
 * Bounded to the scrape cap; the crawler orders grid links first anyway.
 */
export const listCurrentLotUrls = internalQuery({
	args: { roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const lots = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_status_and_last_seen_at", (q) =>
				q.eq("roasterId", args.roasterId).eq("status", "current")
			)
			.order("desc")
			.take(MAX_PRODUCT_PAGES);
		return lots.flatMap((lot) => (lot.url === undefined ? [] : [lot.url]));
	},
	returns: v.array(v.string()),
});

/**
 * Operator tool: make a source's next successful crawl a baseline again.
 * Any change that expands a source's coverage (pagination, better html
 * extraction, a raised page cap) would otherwise fire a "new" Drop event for
 * every product in the newly visible tail. Run this before that crawl lands.
 */
export const rebaselineSource = internalMutation({
	args: { crawlSourceId: v.id("crawlSources") },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.crawlSourceId, { lastSuccessAt: undefined });
		return null;
	},
	returns: v.null(),
});

/**
 * Operator tool: switch a source's mode (ADR-0006). Clears the failure
 * streak so the next crawl judges the new mode on its own (#25). The
 * crawler's detectSourceMode runs the probe and lands here.
 */
export const setSourceMode = internalMutation({
	args: {
		crawlSourceId: v.id("crawlSources"),
		mode: sourceModeValidator,
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.crawlSourceId, {
			consecutiveFailures: 0,
			health: "watching",
			mode: args.mode,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * The crawler found the feed on a different host than the roaster row names
 * (apex 404, `www.` answered). Move the row so later crawls skip the 404 and
 * the market check lands on the shop that actually serves the feed.
 */
export const recordFeedOrigin = internalMutation({
	args: { roasterId: v.id("roasters"), websiteUrl: v.string() },
	handler: async (ctx, args) => {
		const roaster = await ctx.db.get(args.roasterId);
		if (roaster === null || roaster.websiteUrl === args.websiteUrl) {
			return null;
		}
		const path = new URL(roaster.productPageUrl).pathname;
		await ctx.db.patch(args.roasterId, {
			productPageUrl: `${args.websiteUrl}${path}`,
			websiteUrl: args.websiteUrl,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Operator tool: remove a roaster's products whose externalId starts with
 * `externalIdPrefix`, with their variants and events. For rows a retired
 * source mode left behind (html-mode Passenger rows keyed by product URL)
 * that no later crawl will ever name again. Logged lots archive instead,
 * as in the non-lot purge. Batched; reschedules while a full batch returns.
 */
export const purgeProductsByPrefix = internalMutation({
	args: { externalIdPrefix: v.string(), roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const docs = await ctx.db
			.query("products")
			.withIndex("by_roaster_and_external_id", (q) =>
				q
					.eq("roasterId", args.roasterId)
					.gte("externalId", args.externalIdPrefix)
					.lt("externalId", `${args.externalIdPrefix}\uFFFF`)
			)
			.take(PRUNE_BATCH);
		await Promise.all(docs.map((doc) => purgeNonLot(ctx, doc)));
		if (docs.length === PRUNE_BATCH) {
			await ctx.scheduler.runAfter(
				0,
				internal.crawlSources.purgeProductsByPrefix,
				args
			);
		}
		return null;
	},
	returns: v.null(),
});

/**
 * Operator tool: delete a roaster's Drop events, optionally only those
 * detected at or after `since`. Pairs with rebaselineSource when a crawl
 * defect (e.g. a feed served in the wrong currency) has already emitted
 * events that never happened. Batched; reschedules while a full batch keeps
 * coming back.
 */
export const purgeRoasterEvents = internalMutation({
	args: { roasterId: v.id("roasters"), since: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const since = args.since ?? 0;
		const events = await ctx.db
			.query("dropEvents")
			.withIndex("by_roaster_and_detected_at", (q) =>
				q.eq("roasterId", args.roasterId).gte("detectedAt", since)
			)
			.take(PRUNE_BATCH);
		await Promise.all(events.map((event) => deleteDropEvent(ctx, event._id)));
		if (events.length === PRUNE_BATCH) {
			await ctx.scheduler.runAfter(
				0,
				internal.crawlSources.purgeRoasterEvents,
				args
			);
		}
		return null;
	},
	returns: v.null(),
});

/**
 * Claim a source and hand it to the crawler action. The one code path every
 * crawl starts from: the scheduler tick, the operator's crawlNow and a
 * user's Check now (#34). The claim (runningSince stamped, due date pushed
 * to now + cadence) keeps a concurrent tick from double-running the source;
 * finalizeCrawl clears the stamp and sets the real next due date.
 */
export const startCrawl = async (
	ctx: MutationCtx,
	source: Doc<"crawlSources">,
	now: number
): Promise<void> => {
	await ctx.db.patch(source._id, {
		nextCrawlDueAt: now + source.cadenceMinutes * 60_000,
		runningSince: now,
	});
	await ctx.scheduler.runAfter(0, internal.crawler.crawlSource, {
		crawlSourceId: source._id,
	});
};

/**
 * Scheduler tick: claim every source whose crawl is due and hand it to the
 * crawler action. A source still running from a Check now is skipped; its
 * finalizeCrawl sets the next due date.
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
			due
				.filter((source) => !isCrawlRunning(source, now))
				.map((source) => startCrawl(ctx, source, now))
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
