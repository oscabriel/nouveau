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
import type * as factVocabulary from "../factVocabulary.js";
import type * as feed from "../feed.js";
import type * as flavorVocabulary from "../flavorVocabulary.js";
import type * as followerCounts from "../followerCounts.js";
import type * as handles from "../handles.js";
import type * as health from "../health.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as identity from "../identity.js";
import type * as jev from "../jev.js";
import type * as logs from "../logs.js";
import type * as lotClassifierShadow from "../lotClassifierShadow.js";
import type * as lotFacts from "../lotFacts.js";
import type * as lotStock from "../lotStock.js";
import type * as lotUrl from "../lotUrl.js";
import type * as lots from "../lots.js";
import type * as notifications from "../notifications.js";
import type * as pageFacts from "../pageFacts.js";
import type * as pipelineTrace from "../pipelineTrace.js";
import type * as platform from "../platform.js";
import type * as productPages from "../productPages.js";
import type * as recommendationAgent from "../recommendationAgent.js";
import type * as recommendationCatalog from "../recommendationCatalog.js";
import type * as recommendationRules from "../recommendationRules.js";
import type * as recommendationThreads from "../recommendationThreads.js";
import type * as recommendationWorker from "../recommendationWorker.js";
import type * as recommendations from "../recommendations.js";
import type * as roasters from "../roasters.js";
import type * as savedCoffees from "../savedCoffees.js";
import type * as seed from "../seed.js";
import type * as shopMarket from "../shopMarket.js";
import type * as slugs from "../slugs.js";
import type * as sourceMode from "../sourceMode.js";
import type * as submissions from "../submissions.js";
import type * as suffix from "../suffix.js";
import type * as tasting from "../tasting.js";
import type * as tiles from "../tiles.js";
import type * as users from "../users.js";
import type * as watches from "../watches.js";
import type * as woocommerce from "../woocommerce.js";

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
  factVocabulary: typeof factVocabulary;
  feed: typeof feed;
  flavorVocabulary: typeof flavorVocabulary;
  followerCounts: typeof followerCounts;
  handles: typeof handles;
  health: typeof health;
  healthCheck: typeof healthCheck;
  http: typeof http;
  identity: typeof identity;
  jev: typeof jev;
  logs: typeof logs;
  lotClassifierShadow: typeof lotClassifierShadow;
  lotFacts: typeof lotFacts;
  lotStock: typeof lotStock;
  lotUrl: typeof lotUrl;
  lots: typeof lots;
  notifications: typeof notifications;
  pageFacts: typeof pageFacts;
  pipelineTrace: typeof pipelineTrace;
  platform: typeof platform;
  productPages: typeof productPages;
  recommendationAgent: typeof recommendationAgent;
  recommendationCatalog: typeof recommendationCatalog;
  recommendationRules: typeof recommendationRules;
  recommendationThreads: typeof recommendationThreads;
  recommendationWorker: typeof recommendationWorker;
  recommendations: typeof recommendations;
  roasters: typeof roasters;
  savedCoffees: typeof savedCoffees;
  seed: typeof seed;
  shopMarket: typeof shopMarket;
  slugs: typeof slugs;
  sourceMode: typeof sourceMode;
  submissions: typeof submissions;
  suffix: typeof suffix;
  tasting: typeof tasting;
  tiles: typeof tiles;
  users: typeof users;
  watches: typeof watches;
  woocommerce: typeof woocommerce;
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
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  recommendationPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"recommendationPool">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  firecrawl: import("@firecrawl/firecrawl-convex/_generated/component.js").ComponentApi<"firecrawl">;
  auth: import("@convex-dev/auth/core/_generated/component.js").ComponentApi<"auth">;
  oauthGoogle: import("@convex-dev/auth/providers/oauth/_generated/component.js").ComponentApi<"oauthGoogle">;
};
