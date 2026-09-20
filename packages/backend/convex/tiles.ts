// The landing's tiles (ADR-0014): the three most recent rated logs whose lot
// has a photo, ordered by log time, with the rating the tile renders as
// stars. Until three such logs exist, recent drops with photos pad the
// slots, so the first rating appears the moment it lands. Shuffle draws
// three from the most recent fifty rated logs with photos, deduped by
// taster, keeping the query bounded.

import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { MAX_TILE_POOL, TILE_COUNT, TILE_SCAN_LIMIT } from "./constants";
import { dropCards, FEED_LIMIT } from "./feed";
import type { FeedCard } from "./feed";

/** One tile: a rated log or, when padding, a recent drop. */
export const tileValidator = v.object({
	// The lot's address pair (ADR-0011): tiles link /roaster/$slug/$handle.
	handle: v.string(),
	id: v.id("products"),
	imageUrl: v.string(),
	kind: v.union(v.literal("log"), v.literal("drop")),
	name: v.string(),
	// Null on a drop tile: only rated-log tiles carry stars.
	rating: v.union(v.number(), v.null()),
	roaster: v.object({ name: v.string(), slug: v.string() }),
});

type Tile = Infer<typeof tileValidator>;

const logTile = (
	log: Doc<"logs">,
	product: Doc<"products">,
	roaster: { name: string; slug: string }
): Tile => ({
	handle: product.handle,
	id: product._id,
	imageUrl: product.imageUrl ?? "",
	kind: "log",
	name: product.name,
	rating: log.rating ?? null,
	roaster,
});

const dropTile = (card: FeedCard): Tile => ({
	handle: card.lotHandle,
	id: card.productId,
	imageUrl: card.imageUrl ?? "",
	kind: "drop",
	name: card.productName,
	rating: null,
	roaster: { name: card.roasterName, slug: card.roasterSlug },
});

/**
 * The most recent rated logs whose lot has a photo, oldest dropped first,
 * capped at MAX_TILE_POOL. The scan stops after TILE_SCAN_LIMIT logs so a
 * young app (mostly unrated, photoless logs) cannot read the whole table.
 */
const ratedPool = async (ctx: QueryCtx): Promise<Doc<"logs">[]> => {
	const pool: Doc<"logs">[] = [];
	const photoless = new Set<Id<"products">>();
	const logs = await ctx.db
		.query("logs")
		.withIndex("by_logged_at")
		.order("desc")
		.take(TILE_SCAN_LIMIT);
	for (const log of logs) {
		if (pool.length >= MAX_TILE_POOL) {
			break;
		}
		if (log.rating === undefined) {
			continue;
		}
		// A lot read once per query; most logs cite the same few lots.
		if (photoless.has(log.productId)) {
			continue;
		}
		// oxlint-disable-next-line no-await-in-loop -- bounded by TILE_SCAN_LIMIT; stops as soon as the pool is full
		const product = await ctx.db.get(log.productId);
		if (product?.imageUrl === undefined) {
			photoless.add(log.productId);
			continue;
		}
		pool.push(log);
	}
	return pool;
};

/** Park–Miller LCG: a seeded PRNG, so a shuffled draw stays stable per seed. */
const seededRandom = (seed: number): (() => number) => {
	let state = Math.abs(Math.trunc(seed)) % 2_147_483_647;
	if (state === 0) {
		state = 1;
	}
	return () => {
		state = (state * 16_807) % 2_147_483_647;
		return (state - 1) / 2_147_483_646;
	};
};

/** `count` distinct items drawn with the seed, deterministic per seed. */
const draw = <T>(items: T[], count: number, seed: number): T[] => {
	if (items.length <= count) {
		return [...items];
	}
	const random = seededRandom(seed);
	const remaining = [...items];
	const picked: T[] = [];
	for (let i = 0; i < count; i += 1) {
		const index = Math.floor(random() * remaining.length);
		const item = remaining[index];
		if (item === undefined) {
			break;
		}
		picked.push(item);
		remaining.splice(index, 1);
	}
	return picked;
};

/**
 * The landing's tiles, public. Without a seed: the newest ratings, one per
 * taster, padded with recent drops. With a seed (the client's Date.now()
 * on the Shuffle click): a seeded draw from the deduped pool. The taster is
 * not named on a tile, so the rows carry no user.
 */
export const ratedTiles = query({
	args: { shuffleSeed: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const pool = await ratedPool(ctx);
		// Newest log per taster: one taster cannot fill all three tiles.
		const seenUsers = new Set<Id<"users">>();
		const deduped = pool.filter((log) => {
			if (seenUsers.has(log.userId)) {
				return false;
			}
			seenUsers.add(log.userId);
			return true;
		});
		const picked =
			args.shuffleSeed === undefined
				? deduped.slice(0, TILE_COUNT)
				: draw(deduped, TILE_COUNT, args.shuffleSeed);
		const hydrated = await Promise.all(
			picked.map(async (log) => {
				const product = await ctx.db.get(log.productId);
				if (product === null || product.imageUrl === undefined) {
					return null;
				}
				const roaster = await ctx.db.get(product.roasterId);
				if (roaster === null) {
					return null;
				}
				return logTile(log, product, {
					name: roaster.name,
					slug: roaster.slug,
				});
			})
		);
		const tiles = hydrated.filter(
			(tile): tile is Exclude<typeof tile, null> => tile !== null
		);
		if (tiles.length < TILE_COUNT) {
			const drops = await dropCards(ctx, FEED_LIMIT);
			const shownLots = new Set(tiles.map((tile) => tile.id));
			for (const card of drops) {
				if (tiles.length >= TILE_COUNT) {
					break;
				}
				if (card.imageUrl === null || shownLots.has(card.productId)) {
					continue;
				}
				shownLots.add(card.productId);
				tiles.push(dropTile(card));
			}
		}
		return tiles;
	},
	returns: v.array(tileValidator),
});
