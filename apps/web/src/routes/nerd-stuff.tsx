import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";

import Loader from "@/components/loader";
import { LiveRow } from "@/components/nerd/live-row";
import { RoasterPicker } from "@/components/nerd/roaster-picker";
import { StatStrip } from "@/components/nerd/stat-strip";
import type { Run } from "@/components/nerd/stat-strip";
import { TraceDetail } from "@/components/nerd/trace-detail";
import { TraceRow } from "@/components/nerd/trace-row";
import type { Trace } from "@/components/nerd/trace-row";

/** Rows the live tail shows; the query caps it at 50 anyway. */
const TAIL_LIMIT = 30;

/*
 * Direction contract (ADR-0018, 2026-09-21):
 * THESIS: a viewer over the traces every production page read writes,
 *   plus one bounded run loop (at most ten lots of one roaster through
 *   the sweep's own Firecrawl budget). The page shows what Jev was asked
 *   and what it answered; it invents nothing and, unless COMMIT is on,
 *   writes no facts.
 * OWN-WORLD: the index's system as it stands. No accent hue; the demo's
 *   "jev" tone becomes the one inverted strip. No chips: facts are text in
 *   hairline lists. Probability bars are ink on a hairline track, 2px.
 * STORY: a visitor lands on the latest run (or `?run=`), sees its totals
 *   and the stage in flight, then the traces under it; signed in, they
 *   pick a roaster and start one.
 * UNLISTED: no nav link, no footer link, no sitemap entry. Reachable by URL
 *   on purpose; it is a workbench, not a feature.
 */

const RunView = ({ run }: { run: Run | null | undefined }) => {
	if (run === undefined) {
		return (
			<div className="py-24">
				<Loader />
			</div>
		);
	}
	if (run === null) {
		return (
			<p className="text-muted-foreground mt-12 text-sm leading-snug md:mt-16 md:text-[15px]">
				No run yet. Pick a roaster and start one; the traces from the
				sweep&apos;s own reads will show under it as they land.
			</p>
		);
	}
	return (
		<div className="mt-12 flex flex-col gap-12 md:mt-16 md:gap-16">
			<StatStrip run={run} />
			<LiveRow run={run} />
		</div>
	);
};

const TraceBody = ({
	empty,
	onSelect,
	selected,
	traces,
}: {
	empty: string;
	onSelect: (id: Trace["_id"]) => void;
	selected: Trace | null;
	traces: Trace[] | undefined;
}) => {
	if (traces === undefined) {
		return (
			<div className="py-12">
				<Loader />
			</div>
		);
	}
	if (traces.length === 0) {
		return (
			<p className="text-muted-foreground mt-6 text-sm leading-snug md:text-[15px]">
				{empty}
			</p>
		);
	}
	return (
		<div
			className={`mt-6 grid gap-10 ${selected === null ? "" : "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-12"}`}
		>
			<ul className="border-t">
				{traces.map((trace) => (
					<TraceRow
						key={trace._id}
						onSelect={() => {
							onSelect(trace._id);
						}}
						selected={trace._id === selected?._id}
						trace={trace}
					/>
				))}
			</ul>
			{selected !== null && <TraceDetail trace={selected} />}
		</div>
	);
};

/**
 * A list of traces beside the selected one's detail: two columns from `md`,
 * stacked below it with the detail under the list. Selecting a row that is
 * already open closes it.
 */
const TraceList = ({
	empty,
	title,
	traces,
}: {
	empty: string;
	title: string;
	traces: Trace[] | undefined;
}) => {
	const [selectedId, setSelectedId] = useState<Trace["_id"] | null>(null);
	const selected = traces?.find((trace) => trace._id === selectedId) ?? null;
	return (
		<section>
			<h2 className="text-xl leading-tight md:text-2xl">
				{title}
				{traces !== undefined && traces.length > 0 && (
					<span className="text-muted-foreground tnum ml-2 text-xs">
						({traces.length})
					</span>
				)}
			</h2>
			<TraceBody
				empty={empty}
				onSelect={(id) => {
					setSelectedId((current) => (current === id ? null : id));
				}}
				selected={selected}
				traces={traces}
			/>
		</section>
	);
};

const NerdStuffComponent = () => {
	const { run: runParam } = useSearch({ from: "/nerd-stuff" });
	const navigate = useNavigate({ from: "/nerd-stuff" });
	const picked = useQuery(
		api.nerdStuff.run,
		runParam === undefined ? "skip" : { runId: runParam }
	);
	const latest = useQuery(
		api.nerdStuff.latestRun,
		runParam === undefined ? {} : "skip"
	);
	const run = runParam === undefined ? latest : picked;
	const roasters = useQuery(api.roasters.listActive);
	const runTraces = useQuery(
		api.nerdStuff.traces,
		run === undefined || run === null ? "skip" : { runId: run._id }
	);
	const recent = useQuery(api.nerdStuff.recentTraces, { limit: TAIL_LIMIT });
	const roasterName =
		run === undefined || run === null
			? undefined
			: roasters?.find((roaster) => roaster.id === run.roasterId)?.name;

	return (
		<main>
			<div className="px-5 pt-10 md:px-10 md:pt-14">
				<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
					<h1 className="font-serif text-[2rem] leading-none font-normal md:text-[2.75rem]">
						Nerd stuff
						{roasterName !== undefined && (
							<span className="text-muted-foreground ml-2 font-sans text-sm font-normal">
								{roasterName}
							</span>
						)}
					</h1>
				</div>
				<p className="text-muted-foreground mt-3 max-w-prose text-sm leading-snug md:text-[15px]">
					Every page read leaves a trace: what Jev was asked, what it answered,
					what the cut kept. A run reads up to ten of one roaster&apos;s lots
					and writes nothing unless you say so.
				</p>
				<div className="mt-10 md:mt-12">
					<RoasterPicker
						onStarted={(runId) => {
							void navigate({ search: { run: runId } });
						}}
						run={run ?? null}
					/>
				</div>
				<RunView run={run} />
				<div className="mt-16 flex flex-col gap-16 md:mt-24 md:gap-24">
					{run !== undefined && run !== null && (
						<TraceList
							empty="No lot has finished yet. A trace lands when a read ends."
							title="This run"
							traces={runTraces}
						/>
					)}
					<TraceList
						empty="No reads in the last three days."
						title="Recent reads"
						traces={recent}
					/>
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
