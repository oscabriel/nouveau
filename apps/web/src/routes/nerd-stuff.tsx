import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Fragment, useState } from "react";

import Loader from "@/components/loader";
import {
	LiveRow,
	STAGES,
	StageTrack,
	statusWord,
} from "@/components/nerd/live-row";
import { RoasterPicker } from "@/components/nerd/roaster-picker";
import { StatStrip } from "@/components/nerd/stat-strip";
import type { Run } from "@/components/nerd/stat-strip";
import { TraceDetail } from "@/components/nerd/trace-detail";
import { TraceRow } from "@/components/nerd/trace-row";
import type { Trace } from "@/components/nerd/trace-row";

const route = getRouteApi("/nerd-stuff");

/*
 * Direction contract (ADR-0018, 2026-09-21):
 * THESIS: a viewer over the traces every production page read writes,
 *   plus one bounded run loop (at most ten lots of one roaster through
 *   the sweep's own Firecrawl budget). The page shows what Jev was asked
 *   and what it answered, and stores what the read found, as the sweep
 *   would.
 * OWN-WORLD: the index's tokens, at workbench density. This route alone
 *   departs from the table-scale spacing of the rest of the app (owner,
 *   2026-09-21): 13px rows, 12px padding, everything on screen at once.
 *   Still no accent hue and no chips: the totals are the one ink block,
 *   facts are text, probability bars are ink on a 2px hairline.
 * STORY: two columns from lg. Left, the rows: the lot in flight with its
 *   stage track, then every finished lot of the run, then the live tail
 *   of recent reads. Right, sticky: the controls, the totals, the track,
 *   and the selected row's answers (or, with nothing selected, what each
 *   stage does). Pressing a row swaps the right column to its answers.
 * UNLISTED: no nav link, no footer link, no sitemap entry. Reachable by URL
 *   on purpose; it is a workbench, not a feature.
 */

/*
 * Below lg the right column comes first (controls and totals above the
 * rows) and a selected row's answers open inline under it; the column's
 * own detail slot is hidden there so the trace never renders twice.
 */

/** Rows the live tail shows; the query caps it at 50 anyway. */
const TAIL_LIMIT = 30;

const TraceList = ({
	children,
	empty,
	onSelect,
	selectedId,
	title,
	traces,
}: {
	/** A row rendered ahead of the traces: the lot in flight. */
	children?: React.ReactNode;
	empty: string;
	onSelect: (id: Trace["_id"]) => void;
	selectedId: Trace["_id"] | null;
	title: string;
	traces: Trace[] | undefined;
}) => (
	<section>
		<h2 className="label-caps flex items-baseline gap-2 border-b pb-2">
			{title}
			{traces !== undefined && (
				<span className="tnum text-muted-foreground">{traces.length}</span>
			)}
		</h2>
		{traces === undefined ? (
			<div className="py-8">
				<Loader />
			</div>
		) : (
			<ul>
				{children}
				{traces.length === 0 && children === undefined && (
					<li className="text-muted-foreground py-3 text-xs leading-snug">
						{empty}
					</li>
				)}
				{traces.map((trace) => (
					<Fragment key={trace._id}>
						<TraceRow
							onSelect={() => {
								onSelect(trace._id);
							}}
							selected={trace._id === selectedId}
							trace={trace}
						/>
						{trace._id === selectedId && (
							<li className="border-b py-4 lg:hidden">
								<TraceDetail trace={trace} />
							</li>
						)}
					</Fragment>
				))}
			</ul>
		)}
	</section>
);

/** What each stage does, for the right column while no row is selected. */
const StageGuide = () => (
	<section>
		<h3 className="label-caps">Per lot</h3>
		<dl className="mt-1">
			{STAGES.map((stage) => (
				<div
					className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-2 border-b py-1.5 text-xs leading-snug"
					key={stage.key}
				>
					<dt className="label-caps text-muted-foreground text-[10px]">
						{stage.label}
					</dt>
					<dd>{stage.what}</dd>
				</div>
			))}
		</dl>
		<p className="text-muted-foreground mt-3 text-xs leading-snug">
			Press a row to see every answer for it: the line Jev picked per field, the
			vocabulary Choice, each note&apos;s Noul, what the cut kept.
		</p>
	</section>
);

const RunPanel = ({ run }: { run: Run | null | undefined }) => {
	if (run === undefined) {
		return (
			<div className="py-8">
				<Loader />
			</div>
		);
	}
	if (run === null) {
		return (
			<p className="text-muted-foreground text-xs leading-snug">
				No run yet. The sweep&apos;s own reads still land below as traces.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<StatStrip run={run} />
			<div>
				<div className="text-xs">{statusWord(run)}</div>
				<div className="mt-1">
					<StageTrack run={run} />
				</div>
			</div>
		</div>
	);
};

/** The run the URL names, else the newest; undefined while loading. */
const useRun = (runParam: Id<"pipelineRuns"> | undefined) => {
	const picked = useQuery(
		api.nerdStuff.run,
		runParam === undefined ? "skip" : { runId: runParam }
	);
	const latest = useQuery(
		api.nerdStuff.latestRun,
		runParam === undefined ? {} : "skip"
	);
	return runParam === undefined ? latest : picked;
};

/**
 * The run's traces and the tail less those same rows, so a lot appears
 * once. The tail waits for the run and its rows, so a run's rows never
 * show up in the tail and then jump out of it.
 */
const useTraces = (run: Run | null | undefined) => {
	const hasRun = run !== undefined && run !== null;
	const runTraces = useQuery(
		api.nerdStuff.traces,
		hasRun ? { runId: run._id } : "skip"
	);
	const recent = useQuery(api.nerdStuff.recentTraces, { limit: TAIL_LIMIT });
	if (run === undefined || (hasRun && runTraces === undefined)) {
		return { runTraces, tail: undefined };
	}
	const runIds = new Set(runTraces?.map((trace) => trace._id));
	const tail = recent?.filter((trace) => !runIds.has(trace._id));
	return { runTraces, tail };
};

const Title = ({ roasterName }: { roasterName: string | undefined }) => (
	<div>
		<h1 className="font-serif text-[2rem] leading-none font-normal md:text-[2.25rem]">
			Nerd stuff
			{roasterName !== undefined && (
				<span className="text-muted-foreground ml-2 font-sans text-sm font-normal">
					{roasterName}
				</span>
			)}
		</h1>
		<p className="text-muted-foreground mt-2 max-w-prose text-xs leading-snug">
			Every page read leaves a trace: what Jev was asked, what it answered, what
			the cut kept.
		</p>
	</div>
);

const NerdStuffComponent = () => {
	const { run: runParam } = route.useSearch();
	const navigate = route.useNavigate();
	const run = useRun(runParam);
	const { runTraces, tail } = useTraces(run);
	const roasters = useQuery(api.roasters.listActive);
	const [selectedId, setSelectedId] = useState<Trace["_id"] | null>(null);
	const selected =
		runTraces?.find((trace) => trace._id === selectedId) ??
		tail?.find((trace) => trace._id === selectedId) ??
		null;
	const roasterName = run
		? roasters?.find((roaster) => roaster.id === run.roasterId)?.name
		: undefined;
	const toggle = (id: Trace["_id"]) => {
		setSelectedId((current) => (current === id ? null : id));
	};

	return (
		<main>
			<div className="px-5 pt-6 md:px-10 md:pt-8">
				<Title roasterName={roasterName} />
				<div className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-12">
					<div className="flex flex-col gap-8 lg:order-none">
						{run && (
							<TraceList
								empty="No lot has finished yet. A trace lands when a read ends."
								onSelect={toggle}
								selectedId={selectedId}
								title="This run"
								traces={runTraces}
							>
								{run.status === "running" ? <LiveRow run={run} /> : undefined}
							</TraceList>
						)}
						<TraceList
							empty="No other reads in the last three days."
							onSelect={toggle}
							selectedId={selectedId}
							title="Recent reads"
							traces={tail}
						/>
					</div>
					<aside className="order-first flex flex-col gap-6 self-start lg:sticky lg:top-6 lg:order-none lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-3">
						<RoasterPicker
							onStarted={(runId) => {
								setSelectedId(null);
								void navigate({ search: { run: runId } });
							}}
							run={run ?? null}
						/>
						<RunPanel run={run} />
						<div className="hidden lg:block">
							{selected === null ? (
								<StageGuide />
							) : (
								<TraceDetail trace={selected} />
							)}
						</div>
					</aside>
				</div>
			</div>
		</main>
	);
};

export const Route = createFileRoute("/nerd-stuff")({
	component: NerdStuffComponent,
	validateSearch: (search: Record<string, unknown>) =>
		typeof search.run === "string" && search.run !== ""
			? { run: search.run as Id<"pipelineRuns"> }
			: {},
});
