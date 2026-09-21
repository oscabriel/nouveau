import type { ReactNode } from "react";

import { fieldLabel, formatMs, headlineFacts } from "./trace-row";
import type { Trace } from "./trace-row";

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
	<div className="grid grid-cols-[minmax(0,1fr)_3rem] items-center gap-x-4 gap-y-1 border-b py-3 sm:grid-cols-[7rem_minmax(0,1fr)_5rem_3rem_4rem]">
		<span className="label-caps text-muted-foreground col-span-2 sm:col-span-1">
			{label}
		</span>
		<span
			className={`min-w-0 text-sm leading-snug ${
				kept === false
					? "text-muted-foreground line-through decoration-current/60"
					: ""
			}`}
		>
			{value}
			{aside !== undefined && (
				<span className="text-muted-foreground ml-2 no-underline">{aside}</span>
			)}
		</span>
		<span className="hidden sm:block">
			<Bar probability={probability} />
		</span>
		<span className="tnum text-muted-foreground text-right text-xs">
			{pct(probability)}
		</span>
		{kept !== undefined && (
			<span
				className={`label-caps col-span-2 text-right sm:col-span-1 ${
					kept ? "" : "text-muted-foreground"
				}`}
			>
				{kept ? "Kept" : "Dropped"}
			</span>
		)}
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
			<h3 className="text-lg leading-tight md:text-xl">{title}</h3>
			{detail !== undefined && detail !== null && (
				<span className="tnum text-muted-foreground text-xs">{detail}</span>
			)}
		</div>
		<div className="mt-3">{children}</div>
	</section>
);

const Empty = ({ children }: { children: ReactNode }) => (
	<p className="text-muted-foreground border-b py-3 text-sm leading-snug">
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
		<div className="flex flex-col gap-10">
			<div>
				<h2 className="text-xl leading-tight md:text-2xl">{trace.name}</h2>
				<p className="text-muted-foreground tnum mt-2 text-xs">
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
					<p className="mt-3 text-sm leading-snug">{trace.error}</p>
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

			<Section detail={formatMs(trace.stages.jev)} title="Line picks">
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
					trace.notes.map((note) => (
						<Judgment
							key={note.note}
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
					trace.sentences.map((sentence) => (
						<Judgment
							key={sentence.sentence}
							kept={sentence.kept}
							label="Sentence"
							probability={sentence.probability}
							value={sentence.sentence}
						/>
					))
				)}
			</Section>

			<Section detail={formatMs(trace.stages.page)} title="Result">
				{merged.length === 0 ? (
					<Empty>Nothing stored from this read.</Empty>
				) : (
					<p className="border-b py-3 text-sm leading-snug md:text-[15px]">
						{merged.join(" · ")}
					</p>
				)}
			</Section>
		</div>
	);
};
