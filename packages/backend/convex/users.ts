import { vGoogleProfile } from "@convex-dev/auth/providers/oauth/google";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import { claimHandle, deriveBaseHandle } from "./handles";
import { optionalUserId } from "./identity";

/**
 * Create the user row for a first-time Google sign-in and return its id. The
 * auth core owns its own account tables; this table is ours and holds only
 * what the product reads back.
 */
export const createUser = internalMutation({
	args: {
		profile: vGoogleProfile,
		provider: v.literal("google"),
		providerAccountId: v.string(),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("users")
			.withIndex("by_provider_account_id", (q) =>
				q.eq("providerAccountId", args.providerAccountId)
			)
			.unique();
		if (existing !== null) {
			// Users created before handles existed get theirs at the first
			// sign-in after the field landed.
			if (existing.handle === undefined) {
				await ctx.db.patch(existing._id, {
					handle: await claimHandle(ctx, deriveBaseHandle(existing.name)),
				});
			}
			return existing._id;
		}
		const userId = await ctx.db.insert("users", {
			email: args.profile.email,
			emailVerified: args.profile.emailVerified,
			handle: await claimHandle(ctx, deriveBaseHandle(args.profile.name)),
			imageUrl: args.profile.picture,
			name: args.profile.name,
			providerAccountId: args.providerAccountId,
		});
		return userId;
	},
	returns: v.id("users"),
});

/**
 * Backfill a row that predates handles (ADR-0011, ADR-0012 amendment). The
 * sign-in derivation rides createUser, which fires for new sign-ins only,
 * so a user who signed in before the field existed would otherwise never
 * get one. The app shell calls this on first load after sign-in; it claims
 * the handle with the same derivation and suffix rules, and does nothing
 * for signed-out callers and rows that already carry a handle.
 */
export const ensureMyHandle = mutation({
	args: {},
	handler: async (ctx) => {
		const userId = await optionalUserId(ctx);
		if (userId === null) {
			return null;
		}
		const user = await ctx.db.get(userId);
		if (user === null || user.handle !== undefined) {
			return null;
		}
		const handle = await claimHandle(ctx, deriveBaseHandle(user.name));
		await ctx.db.patch(userId, { handle });
		return handle;
	},
	returns: v.union(v.null(), v.string()),
});

export const getCurrentUser = query({
	args: {},
	handler: async (ctx) => {
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
		// The shared alert inbox lives on the singleton appConfig row, not on
		// the user (AgentMail free plan: one product inbox for everyone).
		const config = await ctx.db.query("appConfig").unique();
		return {
			alertInboxAddress: config?.alertInbox?.address,
			// The /$user address (ADR-0011); absent on rows predating the field.
			handle: user.handle,
			id: user._id,
			imageUrl: user.imageUrl,
			name: user.name,
		};
	},
	returns: v.union(
		v.null(),
		v.object({
			alertInboxAddress: v.optional(v.string()),
			handle: v.optional(v.string()),
			id: v.id("users"),
			imageUrl: v.optional(v.string()),
			name: v.optional(v.string()),
		})
	),
});
