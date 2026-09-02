/// <reference types="vite/client" />
import agentmailTest from "@agentmail/convex/test";
import { register as registerWorkpool } from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { alertBody, alertSubject, formatPrice } from "./notifications";
import schema from "./schema";
import { asUser } from "./test.helpers";

const jsonResponse = (body: unknown): Response =>
	Response.json(body, { headers: { "content-type": "application/json" } });

const modules = import.meta.glob("./**/*.ts");

// The agentmail package's own test glob finds no "_generated" anchor (it
// ships that dir as .js only), so build the module map here from the real
// package files instead of reusing agentmailTest.modules.
const agentmailModules = import.meta.glob(
	"../node_modules/@agentmail/convex/src/component/**/*.*s"
);

const email = {
	lotUrl: "https://sey.example.com/products/mullugeta",
	newPriceCents: 3500,
	oldPriceCents: null,
	productName: "Ethiopia Mullugeta Muntasha",
	roasterName: "Sey",
	roasterSlug: "sey",
	siteOrigin: "https://nouveau.example.com",
	summary: null,
	variantGrams: 250,
	variantName: "250g",
} as const;

describe("alert email template", () => {
	test("formatPrice keeps whole dollars whole", () => {
		expect(formatPrice(3500)).toBe("$35");
		expect(formatPrice(2750)).toBe("$27.50");
	});

	test("subjects follow the locked §8.2 variants", () => {
		expect(alertSubject({ ...email, type: "new" })).toBe(
			"New at Sey: Ethiopia Mullugeta Muntasha — $35"
		);
		expect(alertSubject({ ...email, type: "back_in_stock" })).toBe(
			"Back at Sey: Ethiopia Mullugeta Muntasha — $35"
		);
		expect(
			alertSubject({
				...email,
				newPriceCents: 2800,
				oldPriceCents: 4000,
				type: "price_drop",
			})
		).toBe("Price drop at Sey: $40 → $28");
	});

	test("body carries lead, summary slot, lot link and mute footer", () => {
		const text = alertBody({
			...email,
			summary: "Washed lot, jasmine and apricot.",
			type: "new",
		});
		expect(text).toContain(
			"Sey just dropped Ethiopia Mullugeta Muntasha (250g)."
		);
		expect(text).toContain("Washed lot, jasmine and apricot.");
		expect(text).toContain(
			"250g · $35 · See the lot: https://sey.example.com/products/mullugeta"
		);
		expect(text).toContain(
			"Roaster page: https://nouveau.example.com/roasters/sey"
		);
		expect(text).toContain(
			"You're watching Sey. Mute this roaster: https://nouveau.example.com/watches"
		);
	});

	test("summary slot is omitted when there is no summary", () => {
		const text = alertBody({ ...email, type: "new" });
		expect(text).not.toContain("Tasting");
		expect(text.split("\n\n").length).toBe(4);
	});

	test("price drop body cites the move", () => {
		const text = alertBody({
			...email,
			newPriceCents: 2800,
			oldPriceCents: 4000,
			type: "price_drop",
		});
		expect(text).toContain(
			"Ethiopia Mullugeta Muntasha (250g) dropped from $40 to $28 at Sey."
		);
		expect(text).toContain("250g · $28 · See the lot");
	});
});

interface FanoutFixture {
	dropEventId: Id<"dropEvents">;
	t: ReturnType<typeof convexTest>;
	userId: Id<"users">;
}

const inbox = { address: "user@agentmail.to", inboxId: "inb_user1" };

const setupFanout = async (
	watch: { muted?: boolean } = {}
): Promise<Omit<FanoutFixture, "roasterId">> => {
	const t = convexTest(schema, modules);
	t.registerComponent("agentmail", agentmailTest.schema, agentmailModules);
	registerWorkpool(t, "agentmail/sendPool");
	registerWorkpool(t, "agentmail/callbackPool");
	const ids = await t.run(async (ctx) => {
		const roaster = await ctx.db.insert("roasters", {
			city: "Brooklyn",
			claimed: false,
			domain: "sey.example.com",
			name: "Sey",
			productPageUrl: "https://sey.example.com/collections/coffee",
			slug: "sey",
			source: "curated",
			state: "NY",
			status: "active",
			websiteUrl: "https://sey.example.com",
		});
		const user = await ctx.db.insert("users", {
			agentmailInbox: inbox,
			email: "watcher@example.com",
			providerAccountId: "google-123",
		});
		const product = await ctx.db.insert("products", {
			externalId: "p1",
			firstSeenAt: 1000,
			handle: "mullugeta",
			lastSeenAt: 1000,
			missedCrawls: 0,
			name: "Ethiopia Mullugeta Muntasha",
			roasterId: roaster,
			status: "current",
		});
		const variant = await ctx.db.insert("productVariants", {
			available: true,
			grams: 250,
			name: "250g",
			priceCents: 3500,
			productId: product,
		});
		await ctx.db.insert("watches", {
			muted: watch.muted ?? false,
			roasterId: roaster,
			userId: user,
		});
		const dropEventId = await ctx.db.insert("dropEvents", {
			detectedAt: 2000,
			newPriceCents: 3500,
			productId: product,
			roasterId: roaster,
			type: "new",
			variantId: variant,
		});
		return { dropEventId, roaster, user };
	});
	return {
		dropEventId: ids.dropEventId,
		t,
		userId: ids.user,
	};
};

describe("alert fanout", () => {
	beforeEach(() => {
		// performSend reads the API key from the deployment env.
		process.env.AGENTMAIL_API_KEY = "test-key";
		vi.useFakeTimers();
	});

	afterEach(() => {
		delete process.env.AGENTMAIL_API_KEY;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	test("a new event enqueues one email and writes the ledger row", async () => {
		const fetchSpy = vi
			.fn()
			.mockResolvedValue(jsonResponse({ message_id: "m1", thread_id: "t1" }));
		vi.stubGlobal("fetch", fetchSpy);
		const { dropEventId, t, userId } = await setupFanout();

		await t.mutation(internal.notifications.fanoutEvent, {
			eventId: dropEventId,
		});

		const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			deliveryStatus: "pending",
			dropEventId,
			userId,
		});
		expect(rows[0]?.outboundId).toBeTruthy();

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(fetchSpy).toHaveBeenCalledTimes(1);

		// The delivery footer reads the live component lifecycle.
		const feed = await asUser(t, userId).query(api.feed.personalizedFeed, {});
		expect(feed).toHaveLength(1);
		expect(feed[0]).toMatchObject({
			deliveryStatus: "sent",
			productName: "Ethiopia Mullugeta Muntasha",
			roasterName: "Sey",
		});
	});

	test("the ledger row is the one-email-per-event guard", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(jsonResponse({ message_id: "m1", thread_id: "t1" }))
		);
		const { dropEventId, t } = await setupFanout();
		await t.mutation(internal.notifications.fanoutEvent, {
			eventId: dropEventId,
		});
		await t.mutation(internal.notifications.fanoutEvent, {
			eventId: dropEventId,
		});
		const rows = await t.run((ctx) => ctx.db.query("notifications").collect());
		expect(rows).toHaveLength(1);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
	});

	test("muted watches and users without an inbox get no alert", async () => {
		const muted = await setupFanout({ muted: true });
		await muted.t.mutation(internal.notifications.fanoutEvent, {
			eventId: muted.dropEventId,
		});
		const noInbox = await setupFanout();
		await noInbox.t.run(async (ctx) => {
			const user = await ctx.db.get(noInbox.userId);
			if (user !== null) {
				await ctx.db.patch(user._id, { agentmailInbox: undefined });
			}
		});
		await noInbox.t.mutation(internal.notifications.fanoutEvent, {
			eventId: noInbox.dropEventId,
		});
		await Promise.all(
			[muted, noInbox].map(async (fixture) => {
				const rows = await fixture.t.run((ctx) =>
					ctx.db.query("notifications").collect()
				);
				expect(rows).toHaveLength(0);
			})
		);
		await muted.t.finishAllScheduledFunctions(vi.runAllTimers);
	});

	test("non-alert-worthy event types never fan out", async () => {
		const fixture = await setupFanout();
		await fixture.t.run(async (ctx) => {
			const event = await ctx.db.get(fixture.dropEventId);
			if (event !== null) {
				await ctx.db.patch(event._id, { type: "sold_out" });
			}
		});
		await fixture.t.mutation(internal.notifications.fanoutEvent, {
			eventId: fixture.dropEventId,
		});
		const rows = await fixture.t.run((ctx) =>
			ctx.db.query("notifications").collect()
		);
		expect(rows).toHaveLength(0);
	});
});
