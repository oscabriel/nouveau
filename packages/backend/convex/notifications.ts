// Alert email fanout and the shared AgentMail alert inbox (build order step 4).
//
// Every Drop event fans out to its roaster's unmuted watchers: one
// notifications-ledger row per (user, event) doubles as the one-email-per-
// event dedup guard (build spec §5), and the row's outboundId links to the
// AgentMail component's reactive delivery lifecycle. AgentMail's free plan
// allows only 3 inboxes total, so alerts send from one shared product inbox
// to each watcher's email (§8.3 as amended): replies from all users land in
// that one inbox, threaded per conversation.

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
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
	ALERT_WORTHY_TYPES,
	INBOX_CLAIM_TTL_MS,
	MAX_ALERT_RECIPIENTS_PER_EVENT,
} from "./constants";

const agentmail = new AgentMail(components.agentmail);

const ALERT_INBOX_DISPLAY_NAME = "Nouveau Alerts";
// Usernames on the shared @agentmail.to domain are unique, so pinning it
// makes the from-address readable instead of a random generated one. The
// inbox can be pre-created in the console to lock the name; provisioning
// adopts it in that case (see findInboxByUsername).
const ALERT_INBOX_USERNAME = "nouveau-alerts";
const ALERT_INBOX_ADDRESS = `${ALERT_INBOX_USERNAME}@agentmail.to`;

export type AlertType = (typeof ALERT_WORTHY_TYPES)[number];

export const isAlertWorthy = (
	type: Doc<"dropEvents">["type"]
): type is AlertType =>
	(ALERT_WORTHY_TYPES as readonly string[]).includes(type);

/** "$3500" -> "$35"; whole dollars stay whole ("$35", not "$35.00"). */
export const formatPrice = (cents: number): string =>
	`$${(cents / 100).toFixed(2).replace(/\.00$/u, "")}`;

export interface AlertEmail {
	// The lot's address pair (ADR-0011): the email links /roaster/$slug/$handle.
	lotHandle: string;
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
		// The app's lot page (ADR-0011); the page links out to the shop.
		`${metaPrefix}See the lot: ${appLink(
			input.siteOrigin,
			`/roaster/${input.roasterSlug}/${input.lotHandle}`
		)}`,
		"",
		`Roaster page: ${appLink(input.siteOrigin, `/roaster/${input.roasterSlug}`)}`,
		"",
		// The locked §8.2 footer: "Mute this roaster · Alert settings". Mute
		// lives on /settings/alerts (ADR-0011), which lists every watch with
		// its mute toggle.
		`You're watching ${roasterName}. Mute this roaster: ${appLink(input.siteOrigin, "/settings/alerts")}`,
		`Alert settings: ${appLink(input.siteOrigin, "/settings/alerts")}`,
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
	// Alerts send from the shared product inbox; without it there is nowhere
	// to send from. Lazy-provision it and skip this event's sends — the claim
	// guard makes repeated schedules (and the fanout on the next event) safe.
	const config = await ctx.db.query("appConfig").unique();
	if (config?.alertInbox === undefined) {
		await ctx.scheduler.runAfter(
			0,
			internal.notifications.provisionAlertInbox,
			{}
		);
		return;
	}
	const { inboxId } = config.alertInbox;
	const watches = await ctx.db
		.query("watches")
		.withIndex("by_roaster_id", (q) => q.eq("roasterId", event.roasterId))
		.take(MAX_ALERT_RECIPIENTS_PER_EVENT);

	await Promise.all(
		watches
			.filter((watch) => !watch.muted)
			.map(async (watch) => {
				const user = await ctx.db.get(watch.userId);
				// A user without an email gets no alert rather than a broken send.
				if (user === null || user.email === undefined) {
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
					lotHandle: product.handle,
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
					const outboundId = await agentmail.sendMessage(ctx, inboxId, {
						subject: alertSubject(emailInput),
						text: alertBody(emailInput),
						to: user.email,
					});
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
 * Operator entry: force a fresh send for an already-notified event. Deletes
 * the ledger rows that act as the one-email-per-event guard (all watchers,
 * or just `userId`), then re-runs the fanout so AgentMail gets a new
 * outbound. Dev/prod smoke test for the email path; never called by app code.
 */
export const resendEvent = internalMutation({
	args: { eventId: v.id("dropEvents"), userId: v.optional(v.id("users")) },
	handler: async (ctx, args) => {
		const rows = await ctx.db
			.query("notifications")
			.withIndex("by_drop_event_id", (q) => q.eq("dropEventId", args.eventId))
			.collect();
		const targets =
			args.userId === undefined
				? rows
				: rows.filter((row) => row.userId === args.userId);
		await Promise.all(targets.map((row) => ctx.db.delete(row._id)));
		// With a userId, only that user's row is gone, so the fanout's dedupe
		// check skips every other watcher and sends to them alone.
		await notifyWatchersOfEvent(ctx, args.eventId);
		return { cleared: targets.length };
	},
	returns: v.object({ cleared: v.number() }),
});

/**
 * Atomically claim the right to provision the shared alert inbox. Any code
 * path may schedule provisionAlertInbox (fanout with no inbox yet, sign-ins
 * via ensureAlertInbox), and actions don't serialize, so the exclusivity
 * check lives here in a mutation: the transaction system orders concurrent
 * claims and only the winner returns won: true.
 *
 * The claim lives on the singleton appConfig row, creating it when absent; a
 * claim older than INBOX_CLAIM_TTL_MS counts as stale (its action crashed
 * before the release mutation) and can be retaken.
 */
export const claimInboxProvisioning = internalMutation({
	args: {},
	handler: async (ctx) => {
		const config = await ctx.db.query("appConfig").unique();
		if (config?.alertInbox !== undefined) {
			return { won: false };
		}
		const now = Date.now();
		if (config === null) {
			await ctx.db.insert("appConfig", { alertInboxClaimedAt: now });
			return { won: true };
		}
		const claimedAt = config.alertInboxClaimedAt;
		if (claimedAt !== undefined && now - claimedAt < INBOX_CLAIM_TTL_MS) {
			return { won: false };
		}
		await ctx.db.patch(config._id, { alertInboxClaimedAt: now });
		return { won: true };
	},
	returns: v.object({ won: v.boolean() }),
});

/** Give up an unfulfilled provisioning claim so a retry can take it. */
export const releaseInboxProvisioningClaim = internalMutation({
	args: {},
	handler: async (ctx) => {
		const config = await ctx.db.query("appConfig").unique();
		if (config !== null) {
			await ctx.db.patch(config._id, { alertInboxClaimedAt: undefined });
		}
		return null;
	},
	returns: v.null(),
});

/** Store the provisioned shared inbox on the config row and clear the claim. */
export const setAlertInbox = internalMutation({
	args: { inbox: v.object({ address: v.string(), inboxId: v.string() }) },
	handler: async (ctx, args) => {
		const config = await ctx.db.query("appConfig").unique();
		await (config === null
			? ctx.db.insert("appConfig", { alertInbox: args.inbox })
			: ctx.db.patch(config._id, {
					alertInbox: args.inbox,
					alertInboxClaimedAt: undefined,
				}));
		return null;
	},
	returns: v.null(),
});

/**
 * Find the org's inbox with the pinned address, paging through the list
 * (newest first). Returns null when no inbox of ours has that address —
 * meaning the username is owned by a different organization.
 */
const findInboxByUsername = async (ctx: ActionCtx): Promise<unknown | null> => {
	let pageToken: string | undefined;
	for (;;) {
		// Pagination is inherently sequential: each request needs the next
		// page token from the previous response.
		// eslint-disable-next-line no-await-in-loop
		const page = (await agentmail.listInboxes(ctx, {
			limit: 100,
			pageToken,
		})) as {
			inboxes?: { email?: unknown; inbox_id?: unknown }[];
			next_page_token?: string;
		};
		for (const inbox of page.inboxes ?? []) {
			if (inbox.email === ALERT_INBOX_ADDRESS) {
				return inbox;
			}
		}
		pageToken = page.next_page_token;
		if (pageToken === undefined || pageToken === "") {
			return null;
		}
	}
};

/**
 * Create the shared Nouveau alert inbox once (§8.3 as amended). Scheduled by
 * the fanout when the inbox is missing and by ensureAlertInbox on sign-ins;
 * the claim mutation decides which run actually calls AgentMail, and the
 * loser returns without doing anything.
 *
 * When the pinned username already exists — pre-created in the console to
 * lock the name, or owned by another organization — the inbox list decides
 * which: our own inbox is adopted, a foreign one fails the run.
 */
export const provisionAlertInbox = internalAction({
	args: {},
	handler: async (ctx) => {
		const claim = await ctx.runMutation(
			internal.notifications.claimInboxProvisioning,
			{}
		);
		if (!claim.won) {
			return null;
		}
		let inbox: unknown;
		try {
			try {
				inbox = await agentmail.createInbox(ctx, {
					displayName: ALERT_INBOX_DISPLAY_NAME,
					username: ALERT_INBOX_USERNAME,
				});
			} catch (createError) {
				const existing = await findInboxByUsername(ctx);
				if (existing === null) {
					throw createError;
				}
				inbox = existing;
			}
		} catch (error) {
			// The remote calls failed without an inbox we can adopt, so release
			// the claim and the next trigger retries immediately instead of
			// waiting out the TTL.
			await ctx.runMutation(
				internal.notifications.releaseInboxProvisioningClaim,
				{}
			);
			throw error;
		}
		// From here the inbox exists at AgentMail. A failure below is left to
		// surface with the claim intact: releasing would only make the retry
		// create a second inbox we can't tie back to this one.
		// createInbox returns the AgentMail inbox object (snake_case fields).
		const raw = inbox as { email?: unknown; inbox_id?: unknown } | null;
		const inboxId = typeof raw?.inbox_id === "string" ? raw.inbox_id : null;
		const address = typeof raw?.email === "string" ? raw.email : null;
		if (inboxId === null || address === null) {
			throw new Error(
				`AgentMail inbox response missing inbox_id/email: ${JSON.stringify(inbox)}`
			);
		}
		await ctx.runMutation(internal.notifications.setAlertInbox, {
			inbox: { address, inboxId },
		});
		return null;
	},
	returns: v.null(),
});

/**
 * Public lazy entry, called from the app shell on sign-ins: provision the
 * shared alert inbox if it doesn't exist yet. Idempotent: a repeated or
 * concurrent schedule loses the provisioning claim and does nothing.
 */
export const ensureAlertInbox = mutation({
	args: {},
	handler: async (ctx) => {
		const config = await ctx.db.query("appConfig").unique();
		if (config?.alertInbox !== undefined) {
			return null;
		}
		await ctx.scheduler.runAfter(
			0,
			internal.notifications.provisionAlertInbox,
			{}
		);
		return null;
	},
	returns: v.null(),
});
