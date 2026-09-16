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
export const PRUNE_BATCH = 200;

// Products upserted per commit transaction. Each product costs one lookup
// plus one variant query, and writes a row per variant plus a Drop event, so
// this keeps a many-variant catalog (Proud Mary: ~8 variants per product)
// well under the per-transaction read and write limits.
export const COMMIT_BATCH_PRODUCTS = 50;

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

// Submission quotas (enforced with the rate-limiter component).
export const MAX_ACTIVE_SUBMISSIONS_PER_USER = 5;
export const MAX_SUBMISSIONS_PER_DAY = 3;

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

// Logs rendered on a public profile (§14.2); the profile is a highlight, not
// an archive dump.
export const MAX_PROFILE_LOGS = 50;

// Lots rendered on one lot page (§15); a highlight, like the profile.
export const LOT_PAGE_LOGS_LIMIT = 20;

// Lots returned by a name search on one roaster's catalog.
export const LOT_SEARCH_LIMIT = 20;

// Saved coffees ("Want to try", spec §6) read per user for the save-button
// state. Bookmarks are cheap to make, so this sits above the watch cap.
export const MAX_SAVED_COFFEES_PER_USER = 500;

// Saved coffees shown in the home "Want to try" section; the full list pages.
export const HOME_SAVED_COFFEES_LIMIT = 5;
