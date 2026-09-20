// Build-time constants (from the locked build spec).

// Crawl cadence for a roaster the seed table does not name (#33). The seed
// table (seed.ts) sets 15 for drop roasters that release in one-hour windows
// on a fixed weekday, 30 for roasters with a few detections a week, 60 here.
export const DEFAULT_CADENCE_MINUTES = 60;

// Staleness threshold: no successful crawl within 2x the roaster's cadence,
// minimum 1 hour.
export const stalenessThresholdMs = (cadenceMinutes: number): number =>
	Math.max(cadenceMinutes * 2, 60) * 60_000;

// A lot absent from this many consecutive successful crawls flips to archived.
export const ARCHIVE_STRIKES = 3;

// Sources claimed per scheduler tick; each tick pushes their due dates out so
// a concurrent tick cannot double-run them.
export const TICK_BATCH = 20;

// Raw capture bodies are crawl diagnostics; hourly crawls across 20 sources
// store ~100 MB/day, so the daily prune keeps only a short window.
export const RAW_CAPTURE_RETENTION_DAYS = 3;
export const rawCaptureRetentionMs = (): number =>
	RAW_CAPTURE_RETENTION_DAYS * 24 * 60 * 60_000;

// A successful capture is a reference body, not a diagnostic, so one per
// roaster per day is enough; a failed extraction is always captured (#33).
// At the 15-minute cadence this cuts capture storage from ~277 MB/day to a
// few MB.
export const RAW_CAPTURE_SUCCESS_INTERVAL_MS = 24 * 60 * 60_000;

export const shouldStoreRawCapture = (input: {
	extractionOk: boolean;
	lastOkCaptureAt: number | undefined;
	now: number;
}): boolean =>
	!input.extractionOk ||
	input.lastOkCaptureAt === undefined ||
	input.now - input.lastOkCaptureAt >= RAW_CAPTURE_SUCCESS_INTERVAL_MS;

// Raw captures deleted per prune transaction; a full batch reschedules.
/** How far one filtered roaster-grid scan reads (the extreme is ~900 lots). */
export const LOT_FILTER_SCAN = 1000;

/** How many moved variants one collapsed Drop event cites (variantIds). */
export const MAX_CITED_VARIANTS = 32;
/** Distinct bag sizes (grams) the variant rollup keeps on the product. */
export const MAX_WEIGHT_OPTIONS = 8;

export const PRUNE_BATCH = 200;

// Products upserted per commit transaction. Each product costs one lookup
// plus one variant query, and writes a row per variant plus a Drop event, so
// this keeps a many-variant catalog (Proud Mary: ~8 variants per product)
// well under the per-transaction read and write limits.
export const COMMIT_BATCH_PRODUCTS = 50;

// product_pages mode (ADR-0006). Each product page is one Firecrawl credit,
// so a full pass is capped: the collection page's links first, then lots
// already in the catalog, then the sitemap if the page listed nothing.
export const MAX_PRODUCT_PAGES = 120;
// Product scrapes in flight at once; the plan's concurrency limit throttles
// above a handful and a throttled scrape is a slow one. The WooCommerce
// variation fetches use the same bound toward the shop's own origin.
export const PRODUCT_SCRAPE_CONCURRENCY = 3;
// The collection page's change tracking gates the product scrapes: an
// unchanged page skips them. A size selling out can leave the grid
// unchanged, so a full read is forced at least this often.
export const PRODUCT_PAGES_FULL_INTERVAL_MS = 6 * 60 * 60_000;
// Child sitemaps read when discovery falls back to the sitemap.
export const MAX_SITEMAPS = 4;
// Variable WooCommerce products whose sizes are fetched per crawl; each is
// one plain HTTP request to the shop.
export const MAX_WOO_VARIATION_FETCHES = 60;

// Check now (#34). A runningSince stamp older than this is a crawl whose
// action died before finalizeCrawl; the source is treated as idle again.
export const CRAWL_RUNNING_STALE_MS = 10 * 60_000;
// A source checked more recently than this answers "fresh" without crawling.
export const CHECK_NOW_FRESH_MS = 2 * 60_000;
// Per-user token bucket: 3 checks per 10 minutes, burst of 3.
export const CHECK_NOW_USER_RATE = 3;
export const CHECK_NOW_USER_PERIOD_MS = 10 * 60_000;
// Per-source fixed window: one check per 2 minutes across all users.
export const CHECK_NOW_SOURCE_PERIOD_MS = 2 * 60_000;

// Alert-worthy event types notify; sold_out and price_rise are stored silently
// for stats.
export const ALERT_WORTHY_TYPES = [
	"new",
	"back_in_stock",
	"price_drop",
] as const;

// Upper bound on watches read per user in feed and watch-list queries. Well
// above the 20-roaster seed list; revisit when user submissions grow it.
export const MAX_WATCHES_PER_USER = 200;

// Watchers alerted per Drop event, capping the fanout's reads and writes
// (one ledger row + one email enqueue per recipient) inside one transaction.
export const MAX_ALERT_RECIPIENTS_PER_EVENT = 200;

// How long an inbox-provisioning claim stays valid. Covers an action that
// crashes before reaching its release mutation; the normal paths clear the
// claim on both success and failure.
export const INBOX_CLAIM_TTL_MS = 5 * 60_000;

// Logs returned by the global activity feed (build spec §14.3).
export const LOG_FEED_LIMIT = 30;

// Landing tiles (ADR-0014). Shuffle draws three from the most recent rated
// logs whose lot has a photo; the scan bound keeps the photo check from
// reading the whole log history when few logs carry both a rating and a
// photo.
export const TILE_COUNT = 3;
export const MAX_TILE_POOL = 50;
export const TILE_SCAN_LIMIT = 200;

// Logs rendered on a public profile (§14.2); the profile is a highlight, not
// an archive dump. The owner's try list caps the same way.
export const MAX_PROFILE_LOGS = 50;
export const MAX_PROFILE_SAVED = 50;

// Lots rendered on one lot page (§15); a highlight, like the profile.
export const LOT_PAGE_LOGS_LIMIT = 20;

// Variant rows the lot page's size table reads. Sits above any real lot:
// Shopify publishes at most 100 variants per product and the biggest lot in
// the catalog (a Proud Mary blend) has 21, and variants are name-matched per
// crawl and never deleted, so renamed sizes accumulate slowly. A bound, not
// a display cap: the page still promises every purchasable option.
export const LOT_PAGE_VARIANTS_LIMIT = 128;

// Lots returned by a name search on one roaster's catalog.
export const LOT_SEARCH_LIMIT = 20;

// Saved coffees ("Want to try", spec §6) read per user for the save-button
// state. Bookmarks are cheap to make, so this sits above the watch cap.
export const MAX_SAVED_COFFEES_PER_USER = 500;

// Saved coffees shown in the home "Want to try" section; the full list pages.
export const HOME_SAVED_COFFEES_LIMIT = 5;

// Submissions (build spec §7.1). Both quotas are also the Firecrawl credit
// bound: a product_pages baseline costs about one credit per lot.
export const MAX_SUBMISSIONS_PER_DAY = 3;
export const SUBMISSION_DAY_MS = 24 * 60 * 60_000;
export const MAX_ACTIVE_SUBMISSIONS_PER_USER = 5;
// Retries of a failed baseline: a few in a row, then a wait.
export const SUBMISSION_RETRY_RATE = 3;
export const SUBMISSION_RETRY_PERIOD_MS = 10 * 60_000;

/**
 * Static top-level routes (ADR-0011), current and retired. No user handle or
 * roaster slug may equal one: a static route would otherwise shadow (or be
 * shadowed by) the dynamic segment that shares its path prefix.
 */
export const RESERVED_ROUTES = [
	"roasters",
	"roaster",
	"drops",
	"activity",
	"next-bag",
	"settings",
	"about",
	// Retired paths that stay as redirects forever.
	"lots",
	"feed",
	"profile",
	"watches",
	"saved",
];
