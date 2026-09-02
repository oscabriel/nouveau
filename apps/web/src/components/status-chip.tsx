import type { CrawlStatus } from "@nouveau/backend/convex/health";

import { relativeTime } from "@/lib/format";

const TONE = {
	crawl_failed: {
		dot: "bg-red-500",
		text: "text-red-600 dark:text-red-400",
	},
	stale: {
		dot: "bg-amber-500",
		text: "text-amber-600 dark:text-amber-400",
	},
	watching: {
		dot: "bg-emerald-500",
		text: "text-muted-foreground",
	},
} as const;

/** The locked chip lines from build spec §8.4, one per health state. */
const chipLine = (status: CrawlStatus): string => {
	switch (status.health) {
		case "watching": {
			return status.lastCheckedAt === null
				? "Watching — not checked yet"
				: `Watching — last checked ${relativeTime(status.lastCheckedAt)}`;
		}
		case "stale": {
			return status.lastSuccessAt === null
				? "Stale — no successful check yet, still checking"
				: `Stale — last success ${relativeTime(status.lastSuccessAt)}, still checking`;
		}
		case "crawl_failed": {
			return "Crawl failed — the shop stopped responding; we'll keep trying";
		}
		default: {
			return status.health satisfies never;
		}
	}
};

/** The chip's dot on its own, for pills too dense to carry the line. */
export const HealthDot = ({ health }: { health: CrawlStatus["health"] }) => (
	<span
		aria-hidden
		className={`inline-block size-2 shrink-0 rounded-full ${TONE[health].dot}`}
	/>
);

/**
 * Watch status chip (build spec §8.4): one dot, one honest line about what
 * the crawler is doing. Shown anywhere a roaster appears.
 */
export const StatusChip = ({
	compact = false,
	status,
}: {
	/** Dot plus the state word only; for dense rows like the directory. */
	compact?: boolean;
	status: CrawlStatus;
}) => {
	const line = chipLine(status);
	const label = compact ? (line.split(" — ")[0] ?? line) : line;
	return (
		<span
			className={`inline-flex items-center gap-1.5 text-sm ${TONE[status.health].text}`}
			title={compact ? line : undefined}
		>
			<HealthDot health={status.health} />
			{label}
		</span>
	);
};
