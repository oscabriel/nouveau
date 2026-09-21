import type { ReactNode } from "react";

import { formatMs } from "@/lib/format";

import { fieldLabel, headlineFacts } from "./trace-row";
import type { Trace } from "./trace-row";

/** A stage's time, or nothing when the stage did not run. */
const stageMs = (value: number | undefined): string | null =>
	value === undefined ? null : formatMs(value);

const pct = (p: number | undefined): string =>
	p === undefined ? "–" : `${Math.round(p * 100)}%`;

/** A probability as ink on a 2px hairline track, square corners. */
const Bar = ({ probability }: { probability: number | undefined }) => (
	<span aria-hidden className="bg-border relative block h-0.5 w-full">
		{probability !== undefined && (
			<span
				className="bg-foreground absolute inset-y-0 left-0"
				style={{ width: `${Math.max(0, Math.min(1, probability)) * 100}%` }}
			/>
		)}
	</span>
);

const keptWord = (kept: boolean | undefined): string => {
	if (kept === undefined) {
		return "";
	}
	return kept ? "Kept" : "Dropped";
};

/**
 * One judgment: caps label, the value (grey and struck through when the
 * verifier dropped it), the runner-up in grey after it, the bar, the
 * probability in tabular figures, and KEPT or DROPPED when that applies.
 */
const Judgment = ({
	aside,
	kept,
	label,
	probability,
	value,
}: {
	aside?: string;
	kept?: boolean;
	label: string;
	probability: number | undefined;
	value: string;
}) => (
	<div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3.5rem_2.5rem_3.5rem] items-center gap-x-2 border-b py-1.5 text-xs">
		<span className="label-caps text-muted-foreground truncate text-[10px]">
			{label}
		</span>
		<span
			className={`min-w-0 leading-snug ${
				kept === false
					? "text-muted-foreground line-through decoration-current/60"
					: ""
			}`}
		>
			{value}
			{aside !== undefined && (
				<span className="text-muted-foreground ml-1.5 no-underline">
					{aside}
				</span>
			)}
		</span>
		<Bar probability={probability} />
		<span className="tnum text-muted-foreground text-right text-xs">
			{pct(probability)}
		</span>
		<span
			className={`label-caps text-right text-[10px] ${
				kept === true ? "" : "text-muted-foreground"
			}`}
		>
			{keptWord(kept)}
		</span>
	</div>
);

const Section = ({
	children,
	detail,
	title,
}: {
	children: ReactNode;
	detail?: string | null;
	title: string;
}) => (
	<section>
		<div className="flex items-baseline justify-between gap-4">
			<h3 className="label-caps">{title}</h3>
			{detail !== undefined && detail !== null && (
				<span className="tnum text-muted-foreground text-xs">{detail}</span>
			)}
		</div>
		<div className="mt-1">{children}</div>
	</section>
);

const Empty = ({ children }: { children: ReactNode }) => (
	<p className="text-muted-foreground border-b py-1.5 text-xs leading-snug">
		{children}
	</p>
);

const runnerUpText = (
	runnerUp: { option: string; probability: number } | undefined
): string | undefined =>
	runnerUp === undefined || runnerUp.probability < 0.01
		? undefined
		: `${runnerUp.option} ${pct(runnerUp.probability)}`;

/** The pick as shown: the cut value, then the line it came from when they differ. */
const pickValue = (pick: Trace["picks"][number]): string => {
	if (pick.line === undefined) {
		return "none of these";
	}
	if (pick.cut !== undefined && pick.cut !== pick.line) {
		return `${pick.cut} (from "${pick.line}")`;
	}
	return pick.line;
};

/**
 * One trace, grouped by the mechanism that produced each part (ADR-0018):
 * the feed regex, the gate's shadow answer, Jev's line picks per field,
 * the vocabulary Choices, the per-note Nouls, the sentence Nouls, and the
 * merged result. Every probability is a bar; every dropped candidate is
 * struck through in grey. Nothing here is a chip.
 */
export const TraceDetail = ({ trace }: { trace: Trace }) => {
	const merged = headlineFacts(trace);
	const notesKept = trace.notes.filter((note) => note.kept).length;
	const sentencesKept = trace.sentences.filter((s) => s.kept).length;
	return (
		<div className="flex flex-col gap-5">
			<div>
				<h2 className="text-[15px] leading-snug">{trace.name}</h2>
				<p className="text-muted-foreground tnum mt-1 text-xs">
					{[
						trace.source !== undefined && `${trace.source} page`,
						trace.pageChars !== undefined &&
							`${trace.pageChars.toLocaleString()} chars`,
						trace.questionCount !== undefined &&
							`${trace.questionCount} questions`,
						trace.optionCount !== undefined &&
							`${trace.optionCount} options each`,
						trace.model,
					]
						.filter((part): part is string => typeof part === "string")
						.join(" · ")}
				</p>
				{trace.error !== undefined && (
					<p className="mt-2 text-xs leading-snug">{trace.error}</p>
				)}
			</div>

			<Section title="Feed">
				{trace.feed === undefined ? (
					<Empty>The feed pass was not replayed for this read.</Empty>
				) : (
					<>
						<Judgment
							label="Is a lot"
							probability={trace.feed.isLot ? 1 : 0}
							value={
								trace.feed.isLot ? `yes, ${trace.feed.rule}` : trace.feed.rule
							}
						/>
						{trace.feed.attributes.map((attribute) => (
							<Judgment
								key={attribute.field}
								label={fieldLabel(attribute.field)}
								probability={undefined}
								value={attribute.value}
							/>
						))}
						{trace.feed.notes !== undefined && (
							<Judgment
								label="Notes"
								probability={undefined}
								value={trace.feed.notes}
							/>
						)}
					</>
				)}
			</Section>

			<Section title="Gate">
				{trace.gate === undefined ? (
					<Empty>
						No shadow answer; the gate only asks Jev about items the regex
						rejected.
					</Empty>
				) : (
					<Judgment
						aside={trace.gate.agreed ? "agreed" : "disagreed with the feed"}
						label="Coffee?"
						probability={trace.gate.coffeeProbability}
						value={trace.gate.jevChoice}
					/>
				)}
			</Section>

			<Section detail={stageMs(trace.stages.jev)} title="Line picks">
				{trace.picks.length === 0 ? (
					<Empty>Jev was not asked to pick lines.</Empty>
				) : (
					trace.picks.map((pick) => (
						<Judgment
							aside={runnerUpText(pick.runnerUp)}
							key={pick.field}
							kept={pick.line === undefined ? undefined : pick.kept}
							label={fieldLabel(pick.field)}
							probability={pick.probability}
							value={pickValue(pick)}
						/>
					))
				)}
			</Section>

			<Section title="Vocabulary">
				{trace.canonical.length === 0 ? (
					<Empty>No vocabulary Choice was asked.</Empty>
				) : (
					trace.canonical.map((choice) => (
						<Judgment
							aside={runnerUpText(choice.runnerUp)}
							key={choice.field}
							kept={choice.choice === "not_stated" ? false : undefined}
							label={fieldLabel(choice.field)}
							probability={choice.probability}
							value={choice.choice.replaceAll("_", " ")}
						/>
					))
				)}
			</Section>

			<Section
				detail={
					trace.notes.length === 0
						? null
						: `${notesKept} of ${trace.notes.length} kept`
				}
				title="Notes"
			>
				{trace.notes.length === 0 ? (
					<Empty>No note candidates on the page.</Empty>
				) : (
					// A trace is immutable once written, so the position is a stable key;
					// the text is not, since two sentences on a page can read the same.
					trace.notes.map((note, i) => (
						<Judgment
							key={i}
							kept={note.kept}
							label="Note"
							probability={note.probability}
							value={note.note}
						/>
					))
				)}
			</Section>

			<Section
				detail={
					trace.sentences.length === 0
						? null
						: `${sentencesKept} of ${trace.sentences.length} kept`
				}
				title="Sentences"
			>
				{trace.sentences.length === 0 ? (
					<Empty>No description sentences were judged.</Empty>
				) : (
					trace.sentences.map((sentence, i) => (
						<Judgment
							key={i}
							kept={sentence.kept}
							label="Sentence"
							probability={sentence.probability}
							value={sentence.sentence}
						/>
					))
				)}
			</Section>

			<Section detail={stageMs(trace.stages.page)} title="Result">
				{merged.length === 0 ? (
					<Empty>Nothing stored from this read.</Empty>
				) : (
					<p className="border-b py-1.5 text-xs leading-snug">
						{merged.join(" · ")}
					</p>
				)}
			</Section>
		</div>
	);
};
