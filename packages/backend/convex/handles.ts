// User handles (ADR-0011): every user is addressed at /$handle, derived from
// the Google display name at first sign-in, editable in /settings/account.
// A retired handle resolves through the handleRedirects table (ADR-0011
// amendment), so an old /$user link still lands, until another user takes
// the handle: retired handles are not reserved, and the current-handle
// lookup wins, so whoever hands a handle out drops the dead redirect row.

import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { RESERVED_ROUTES } from "./constants";
import {
	assertSuffixScanBounded,
	nextFreeSuffix,
	SUFFIX_SCAN_LIMIT,
	suffixRangeEnd,
} from "./suffix";

/** Handles are lowercase letters, digits and dashes, no dashes at the ends. */
export const isValidHandle = (handle: string): boolean =>
	/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(handle) && handle.length <= 40;

/** The list of reserved names applies to handles and to roaster slugs. */
export const isReserved = (handle: string): boolean =>
	RESERVED_ROUTES.includes(handle);

/** Turn any display name into a handle-shaped string; "" when nothing maps. */
export const slugifyName = (name: string): string =>
	name
		.toLowerCase()
		.normalize("NFKD")
		// accents off: é -> e
		.replaceAll(/[\u0300-\u036F]/gu, "")
		.replaceAll(/[^a-z0-9]+/gu, "-")
		.replaceAll(/^-+|-+$/gu, "")
		.slice(0, 40)
		.replaceAll(/-+$/gu, "");

/** First candidate: the slugified display name, or `taster` when empty. */
export const deriveBaseHandle = (name?: string): string => {
	const slug = name === undefined ? "" : slugifyName(name);
	return isReserved(slug) || slug === "" ? "taster" : slug;
};

/** Delete the redirect row for `handle`, if one exists. */
export const dropRedirect = async (
	ctx: MutationCtx,
	handle: string
): Promise<void> => {
	const redirect = await ctx.db
		.query("handleRedirects")
		.withIndex("by_handle", (q) => q.eq("handle", handle))
		.unique();
	if (redirect !== null) {
		await ctx.db.delete("handleRedirects", redirect._id);
	}
};

/**
 * The by_handle index answers what is taken with one bounded range scan
 * over `base` and its `base-<n>` family (suffix.ts).
 */
const nextFreeHandle = async (
	ctx: MutationCtx,
	base: string
): Promise<string> => {
	const nearby = await ctx.db
		.query("users")
		.withIndex("by_handle", (q) =>
			q.gte("handle", base).lt("handle", suffixRangeEnd(base))
		)
		.take(SUFFIX_SCAN_LIMIT);
	assertSuffixScanBounded(nearby, base);
	return nextFreeSuffix(
		base,
		nearby.flatMap((user) => (user.handle === undefined ? [] : [user.handle])),
		isReserved(base)
	);
};

/**
 * Claim the handle a new sign-in gets: the base when free, otherwise the
 * first free numeric suffix. Handles are checked against the reserved
 * routes here, not trusted, for the same reason roaster slugs are. A
 * redirect row for the claimed handle is removed: the handle is live again
 * and the row could never fire.
 */
export const claimHandle = async (
	ctx: MutationCtx,
	base: string
): Promise<string> => {
	const handle = await nextFreeHandle(ctx, base);
	await dropRedirect(ctx, handle);
	return handle;
};

/**
 * Resolve a handle a user no longer holds to their document, through the
 * handleRedirects table (ADR-0011 amendment). One indexed read.
 */
export const redirectTarget = async (
	ctx: QueryCtx | MutationCtx,
	handle: string
): Promise<Doc<"users"> | null> => {
	const redirect = await ctx.db
		.query("handleRedirects")
		.withIndex("by_handle", (q) => q.eq("handle", handle))
		.unique();
	if (redirect === null) {
		return null;
	}
	return ctx.db.get(redirect.userId);
};
