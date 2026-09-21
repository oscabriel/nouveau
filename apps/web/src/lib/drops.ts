import type { api } from "@nouveau/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

/** One row of the global drop feed, as `api.feed.globalFeed` returns it. */
export type DropRow = FunctionReturnType<typeof api.feed.globalFeed>[number];

export const DROP_TYPE_LABEL = {
	back_in_stock: "Back in stock",
	new: "New",
	price_drop: "Price drop",
} as const;

export type DropType = keyof typeof DROP_TYPE_LABEL;

/**
 * Shopify's CDN resizes on request (`?width=`); other hosts get the original.
 * Keeps 50 hover thumbnails from pulling 50 full-size product photos.
 */
export const thumbUrl = (url: string, width: number): string => {
	try {
		const parsed = new URL(url);
		if (parsed.hostname.endsWith("cdn.shopify.com")) {
			parsed.searchParams.set("width", String(width));
			return parsed.toString();
		}
		return url;
	} catch {
		return url;
	}
};

/**
 * `MM.DD`, tabular; the release date as the crawler saw it. The year is
 * implied: the tables this feeds list the recent drops (ADR-0014).
 */
export const formatDropDate = (timestamp: number): string => {
	const date = new Date(timestamp);
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${month}.${day}`;
};

/** First `count` rows that carry an image, one per lot, newest first. */
export const latestWithImages = (rows: DropRow[], count: number): DropRow[] => {
	const seen = new Set<string>();
	const picked: DropRow[] = [];
	for (const row of rows) {
		if (row.imageUrl === null || seen.has(row.productId)) {
			continue;
		}
		seen.add(row.productId);
		picked.push(row);
		if (picked.length === count) {
			break;
		}
	}
	return picked;
};

/** `count` random rows with images, one per lot; Fisher-Yates on a copy. */
export const shuffleWithImages = (
	rows: DropRow[],
	count: number
): DropRow[] => {
	const pool = latestWithImages(rows, rows.length);
	for (let i = pool.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		const a = pool[i];
		const b = pool[j];
		if (a !== undefined && b !== undefined) {
			pool[i] = b;
			pool[j] = a;
		}
	}
	return pool.slice(0, count);
};
