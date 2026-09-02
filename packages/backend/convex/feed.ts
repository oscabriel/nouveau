import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { ALERT_WORTHY_TYPES, MAX_WATCHES_PER_USER } from "./constants";
import { crawlStatusValidator, getCrawlStatus } from "./health";
import type { CrawlStatus } from "./health";
import { optionalUserId } from "./identity";

/** How many events a single feed query returns, before the client loads more. */
export const FEED_LIMIT = 30;

/** Per-roaster slice of the personalized feed merge. */
const PER_ROASTER_LIMIT = 10;

/** Card shape for feed rendering; the lot links to the roaster's own shop. */
const feedCard = {
	detectedAt: v.number(),
	eventId: v.id("dropEvents"),
	lotUrl: v.string(),
	newPriceCents: v.union(v.number(), v.null()),
	oldPriceCents: v.union(v.number(), v.null()),
	productId: v.id("products"),
	productName: v.string(),
	roasterName: v.string(),
	roasterSlug: v.string(),
	type: v.union(
		v.literal("new"),
		v.literal("back_in_stock"),
		v.literal("price_drop")
	),
	variantName: v.union(v.string(), v.null()),
};

type AlertType = (typeof ALERT_WORTHY_TYPES)[number];

interface FeedCard {
	detectedAt: number;
	eventId: Id<"dropEvents">;
	lotUrl: string;
	newPriceCents: number | null;
	oldPriceCents: number | null;
	productName: string;
	productId: Id<"products">;
	roasterName: string;
	roasterSlug: string;
	type: AlertType;
	variantName: string | null;
}

const isAlertWorthy = (
	event: Doc<"dropEvents">
): event is Doc<"dropEvents"> & { type: AlertType } =>
	(ALERT_WORTHY_TYPES as readonly string[]).includes(event.type);

/** Hydrate a drop event into a card; null when its product/roaster vanished. */
const toCard = async (
	ctx: QueryCtx,
	event: Doc<"dropEvents"> & { type: AlertType }
): Promise<FeedCard | null> => {
	const product = await ctx.db.get(event.productId);
	const roaster = await ctx.db.get(event.roasterId);
	if (product === null || roaster === null) {
		return null;
	}
	const variant = event.variantId ? await ctx.db.get(event.variantId) : null;
	return {
		detectedAt: event.detectedAt,
		eventId: event._id,
		lotUrl: `${roaster.websiteUrl}/products/${product.handle}`,
		newPriceCents: event.newPriceCents ?? null,
		oldPriceCents: event.oldPriceCents ?? null,
		productId: product._id,
		productName: product.name,
		roasterName: roaster.name,
		roasterSlug: roaster.slug,
		type: event.type,
		variantName: variant?.name ?? null,
	};
};

const nonNull = <T>(value: T | null): value is T => value !== null;

/** Merge already-descending-sorted lists into one descending list. */
const mergeDesc = <T>(lists: T[][], by: (item: T) => number): T[] => {
	const streams = lists.map((list) => ({ cursor: 0, list }));
	const total = lists.reduce((sum, list) => sum + list.length, 0);
	const merged: T[] = [];
	for (let pushed = 0; pushed < total; pushed += 1) {
		let best: T | undefined;
		let bestStream: { cursor: number; list: T[] } | null = null;
		for (const stream of streams) {
			const item = stream.list[stream.cursor];
			if (item === undefined) {
				continue;
			}
			if (best === undefined || by(item) > by(best)) {
				best = item;
				bestStream = stream;
			}
		}
		if (best === undefined || bestStream === null) {
			return merged;
		}
		merged.push(best);
		bestStream.cursor += 1;
	}
	return merged;
};

/**
 * Global live feed (build spec §8.1): recent alert-worthy drops across all
 * roasters, newest first. One desc scan per alert-worthy type, merged.
 */
export const globalFeed = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? FEED_LIMIT, 100);
		const perType = await Promise.all(
			ALERT_WORTHY_TYPES.map((type) =>
				ctx.db
					.query("dropEvents")
					.withIndex("by_type_and_detected_at", (q) => q.eq("type", type))
					.order("desc")
					.take(limit)
			)
		);
		const merged = mergeDesc(perType, (event) => event.detectedAt);
		const cards = await Promise.all(
			merged.filter(isAlertWorthy).map((e) => toCard(ctx, e))
		);
		return cards.filter(nonNull).slice(0, limit);
	},
	returns: v.array(v.object(feedCard)),
});

/** Drop history for one roaster page: alert-worthy events, newest first. */
export const roasterFeed = query({
	args: { limit: v.optional(v.number()), roasterId: v.id("roasters") },
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? FEED_LIMIT, 100);
		const events = await ctx.db
			.query("dropEvents")
			.withIndex("by_roaster_and_detected_at", (q) =>
				q.eq("roasterId", args.roasterId)
			)
			.order("desc")
			.take(limit * 2);
		const cards = await Promise.all(
			events.filter(isAlertWorthy).map((e) => toCard(ctx, e))
		);
		return cards.filter(nonNull).slice(0, limit);
	},
	returns: v.array(v.object(feedCard)),
});

/**
 * Personalized feed (build spec §8.1): alert-worthy events from watched
 * roasters only, with the delivery footer status from the notifications
 * ledger. Signed-out callers get an empty feed.
 */
export const personalizedFeed = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const limit = Math.min(args.limit ?? FEED_LIMIT, 100);
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return [];
		}
		const watches = await ctx.db
			.query("watches")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.take(MAX_WATCHES_PER_USER);
		const perRoaster = await Promise.all(
			watches.map((watch) =>
				ctx.db
					.query("dropEvents")
					.withIndex("by_roaster_and_detected_at", (q) =>
						q.eq("roasterId", watch.roasterId)
					)
					.order("desc")
					.take(PER_ROASTER_LIMIT)
			)
		);
		const events = mergeDesc(perRoaster, (event) => event.detectedAt)
			.filter(isAlertWorthy)
			.slice(0, limit);
		const cards = await Promise.all(
			events.map(async (event) => {
				const card = await toCard(ctx, event);
				if (card === null) {
					return null;
				}
				const notification = await ctx.db
					.query("notifications")
					.withIndex("by_user_and_drop_event", (q) =>
						q.eq("userId", userId).eq("dropEventId", event._id)
					)
					.first();
				return {
					...card,
					deliveryStatus: notification?.deliveryStatus ?? null,
				};
			})
		);
		return cards.filter(nonNull);
	},
	returns: v.array(
		v.object({
			...feedCard,
			deliveryStatus: v.union(
				v.literal("pending"),
				v.literal("sent"),
				v.literal("delivered"),
				v.literal("failed"),
				v.null()
			),
		})
	),
});

/**
 * Unhealthy-banner input (build spec §8.1): watched roasters whose crawl
 * source is not healthy. One quiet line above the personalized feed.
 */
export const unhealthyWatches = query({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return [];
		}
		const watches = await ctx.db
			.query("watches")
			.withIndex("by_user_id", (q) => q.eq("userId", userId))
			.take(MAX_WATCHES_PER_USER);
		const rows = await Promise.all(
			watches.map(async (watch) => {
				const roaster = await ctx.db.get(watch.roasterId);
				if (roaster === null) {
					return null;
				}
				return {
					name: roaster.name,
					status: await getCrawlStatus(ctx, watch.roasterId),
				};
			})
		);
		return rows.filter(
			(row): row is { name: string; status: CrawlStatus } =>
				row !== null && row.status.health !== "watching"
		);
	},
	returns: v.array(
		v.object({
			name: v.string(),
			status: crawlStatusValidator,
		})
	),
});
