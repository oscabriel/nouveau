import { useTicker } from "@/lib/use-ticker";

import type { Run } from "./stat-strip";

/** The six cells of the track, in pipeline order (ADR-0018). */
const STAGES = [
	{ key: "feed", label: "Feed" },
	{ key: "gate", label: "Gate" },
	{ key: "page", label: "Page" },
	{ key: "jev", label: "Jev" },
	{ key: "cut", label: "Cut" },
	{ key: "store", label: "Store" },
] as const;

type StageKey = (typeof STAGES)[number]["key"];

const stageIndex = (stage: StageKey | undefined): number =>
	stage === undefined ? -1 : STAGES.findIndex((s) => s.key === stage);

const elapsed = (from: number | undefined, now: number): string =>
	from === undefined ? "" : `${((now - from) / 1000).toFixed(1)} s`;

const statusWord = (run: Run): string => {
	switch (run.status) {
		case "running": {
			return `Lot ${Math.min(run.index + 1, run.total)} of ${run.total}`;
		}
		case "queued": {
			return "Queued";
		}
		case "done": {
			return `Done, ${run.total} ${run.total === 1 ? "lot" : "lots"}`;
		}
		case "stopped": {
			return "Stopped";
		}
		case "failed": {
			return run.message === undefined ? "Failed" : `Failed, ${run.message}`;
		}
		default: {
			return "";
		}
	}
};

/**
 * The stage track: six caps cells over one hairline. Cells the lot has
 * passed are ink, the one in flight is ink with the grey reading dot and
 * its elapsed time, the rest are grey. The run's message (a deferral's
 * "waiting for the Firecrawl budget") reads under the track. Between lots
 * and after the run, no cell is active.
 */
export const LiveRow = ({ run }: { run: Run }) => {
	const running = run.status === "running";
	const now = useTicker(running && run.currentStage !== undefined);
	const active = stageIndex(run.currentStage);
	return (
		<section aria-label="Stage track">
			<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
				<p className="text-sm leading-snug md:text-[15px]">{statusWord(run)}</p>
				{run.commit && <span className="label-caps">Commit</span>}
			</div>
			<ol className="mt-4 grid grid-cols-3 border-b sm:grid-cols-6">
				{STAGES.map((stage, i) => {
					const isActive = running && i === active;
					const passed = running && active > i;
					const tone =
						isActive || passed ? "text-foreground" : "text-muted-foreground";
					return (
						<li
							aria-current={isActive ? "step" : undefined}
							className={`label-caps flex min-h-11 items-center gap-2 border-t py-3 pr-3 ${tone} ${
								isActive ? "border-foreground" : "border-border"
							}`}
							key={stage.key}
						>
							{isActive && (
								<span
									aria-hidden
									className="inline-block size-2 rounded-full bg-current motion-safe:animate-pulse"
								/>
							)}
							<span>{stage.label}</span>
							{isActive && (
								<span className="tnum text-muted-foreground ml-auto font-normal tracking-normal normal-case">
									{elapsed(run.stageStartedAt, now)}
								</span>
							)}
						</li>
					);
				})}
			</ol>
			{running && run.message !== undefined && (
				<p className="text-muted-foreground mt-3 text-sm leading-snug">
					{run.message}
				</p>
			)}
		</section>
	);
};
