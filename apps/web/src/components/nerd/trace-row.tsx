import type { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight } from "lucide-react";

export type Trace = FunctionReturnType<
	typeof api.nerdStuff.recentTraces
>[number];

const OUTCOME_WORD: Record<Trace["outcome"], string> = {
	deferred: "Deferred",
	failed: "Failed",
	no_key: "No key",
	read: "Read",
};

/** Milliseconds as a short tabular readout: 812 ms, 4.1 s. */
export const formatMs = (value: number | undefined): string | null => {
	if (value === undefined) {
		return null;
	}
	return value >= 1000
		? `${(value / 1000).toFixed(1)} s`
		: `${Math.round(value)} ms`;
};

/** A field name as the page shows it: `roastLevel` reads "roast level". */
export const fieldLabel = (field: string): string =>
	field
		.replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
		.toLowerCase()
		.replace("origin country", "origin");

/**
 * The facts a row leads with, as plain text: the vocabulary Choices Jev
 * settled (not_stated left out), then the kept line picks, then the kept
 * notes. Text, never chips.
 */
export const headlineFacts = (trace: Trace): string[] => {
	const canonical = trace.canonical
		.filter((choice) => choice.choice !== "not_stated")
		.map((choice) => choice.choice.replaceAll("_", " "));
	const picks = trace.picks
		.filter((pick) => pick.kept && pick.cut !== undefined)
		.map((pick) => pick.cut as string);
	const notes = trace.notes
		.filter((note) => note.kept)
		.map((note) => note.note);
	return [...new Set([...canonical, ...picks, ...notes])];
};

/**
 * One read, one row: the lot's name in ink, the outcome word in grey, the
 * headline facts as one grey line, page and Jev time at the right in
 * tabular figures. Pressing the row selects it for the detail; the arrow
 * at the end is the link into the lot's page when the lot still exists.
 */
export const TraceRow = ({
	onSelect,
	selected,
	trace,
}: {
	onSelect: () => void;
	selected: boolean;
	trace: Trace;
}) => {
	const facts = headlineFacts(trace);
	const page = formatMs(trace.stages.page);
	const jev = formatMs(trace.stages.jev);
	return (
		<li
			className={`hover:bg-muted focus-within:bg-muted flex items-start gap-3 border-b transition-colors ${
				selected ? "bg-muted" : ""
			}`}
		>
			<button
				aria-pressed={selected}
				className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 py-5 pr-2 text-left"
				onClick={onSelect}
				type="button"
			>
				<span className="truncate text-sm leading-snug md:text-[15px]">
					{trace.name}
				</span>
				<span className="label-caps text-muted-foreground pt-0.5 text-right">
					{OUTCOME_WORD[trace.outcome]}
					{trace.deferrals !== undefined && trace.deferrals > 0 && (
						<span className="tnum ml-2">· {trace.deferrals}× deferred</span>
					)}
				</span>
				<span className="text-muted-foreground truncate text-sm leading-snug">
					{trace.error ?? (facts.length > 0 ? facts.join(" · ") : "—")}
				</span>
				<span className="tnum text-muted-foreground text-right text-xs leading-snug">
					{page !== null && <span>page {page}</span>}
					{page !== null && jev !== null && <span> · </span>}
					{jev !== null && <span>jev {jev}</span>}
				</span>
			</button>
			<span className="flex w-6 shrink-0 items-start justify-end py-5">
				{trace.handle !== null && trace.roasterSlug !== null && (
					<Link
						aria-label={`Open ${trace.name}`}
						className="text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center"
						params={{ lot: trace.handle, roaster: trace.roasterSlug }}
						to="/roaster/$roaster/$lot"
					>
						<ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
					</Link>
				)}
			</span>
		</li>
	);
};
