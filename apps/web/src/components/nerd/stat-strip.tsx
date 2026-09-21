import type { api } from "@nouveau/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type Run = NonNullable<FunctionReturnType<typeof api.nerdStuff.run>>;

const Stat = ({ label, value }: { label: string; value: string }) => (
	<div className="bg-foreground text-background flex flex-col gap-1.5 px-3 py-2.5">
		<dt className="label-caps text-[10px] opacity-70">{label}</dt>
		<dd className="text-base leading-none md:text-lg">{value}</dd>
	</div>
);

export const shortMs = (value: number): string =>
	value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;

/**
 * The run's totals as six small ink cells (the one ink on the page, like
 * `button-primary`): questions asked, Jev requests, Jev time, time per
 * question, page time, and read / deferred / failed. Every number tabular.
 */
export const StatStrip = ({ run }: { run: Run }) => {
	const perQuestion =
		run.jevQuestions > 0 ? shortMs(run.jevMs / run.jevQuestions) : "–";
	return (
		<dl className="grid grid-cols-3 gap-1">
			<Stat label="Questions" value={run.jevQuestions.toLocaleString()} />
			<Stat label="Requests" value={run.jevRequests.toLocaleString()} />
			<Stat label="Jev time" value={shortMs(run.jevMs)} />
			<Stat label="Per question" value={perQuestion} />
			<Stat label="Page time" value={shortMs(run.pageMs)} />
			<Stat
				label="Read · def · fail"
				value={`${run.read} · ${run.deferred} · ${run.failed}`}
			/>
		</dl>
	);
};
