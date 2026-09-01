// Build-time constants (from the locked build spec).

// Default per-roaster crawl cadence until per-roaster cadence policy lands.
export const DEFAULT_CADENCE_MINUTES = 60;

// Staleness threshold: no successful crawl within 2x the roaster's cadence,
// minimum 1 hour.
export const stalenessThresholdMs = (cadenceMinutes: number): number =>
	Math.max(cadenceMinutes * 2, 60) * 60_000;

// A lot absent from this many consecutive successful crawls flips to archived.
export const ARCHIVE_STRIKES = 3;

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
