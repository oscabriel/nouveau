import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import {
	createFileRoute,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";

import Loader from "@/components/loader";
import { LiveRow } from "@/components/nerd/live-row";
import { RoasterPicker } from "@/components/nerd/roaster-picker";
import { StatStrip } from "@/components/nerd/stat-strip";
import type { Run } from "@/components/nerd/stat-strip";

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
