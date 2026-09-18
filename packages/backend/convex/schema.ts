import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { healthValidator } from "./health";
import { pageFactsValidator } from "./lotFacts";
import {
	candidateValidator,
	preferenceValidator,
	recommendationInput,
	selectionValidator,
} from "./recommendationRules";
import { shopMarketValidator } from "./shopMarket";
import { sourceModeValidator } from "./sourceMode";

export default defineSchema({
	// Singleton config row (at most one document). Holds the shared AgentMail
	// alert inbox (AgentMail free plan allows only 3 inboxes total, so alerts
	// send from one product inbox rather than one per user) plus the claim
	// stamp that serializes its provisioning.
	appConfig: defineTable({
		alertInbox: v.optional(
			v.object({ address: v.string(), inboxId: v.string() })
		),
		// Claim stamp for inbox provisioning: claimInboxProvisioning sets it so
		// concurrent scheduled provisions don't both call AgentMail; expired
		// claims are treated as stale and can be retaken.
		alertInboxClaimedAt: v.optional(v.number()),
	}),

	crawlSources: defineTable({
		cadenceMinutes: v.number(),
		consecutiveFailures: v.number(),
		health: healthValidator,
		lastCheckedAt: v.optional(v.number()),
		lastErrorAt: v.optional(v.number()),
		lastErrorMessage: v.optional(v.string()),
		// The last successful crawl that read every product (product_pages
		// skips the product scrapes while the collection page is unchanged;
		// a full read is forced once this is older than
		// PRODUCT_PAGES_FULL_INTERVAL_MS).
		lastFullCrawlAt: v.optional(v.number()),
		lastSuccessAt: v.optional(v.number()),
		market: v.optional(shopMarketValidator),
		mode: sourceModeValidator,
		nextCrawlDueAt: v.number(),
		roasterId: v.id("roasters"),
		// Set when a crawl is scheduled, cleared by finalizeCrawl. Refuses a
		// double start and gives the status chip its "checking" state (#34).
		runningSince: v.optional(v.number()),
	})
		.index("by_roaster_id", ["roasterId"])
		.index("by_next_crawl_due_at", ["nextCrawlDueAt"])
		.index("by_health", ["health"]),

	dropEvents: defineTable({
		aiSummary: v.optional(v.string()),
		aiTags: v.optional(v.array(v.string())),
		detectedAt: v.number(),
		newPriceCents: v.optional(v.number()),
		oldPriceCents: v.optional(v.number()),
		productId: v.id("products"),
		roasterId: v.id("roasters"),
		type: v.union(
			v.literal("new"),
			v.literal("back_in_stock"),
			v.literal("price_drop"),
			v.literal("sold_out"),
			v.literal("price_rise")
		),
		// The variant that moved, cited on the event.
		variantId: v.optional(v.id("productVariants")),
	})
		.index("by_roaster_and_detected_at", ["roasterId", "detectedAt"])
		.index("by_product", ["productId"])
		// The global feed merges one desc scan per alert-worthy type.
		.index("by_type_and_detected_at", ["type", "detectedAt"]),

	localScenes: defineTable({
		createdAt: v.number(),
		// Resolved live at read time against roasters' city/state.
		filter: v.object({
			kind: v.union(v.literal("city"), v.literal("state")),
			value: v.string(),
		}),
		label: v.string(),
		userId: v.id("users"),
	}).index("by_user_id", ["userId"]),

	// A user's record of trying a lot (build spec §14.1, ADR-0002): the
	// durable social object. Logs are public and cite the lot, never a
	// variant; archived lots stay loggable because lots are never deleted.
	logs: defineTable({
		loggedAt: v.number(),
		notes: v.optional(v.string()),
		productId: v.id("products"),
		rating: v.optional(v.number()),
		userId: v.id("users"),
	})
		.index("by_logged_at", ["loggedAt"])
		.index("by_product_and_logged_at", ["productId", "loggedAt"])
		.index("by_user_and_logged_at", ["userId", "loggedAt"]),

	// Jev shadow verdicts (§16, lotClassifierShadow): the lot classifier's
	// `default` rejections are a guess, so every crawl also asks Jev whether
	// the item is a lot and records the answer without acting on it. One row
	// per (roaster, externalId), ever: the same tail reappears on every crawl
	// and only the first opinion counts.
	lotClassifierShadow: defineTable({
		// Jev also read the item as a non-lot (every candidate was rejected
		// on the `default` path, so agreement means not_coffee).
		agreed: v.boolean(),
		// P(lot) from the Choice's probability distribution.
		coffeeProbability: v.number(),
		confidence: v.optional(v.number()),
		externalId: v.string(),
		jevChoice: v.string(),
		// The exact version that answered, from the response body.
		model: v.string(),
		productType: v.optional(v.string()),
		roasterId: v.id("roasters"),
		tags: v.optional(v.array(v.string())),
		title: v.string(),
	}).index("by_roaster_and_external_id", ["roasterId", "externalId"]),

	notifications: defineTable({
		deliveryStatus: v.union(
			v.literal("pending"),
			v.literal("sent"),
			v.literal("delivered"),
			v.literal("failed")
		),
		dropEventId: v.id("dropEvents"),
		// AgentMail OutboundId once the message is enqueued.
		outboundId: v.optional(v.string()),
		sentAt: v.optional(v.number()),
		userId: v.id("users"),
	})
		.index("by_user_and_drop_event", ["userId", "dropEventId"])
		// Event purges (§16 non-lot purge, purgeRoasterEvents) delete the ledger
		// rows of each event they remove.
		.index("by_drop_event_id", ["dropEventId"]),

	productVariants: defineTable({
		available: v.boolean(),
		grams: v.optional(v.number()),
		name: v.string(),
		observedAt: v.optional(v.number()),
		priceCents: v.number(),
		productId: v.id("products"),
		sizeObservedAt: v.optional(v.number()),
	}).index("by_product_id", ["productId"]),

	products: defineTable({
		// When the roaster's product page was last read for pageFacts (ADR-0005).
		// Set at the request so concurrent viewers share one scrape; a read that
		// found nothing keeps the stamp and is retried after PAGE_FACTS_RETRY_MS.
		copyFetchedAt: v.optional(v.number()),
		// §14.4 lot copy: what the roaster publishes about the lot. Filled at
		// upsert time (products upsert every crawl, no migration); absent
		// fields are simply absent — thin feeds carry none of it.
		description: v.optional(v.string()),
		elevation: v.optional(v.string()),
		externalId: v.string(),
		firstSeenAt: v.number(),
		handle: v.string(),
		imageUrl: v.optional(v.string()),
		lastSeenAt: v.number(),
		// Consecutive successful crawls this product was absent from.
		missedCrawls: v.optional(v.number()),
		name: v.string(),
		origin: v.optional(v.string()),
		// Facts read off the rendered product page (ADR-0005). Owned by the
		// page scrape (pageFacts.ts); lotCopyFields never writes it. Reads merge
		// with the feed winning (lotFacts.mergedFacts).
		pageFacts: v.optional(pageFactsValidator),
		process: v.optional(v.string()),
		producer: v.optional(v.string()),
		// Raw Shopify product_type, for audits and per-roaster rules.
		productType: v.optional(v.string()),
		region: v.optional(v.string()),
		roastLevel: v.optional(v.string()),
		// Descriptors from the roaster's own copy, verbatim (§14.4), one per
		// item.
		roasterId: v.id("roasters"),
		roasterNotes: v.optional(v.array(v.string())),
		// Absent from 3 consecutive successful crawls -> archived.
		status: v.union(v.literal("current"), v.literal("archived")),
		tags: v.optional(v.array(v.string())),
		// The lot's shop page when the source knows it (WooCommerce permalink,
		// the scraped product page). Absent for Shopify feeds, whose page is
		// `/products/{handle}` (lotUrl.ts).
		url: v.optional(v.string()),
		variety: v.optional(v.string()),
	})
		.index("by_roaster_and_external_id", ["roasterId", "externalId"])
		// Recommendation candidates: one roaster's current lots from its latest
		// confirmed crawl, so no roaster's crawl timing crowds out the others.
		.index("by_roaster_and_status_and_last_seen_at", [
			"roasterId",
			"status",
			"lastSeenAt",
		])
		// Lot discovery on the roaster page (§14.1): a taster finds the lot they
		// tried by name; big catalogs (Sey ~887 lots) make paging alone useless.
		.searchIndex("search_name", {
			filterFields: ["roasterId"],
			searchField: "name",
		}),

	rawCaptures: defineTable({
		capturedAt: v.number(),
		extractionOk: v.boolean(),
		roasterId: v.id("roasters"),
		// products.json bodies can exceed doc limits; the raw body lives in storage.
		storageId: v.id("_storage"),
	})
		.index("by_roaster_id", ["roasterId"])
		// The crawler's "last successful capture" lookup (#33).
		.index("by_roaster_id_and_extraction_ok_and_captured_at", [
			"roasterId",
			"extractionOk",
			"capturedAt",
		])
		.index("by_captured_at", ["capturedAt"]),

	// Only public source prose belongs here. Never cache user history or prompts.
	recommendationEvidence: defineTable({
		observedAt: v.number(),
		passages: v.array(v.string()),
		productId: v.id("products"),
		url: v.string(),
	}).index("by_product_id", ["productId"]),

	recommendationRuns: defineTable({
		attempt: v.number(),
		candidates: v.array(candidateValidator),
		createdAt: v.number(),
		enrichments: v.number(),
		// Watchdog for the current attempt; cancelled once the run settles.
		expireId: v.optional(v.id("_scheduled_functions")),
		input: recommendationInput,
		message: v.string(),
		model: v.optional(v.string()),
		preferences: v.array(preferenceValidator),
		requestKey: v.string(),
		selections: v.array(selectionValidator),
		status: v.union(
			v.literal("queued"),
			v.literal("running"),
			v.literal("ready"),
			v.literal("failed")
		),
		updatedAt: v.number(),
		userId: v.id("users"),
	})
		.index("by_user_id_and_created_at", ["userId", "createdAt"])
		.index("by_user_id_and_status", ["userId", "status"])
		.index("by_user_id_and_request_key", ["userId", "requestKey"]),

	roasters: defineTable({
		city: v.string(),
		claimed: v.boolean(),
		claimedByUserId: v.optional(v.id("users")),
		// Registrable domain of the shop; the dedup key for submissions.
		domain: v.string(),
		name: v.string(),
		productPageUrl: v.string(),
		slug: v.string(),
		source: v.union(v.literal("curated"), v.literal("user-submitted")),
		state: v.string(),
		// pending -> active is data-driven (baseline crawl captured); rejected is manual.
		status: v.union(
			v.literal("pending"),
			v.literal("active"),
			v.literal("rejected")
		),
		submittedByUserId: v.optional(v.id("users")),
		websiteUrl: v.string(),
	})
		.index("by_domain", ["domain"])
		.index("by_slug", ["slug"])
		.index("by_status_and_state", ["status", "state"])
		// A user's submissions (§7.1): the quota counts them, the submissions
		// page lists them.
		.index("by_submitted_by_user_id", ["submittedByUserId"]),

	// "Want to try" (product spec §6): a private bookmark on a lot. Saving
	// does not email, does not watch a roaster, and never shows on a public
	// profile. fromRunId records the Find-my-next-bag run it came from.
	savedCoffees: defineTable({
		fromRunId: v.optional(v.id("recommendationRuns")),
		productId: v.id("products"),
		savedAt: v.number(),
		userId: v.id("users"),
	})
		.index("by_user_and_saved_at", ["userId", "savedAt"])
		.index("by_user_and_product", ["userId", "productId"]),

	users: defineTable({
		email: v.optional(v.string()),
		emailVerified: v.optional(v.boolean()),
		imageUrl: v.optional(v.string()),
		name: v.optional(v.string()),
		providerAccountId: v.string(),
	}).index("by_provider_account_id", ["providerAccountId"]),

	watches: defineTable({
		muted: v.boolean(),
		roasterId: v.id("roasters"),
		userId: v.id("users"),
	})
		.index("by_user_id", ["userId"])
		.index("by_roaster_id", ["roasterId"])
		.index("by_user_and_roaster_id", ["userId", "roasterId"]),
});
