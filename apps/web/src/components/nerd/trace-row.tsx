import type { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowRight } from "lucide-react";

import { formatMs } from "@/lib/format";

export type Trace = FunctionReturnType<
	typeof api.nerdStuff.recentTraces
>[number];

const OUTCOME_WORD: Record<Trace["outcome"], string> = {
	deferred: "Deferred",
	failed: "Failed",
	no_key: "No key",
	read: "Read",
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
		.filter(
			(pick): pick is Trace["picks"][number] & { cut: string } =>
				pick.kept && pick.cut !== undefined
		)
		.map((pick) => pick.cut);
	const notes = trace.notes
		.filter((note) => note.kept)
		.map((note) => note.note);
	return [...new Set([...canonical, ...picks, ...notes])];
};

const Meta = ({ trace }: { trace: Trace }) => {
	const parts: string[] = [];
	if (trace.stages.page !== undefined) {
		parts.push(`page ${formatMs(trace.stages.page)}`);
	}
	if (trace.stages.jev !== undefined) {
		parts.push(`jev ${formatMs(trace.stages.jev)}`);
	}
	if (trace.questionCount !== undefined) {
		parts.push(`${trace.questionCount} q`);
	}
	if (trace.source !== undefined) {
		parts.push(trace.source);
	}
	if (trace.deferrals !== undefined && trace.deferrals > 0) {
		parts.push(`deferred ${trace.deferrals}×`);
	}
	return (
		<span className="text-muted-foreground text-xs">{parts.join(" · ")}</span>
	);
};

/**
 * One read, one row, dense: the outcome word in caps at the left, the
 * lot's name in ink, the timings under it in grey, the headline facts
 * wrapping as one grey line. The row is one button that selects it for
 * the detail (every per-fact probability lives there); the arrow at the
 * right is the link into the lot's page.
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
	return (
		<li
			className={`hover:bg-muted focus-within:bg-muted border-b transition-colors ${
				selected ? "bg-muted" : ""
			}`}
		>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-3">
				<button
					aria-pressed={selected}
					className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-x-3 text-left"
					onClick={onSelect}
					type="button"
				>
					<span className="label-caps text-muted-foreground min-h-5 pt-0.5 text-[10px]">
						{OUTCOME_WORD[trace.outcome]}
					</span>
					<span className="min-w-0">
						<span className="block text-[13px] leading-snug">{trace.name}</span>
						<Meta trace={trace} />
						<span className="text-muted-foreground mt-1 block text-xs leading-snug">
							{trace.error ??
								(facts.length > 0 ? facts.join(" · ") : "nothing kept")}
						</span>
					</span>
				</button>
				{trace.handle !== null && trace.roasterSlug !== null && (
					<Link
						aria-label={`Open ${trace.name}`}
						className="text-muted-foreground hover:text-foreground inline-flex size-5 items-center justify-center"
						params={{ lot: trace.handle, roaster: trace.roasterSlug }}
						to="/roaster/$roaster/$lot"
					>
						<ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
					</Link>
				)}
			</div>
		</li>
	);
};
