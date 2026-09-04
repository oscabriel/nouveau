// Alert email fanout and per-user AgentMail inboxes (build order step 4).
//
// Every Drop event fans out to its roaster's unmuted watchers: one
// notifications-ledger row per (user, event) doubles as the one-email-per-
// event dedup guard (build spec §5), and the row's outboundId links to the
// AgentMail component's reactive delivery lifecycle. Alerts are sent from
// the user's own AgentMail inbox (created after signup, §8.3) so replies
// thread into a mailbox the user already controls.

import { AgentMail } from "@agentmail/convex";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	env,
	internalAction,
	internalMutation,
	mutation,
} from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
	ALERT_WORTHY_TYPES,
	INBOX_CLAIM_TTL_MS,
	MAX_ALERT_RECIPIENTS_PER_EVENT,
} from "./constants";
import { requireUserId } from "./identity";

const agentmail = new AgentMail(components.agentmail);

export type AlertType = (typeof ALERT_WORTHY_TYPES)[number];

export const isAlertWorthy = (
	type: Doc<"dropEvents">["type"]
): type is AlertType =>
	(ALERT_WORTHY_TYPES as readonly string[]).includes(type);

/** "$3500" -> "$35"; whole dollars stay whole ("$35", not "$35.00"). */
export const formatPrice = (cents: number): string =>
	`$${(cents / 100).toFixed(2).replace(/\.00$/u, "")}`;

export interface AlertEmail {
	lotUrl: string;
	newPriceCents: number | null;
	oldPriceCents: number | null;
	productName: string;
	roasterName: string;
	roasterSlug: string;
	/** App origin for Nouveau links; null renders paths only (dev fallback). */
	siteOrigin: string | null;
	summary: string | null;
	type: AlertType;
	variantGrams: number | null;
	variantName: string | null;
}

const appLink = (siteOrigin: string | null, path: string): string =>
	siteOrigin === null ? path : `${siteOrigin}${path}`;

/** Subject per build spec §8.2, including the back-in-stock/price-drop variants. */
export const alertSubject = (input: AlertEmail): string => {
	const { newPriceCents, oldPriceCents, productName, roasterName, type } =
		input;
	if (type === "price_drop" && newPriceCents !== null) {
		const from =
			oldPriceCents === null ? "" : `${formatPrice(oldPriceCents)} → `;
		return `Price drop at ${roasterName}: ${from}${formatPrice(newPriceCents)}`;
	}
	const price =
		newPriceCents === null ? "" : ` — ${formatPrice(newPriceCents)}`;
	const lead = type === "back_in_stock" ? "Back at" : "New at";
	return `${lead} ${roasterName}: ${productName}${price}`;
};

/** Plain-text body per the locked §8.2 template skeleton. */
export const alertBody = (input: AlertEmail): string => {
	const { newPriceCents, oldPriceCents, productName, roasterName, type } =
		input;
	const variant =
		input.variantName === null || input.variantName === "Default"
			? ""
			: ` (${input.variantName})`;
	let lead: string;
	if (
		type === "price_drop" &&
		newPriceCents !== null &&
		oldPriceCents !== null
	) {
		lead = `${productName}${variant} dropped from ${formatPrice(oldPriceCents)} to ${formatPrice(newPriceCents)} at ${roasterName}.`;
	} else if (type === "back_in_stock") {
		lead = `${productName}${variant} is back at ${roasterName}.`;
	} else {
		lead = `${roasterName} just dropped ${productName}${variant}.`;
	}
	const meta = [
		input.variantGrams === null ? null : `${input.variantGrams}g`,
		newPriceCents === null ? null : formatPrice(newPriceCents),
	].filter((part) => part !== null);
	const metaPrefix = meta.length === 0 ? "" : `${meta.join(" · ")} · `;
	return [
		lead,
		// The OpenAI tasting-note slot (~200 chars, §8.2); empty until the
		// summary generator lands behind the AI seam.
		...(input.summary === null ? [] : ["", input.summary]),
		"",
		`${metaPrefix}See the lot: ${input.lotUrl}`,
		"",
		`Roaster page: ${appLink(input.siteOrigin, `/roasters/${input.roasterSlug}`)}`,
		"",
		// Alert settings is a stub (§8.2); the mute toggle lives on the
		// watches page, so that is the only footer link until it ships.
		`You're watching ${roasterName}. Mute this roaster: ${appLink(input.siteOrigin, "/watches")}`,
	].join("\n");
};

/**
 * Fan one Drop event out to its roaster's unmuted watchers. Runs in the same
 * transaction that emitted the event, so a rolled-back event can never leave
 * a ledger row (or an email) behind. The ledger row's uniqueness is the
 * one-email-per-event guard, so re-running is safe.
 */
export const notifyWatchersOfEvent = async (
	ctx: MutationCtx,
	eventId: Id<"dropEvents">
): Promise<void> => {
	const event = await ctx.db.get(eventId);
	if (event === null || !isAlertWorthy(event.type)) {
		return;
	}
	// Captured immediately: the type guard narrows event.type here, before
	// the awaits below reset the narrowing.
	const { type } = event;
	const roaster = await ctx.db.get(event.roasterId);
	const product = await ctx.db.get(event.productId);
	if (roaster === null || product === null) {
		return;
	}
	const variant =
		event.variantId === undefined ? null : await ctx.db.get(event.variantId);
	const watches = await ctx.db
		.query("watches")
		.withIndex("by_roaster_id", (q) => q.eq("roasterId", event.roasterId))
		.take(MAX_ALERT_RECIPIENTS_PER_EVENT);

	await Promise.all(
		watches
			.filter((watch) => !watch.muted)
			.map(async (watch) => {
				const user = await ctx.db.get(watch.userId);
				// A user without a provisioned inbox (or email) gets no alert
				// rather than a broken send; ensureInbox covers the gap at signup.
				if (
					user === null ||
					user.email === undefined ||
					user.agentmailInbox === undefined
				) {
					return;
				}
				const existing = await ctx.db
					.query("notifications")
					.withIndex("by_user_and_drop_event", (q) =>
						q.eq("userId", watch.userId).eq("dropEventId", event._id)
					)
					.unique();
				if (existing !== null) {
					return;
				}
				const notificationId = await ctx.db.insert("notifications", {
					deliveryStatus: "pending",
					dropEventId: event._id,
					userId: watch.userId,
				});
				const emailInput = {
					lotUrl: `${roaster.websiteUrl}/products/${product.handle}`,
					newPriceCents: event.newPriceCents ?? null,
					oldPriceCents: event.oldPriceCents ?? null,
					productName: product.name,
					roasterName: roaster.name,
					roasterSlug: roaster.slug,
					siteOrigin: env.SITE_URL ?? null,
					summary: event.aiSummary ?? null,
					type,
					variantGrams: variant?.grams ?? null,
					variantName: variant?.name ?? null,
				};
				try {
					const outboundId = await agentmail.sendMessage(
						ctx,
						user.agentmailInbox.inboxId,
						{
							subject: alertSubject(emailInput),
							text: alertBody(emailInput),
							to: user.email,
						}
					);
					// The ledger keeps "pending"; personalizedFeed reads the live
					// pending → sent → delivered lifecycle from the component via
					// outboundId, so this field stays the pre-send fallback state.
					await ctx.db.patch(notificationId, {
						outboundId,
						sentAt: Date.now(),
					});
				} catch (error) {
					await ctx.db.patch(notificationId, { deliveryStatus: "failed" });
					console.warn(
						`alert enqueue failed for user ${watch.userId}: ${error instanceof Error ? error.message : String(error)}`
					);
				}
			})
	);
};

/** Test + operator entry: fan out one already-emitted Drop event. */
export const fanoutEvent = internalMutation({
	args: { eventId: v.id("dropEvents") },
	handler: async (ctx, args) => {
		await notifyWatchersOfEvent(ctx, args.eventId);
		return null;
	},
	returns: v.null(),
});

/**
 * Atomically claim the right to provision this user's inbox. createUser and
 * ensureInbox can both schedule provisionInbox for a fresh signup, and
 * actions don't serialize, so the exclusivity check lives here in a
 * mutation: the transaction system orders concurrent claims and only the
 * winner returns won: true.
 *
 * A claim older than INBOX_CLAIM_TTL_MS counts as stale (its action crashed
 * before the release mutation) and can be retaken.
 */
export const claimInboxProvisioning = internalMutation({
	args: { userId: v.id("users") },
	handler: async (ctx, args) => {
		const user = await ctx.db.get(args.userId);
		if (user === null || user.agentmailInbox !== undefined) {
			return { name: undefined, won: false };
		}
		const now = Date.now();
		const claimedAt = user.agentmailInboxClaimedAt;
		if (claimedAt !== undefined && now - claimedAt < INBOX_CLAIM_TTL_MS) {
			return { name: undefined, won: false };
		}
		await ctx.db.patch(args.userId, { agentmailInboxClaimedAt: now });
		return { name: user.name, won: true };
	},
	returns: v.object({
		name: v.optional(v.string()),
		won: v.boolean(),
	}),
});

/** Give up an unfulfilled provisioning claim so a retry can take it. */
export const releaseInboxProvisioningClaim = internalMutation({
	args: { userId: v.id("users") },
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, { agentmailInboxClaimedAt: undefined });
		return null;
	},
	returns: v.null(),
});

/** Store a provisioned inbox on the user row and clear the claim. */
export const setAgentmailInbox = internalMutation({
	args: {
		inbox: v.object({ address: v.string(), inboxId: v.string() }),
		userId: v.id("users"),
	},
	handler: async (ctx, args) => {
		await ctx.db.patch(args.userId, {
			agentmailInbox: args.inbox,
			agentmailInboxClaimedAt: undefined,
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Create the user's AgentMail inbox (§8.3). Scheduled by createUser at
 * signup and by ensureInbox for users who predate the feature. The two
 * schedules race on fresh signups, so a claim mutation decides which run
 * actually calls AgentMail; the loser returns without doing anything.
 */
export const provisionInbox = internalAction({
	args: { userId: v.id("users") },
	handler: async (ctx, args) => {
		const claim = await ctx.runMutation(
			internal.notifications.claimInboxProvisioning,
			{ userId: args.userId }
		);
		if (!claim.won) {
			return null;
		}
		try {
			const inbox: unknown = await agentmail.createInbox(
				ctx,
				claim.name === undefined ? {} : { displayName: claim.name }
			);
			// createInbox returns the AgentMail inbox object (snake_case fields).
			const raw = inbox as { email?: unknown; inbox_id?: unknown } | null;
			const inboxId = typeof raw?.inbox_id === "string" ? raw.inbox_id : null;
			const address = typeof raw?.email === "string" ? raw.email : null;
			if (inboxId === null || address === null) {
				throw new Error(
					`AgentMail inbox response missing inbox_id/email: ${JSON.stringify(inbox)}`
				);
			}
			await ctx.runMutation(internal.notifications.setAgentmailInbox, {
				inbox: { address, inboxId },
				userId: args.userId,
			});
		} catch (error) {
			// Release the claim so the next signup or sign-in can retry
			// immediately instead of waiting out the claim TTL.
			await ctx.runMutation(
				internal.notifications.releaseInboxProvisioningClaim,
				{ userId: args.userId }
			);
			throw error;
		}
		return null;
	},
	returns: v.null(),
});

/**
 * Public backfill entry: signed-in users whose row predates step 4 get an
 * inbox provisioned on next sign-in. Idempotent: the provisioning action's
 * claim mutation makes a repeated or concurrent schedule a no-op.
 */
export const ensureInbox = mutation({
	args: {},
	handler: async (ctx) => {
		const userId = await requireUserId(ctx);
		const user = await ctx.db.get(userId);
		if (user === null || user.agentmailInbox !== undefined) {
			return null;
		}
		await ctx.scheduler.runAfter(0, internal.notifications.provisionInbox, {
			userId,
		});
		return null;
	},
	returns: v.null(),
});
