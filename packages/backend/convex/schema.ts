import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { healthValidator } from "./health";

export default defineSchema({
	crawlSources: defineTable({
		cadenceMinutes: v.number(),
		consecutiveFailures: v.number(),
		health: healthValidator,
		lastCheckedAt: v.optional(v.number()),
		lastErrorAt: v.optional(v.number()),
		lastErrorMessage: v.optional(v.string()),
		lastSuccessAt: v.optional(v.number()),
		mode: v.union(v.literal("products_json"), v.literal("html")),
		nextCrawlDueAt: v.number(),
		roasterId: v.id("roasters"),
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
	}).index("by_user_and_drop_event", ["userId", "dropEventId"]),

	productVariants: defineTable({
		available: v.boolean(),
		grams: v.optional(v.number()),
		name: v.string(),
		priceCents: v.number(),
		productId: v.id("products"),
	}).index("by_product_id", ["productId"]),

	products: defineTable({
		externalId: v.string(),
		firstSeenAt: v.number(),
		handle: v.string(),
		lastSeenAt: v.number(),
		// Consecutive successful crawls this product was absent from.
		missedCrawls: v.optional(v.number()),
		name: v.string(),
		roasterId: v.id("roasters"),
		// Absent from 3 consecutive successful crawls -> archived.
		status: v.union(v.literal("current"), v.literal("archived")),
	}).index("by_roaster_and_external_id", ["roasterId", "externalId"]),

	rawCaptures: defineTable({
		capturedAt: v.number(),
		extractionOk: v.boolean(),
		roasterId: v.id("roasters"),
		// products.json bodies can exceed doc limits; the raw body lives in storage.
		storageId: v.id("_storage"),
	})
		.index("by_roaster_id", ["roasterId"])
		.index("by_captured_at", ["capturedAt"]),

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
		.index("by_slug", ["slug"])
		.index("by_status_and_state", ["status", "state"]),

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
