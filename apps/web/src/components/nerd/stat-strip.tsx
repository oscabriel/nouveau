import type { api } from "@nouveau/backend/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

export type Run = NonNullable<FunctionReturnType<typeof api.nerdStuff.run>>;

const Stat = ({ label, value }: { label: string; value: string }) => (
	<div className="flex flex-col gap-2">
		<dt className="label-caps opacity-70">{label}</dt>
		<dd className="tnum text-lg leading-none md:text-2xl">{value}</dd>
	</div>
);

const ms = (value: number): string =>
	value >= 10_000
		? `${(value / 1000).toFixed(1)} s`
		: `${Math.round(value).toLocaleString()} ms`;

/**
 * The run's totals as one inverted strip (ink ground, page-colored type,
 * like `button-primary`): questions asked, Jev requests, Jev time, time per
 * question, page time, and the read / deferred / failed counts. The one
 * block of ink on the page; every number is tabular.
 */
export const StatStrip = ({ run }: { run: Run }) => {
	const perQuestion =
		run.jevQuestions > 0 ? ms(run.jevMs / run.jevQuestions) : "–";
	return (
		<dl className="bg-foreground text-background grid grid-cols-2 gap-x-6 gap-y-6 px-5 py-5 sm:grid-cols-3 md:grid-cols-6 md:px-6 md:py-6">
			<Stat label="Questions" value={run.jevQuestions.toLocaleString()} />
			<Stat label="Jev requests" value={run.jevRequests.toLocaleString()} />
			<Stat label="Jev time" value={ms(run.jevMs)} />
			<Stat label="Per question" value={perQuestion} />
			<Stat label="Page time" value={ms(run.pageMs)} />
			<Stat
				label="Read · deferred · failed"
				value={`${run.read} · ${run.deferred} · ${run.failed}`}
			/>
		</dl>
	);
};
