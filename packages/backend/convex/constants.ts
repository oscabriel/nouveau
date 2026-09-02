// Build-time constants (from the locked build spec).

// Default per-roaster crawl cadence until per-roaster cadence policy lands.
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

// Raw captures deleted per prune transaction; a full batch reschedules.
export const PRUNE_BATCH = 200;

// Products upserted per commit transaction. Each product costs one lookup
// plus one variant query, and writes a row per variant plus a Drop event, so
// this keeps a many-variant catalog (Proud Mary: ~8 variants per product)
// well under the per-transaction read and write limits.
export const COMMIT_BATCH_PRODUCTS = 50;

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
