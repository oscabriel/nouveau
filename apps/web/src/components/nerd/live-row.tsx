import { useTicker } from "@/lib/use-ticker";

import type { Run } from "./stat-strip";

/** The six cells of the track, in pipeline order (ADR-0018). */
export const STAGES = [
	{ key: "feed", label: "Feed", what: "the shop feed's regex pass on the lot" },
	{
		key: "gate",
		label: "Gate",
		what: "the shadow gate's answer, when one exists",
	},
	{
		key: "page",
		label: "Page",
		what: "the lot page, through Firecrawl or plain fetch",
	},
	{
		key: "jev",
		label: "Jev",
		what: "one request: a line pick per field, the vocabulary Choices, a Noul per note and sentence",
	},
	{
		key: "cut",
		label: "Cut",
		what: "the verifier trims each pick to a value or drops it",
	},
	{
		key: "store",
		label: "Store",
		what: "facts written only when COMMIT is on",
	},
] as const;

type StageKey = (typeof STAGES)[number]["key"];

const stageIndex = (stage: StageKey | undefined): number =>
	stage === undefined ? -1 : STAGES.findIndex((s) => s.key === stage);

const seconds = (from: number | undefined, now: number): string =>
	from === undefined ? "" : `${((now - from) / 1000).toFixed(1)}s`;

export const statusWord = (run: Run): string => {
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
			const how = run.message === "superseded" ? "Superseded" : "Stopped";
			return `${how} after ${run.index} of ${run.total}`;
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
 * its elapsed time, the rest are grey. With no lot in flight every cell
 * is grey and the row reads the run's status word instead.
 */
export const StageTrack = ({ run }: { run: Run }) => {
	const running = run.status === "running";
	const now = useTicker(running && run.currentStage !== undefined);
	const active = stageIndex(run.currentStage);
	return (
		<ol aria-label="Stage track" className="grid grid-cols-6">
			{STAGES.map((stage, i) => {
				const isActive = running && i === active;
				const passed = running && active > i;
				return (
					<li
						aria-current={isActive ? "step" : undefined}
						className={`label-caps flex items-center gap-1.5 border-t py-2 pr-2 text-[10px] ${
							isActive || passed ? "text-foreground" : "text-muted-foreground"
						} ${isActive ? "border-foreground" : ""}`}
						key={stage.key}
						title={stage.what}
					>
						{isActive && (
							<span
								aria-hidden
								className="inline-block size-1.5 shrink-0 rounded-full bg-current motion-safe:animate-pulse"
							/>
						)}
						<span>{stage.label}</span>
						{isActive && (
							<span className="tnum text-muted-foreground ml-auto font-normal tracking-normal">
								{seconds(run.stageStartedAt, now)}
							</span>
						)}
					</li>
				);
			})}
		</ol>
	);
};

/**
 * The lot in flight as the first row of the run's list: the status word,
 * the run's message when it has one, and the track. Rendered only while
 * the run is running; a finished lot is a trace row.
 */
export const LiveRow = ({ run }: { run: Run }) => (
	<li className="border-b py-3">
		<div className="flex items-baseline justify-between gap-3 text-[13px] leading-snug">
			<span className="inline-flex items-center gap-2">
				<span
					aria-hidden
					className="inline-block size-1.5 rounded-full bg-current motion-safe:animate-pulse"
				/>
				{statusWord(run)}
			</span>
			{run.message !== undefined && (
				<span className="text-muted-foreground text-xs">{run.message}</span>
			)}
		</div>
		<div className="mt-2">
			<StageTrack run={run} />
		</div>
	</li>
);
