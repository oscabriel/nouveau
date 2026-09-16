/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as checkNow from "../checkNow.js";
import type * as constants from "../constants.js";
import type * as crawlSources from "../crawlSources.js";
import type * as crawler from "../crawler.js";
import type * as crons from "../crons.js";
import type * as extraction from "../extraction.js";
import type * as feed from "../feed.js";
import type * as followerCounts from "../followerCounts.js";
import type * as health from "../health.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as logs from "../logs.js";
import type * as lotFacts from "../lotFacts.js";
import type * as lots from "../lots.js";
import type * as migrations from "../migrations.js";
import type * as notifications from "../notifications.js";
import type * as pageFacts from "../pageFacts.js";
import type * as recommendationCatalog from "../recommendationCatalog.js";
import type * as recommendationRules from "../recommendationRules.js";
import type * as recommendationWorker from "../recommendationWorker.js";
import type * as recommendations from "../recommendations.js";
import type * as roasters from "../roasters.js";
import type * as savedCoffees from "../savedCoffees.js";
import type * as seed from "../seed.js";
import type * as shopMarket from "../shopMarket.js";
import type * as users from "../users.js";
import type * as watches from "../watches.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  checkNow: typeof checkNow;
  constants: typeof constants;
  crawlSources: typeof crawlSources;
  crawler: typeof crawler;
  crons: typeof crons;
  extraction: typeof extraction;
  feed: typeof feed;
  followerCounts: typeof followerCounts;
  health: typeof health;
  healthCheck: typeof healthCheck;
  http: typeof http;
  identity: typeof identity;
  logs: typeof logs;
  lotFacts: typeof lotFacts;
  lots: typeof lots;
  migrations: typeof migrations;
  notifications: typeof notifications;
  pageFacts: typeof pageFacts;
  recommendationCatalog: typeof recommendationCatalog;
  recommendationRules: typeof recommendationRules;
  recommendationWorker: typeof recommendationWorker;
  recommendations: typeof recommendations;
  roasters: typeof roasters;
  savedCoffees: typeof savedCoffees;
  seed: typeof seed;
  shopMarket: typeof shopMarket;
  users: typeof users;
  watches: typeof watches;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  aggregate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"aggregate">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  recommendationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"recommendationPool">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  auth: import("@convex-dev/auth/core/_generated/component.js").ComponentApi<"auth">;
  oauthGoogle: import("@convex-dev/auth/providers/oauth/_generated/component.js").ComponentApi<"oauthGoogle">;
};
