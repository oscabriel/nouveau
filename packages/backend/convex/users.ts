import { vGoogleProfile } from "@convex-dev/auth/providers/oauth/google";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";

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
			return existing._id;
		}
		const userId = await ctx.db.insert("users", {
			email: args.profile.email,
			emailVerified: args.profile.emailVerified,
			imageUrl: args.profile.picture,
			name: args.profile.name,
			providerAccountId: args.providerAccountId,
		});
		// Provision the per-user AgentMail alert inbox (§8.3). At-least-once:
		// the provisioning action re-checks the user before creating anything.
		await ctx.scheduler.runAfter(0, internal.notifications.provisionInbox, {
			userId,
		});
		return userId;
	},
	returns: v.id("users"),
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
		return { imageUrl: user.imageUrl, name: user.name };
	},
});
