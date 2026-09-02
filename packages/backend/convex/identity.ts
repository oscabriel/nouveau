import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/**
 * Resolve the signed-in caller to our users row, or throw. Identity comes
 * from the session token, never from arguments.
 *
 * Deviation from convex-guidelines ("don't key on identity.subject alone"):
 * that rule targets third-party OIDC providers whose subject is opaque.
 * Convex Auth is the only issuer here and sets subject to the users row id
 * created by its createUser callback. normalizeId + db.get below reject any
 * subject that isn't a real users id, so a foreign token can't impersonate.
 */
export const requireUserId = async (
	ctx: QueryCtx | MutationCtx
): Promise<Id<"users">> => {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		throw new Error("Sign in required");
	}
	const userId = ctx.db.normalizeId("users", identity.subject);
	if (userId === null) {
		throw new Error("Unknown user");
	}
	const user = await ctx.db.get("users", userId);
	if (user === null) {
		throw new Error("Unknown user");
	}
	return userId;
};

/** Like requireUserId but returns null instead of throwing when signed out. */
export const optionalUserId = async (
	ctx: QueryCtx | MutationCtx
): Promise<Id<"users"> | null> => {
	const identity = await ctx.auth.getUserIdentity();
	if (identity === null) {
		return null;
	}
	const userId = ctx.db.normalizeId("users", identity.subject);
	if (userId === null) {
		return null;
	}
	const user = await ctx.db.get("users", userId);
	if (user === null) {
		return null;
	}
	return userId;
};
