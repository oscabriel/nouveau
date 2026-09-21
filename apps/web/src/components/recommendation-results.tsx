import { useUIMessages } from "@convex-dev/agent/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Button } from "@nouveau/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { SaveButton } from "@/components/save-button";
import { thumbUrl } from "@/lib/drops";
import { describeMutationError } from "@/lib/errors";
import { formatPrice } from "@/lib/format";

type Run = NonNullable<FunctionReturnType<typeof api.recommendations.latest>>;
type PickRow = Run["picks"][number];
type ThreadPage = NonNullable<
	FunctionReturnType<typeof api.recommendationThreads.list>
>["page"];
type ThreadMessage = ThreadPage[number];
type MessagePart = ThreadMessage["parts"][number];

interface Step {
	detail: string;
	key: string;
	label: string;
}

/**
 * One step line (ADR-0017): a tool call rendered as a fact the app
 * produced, in tabular figures. The user's prompt and the model's prose are
 * not steps.
 */

/** Tool-call parts carry `type: "tool-${name}"` (AI SDK wire shape). */
const isToolPart = (part: unknown): part is Record<string, unknown> =>
	typeof part === "object" &&
	part !== null &&
	typeof (part as MessagePart).type === "string" &&
	(part as MessagePart).type.startsWith("tool-");

const readString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
	typeof value === "number" && Number.isFinite(value) ? value : undefined;

const readRecord = (value: unknown): Record<string, unknown> =>
	typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};

const readArray = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];

/** The typed filters as a short list: "floral, washed, under $20, 250 g up to 350 g". */
const filtersDetail = (input: Record<string, unknown>): string[] => {
	const parts: string[] = [];
	for (const field of ["flavour", "origin", "process"] as const) {
		const value = readString(input[field]);
		if (value !== undefined) {
			parts.push(value);
		}
	}
	const cents = readNumber(input.maxPriceCents);
	if (cents !== undefined) {
		parts.push(`under $${(cents / 100).toFixed(0)}`);
	}
	const min = readNumber(input.minGrams);
	const max = readNumber(input.maxGrams);
	if (min !== undefined || max !== undefined) {
		const floor = min === undefined ? "any size" : `${min} g`;
		const ceiling = max === undefined ? "" : ` up to ${max} g`;
		parts.push(`${floor}${ceiling}`);
	}
	return parts;
};

const searchDetail = (part: Record<string, unknown>): string => {
	const input = readRecord(part.input);
	const parts = filtersDetail(input);
	const query = readString(input.query);
	if (typeof query === "string" && query.length > 0) {
		parts.push(`“${query}”`);
	}
	const lots = readArray(readRecord(part.output).lots);
	if (lots.length > 0) {
		parts.push(`${lots.length} lots`);
	}
	return parts.join(", ");
};

const availabilityDetail = (part: Record<string, unknown>): string => {
	const output = readRecord(part.output);
	const price = readNumber(output.priceCents);
	if (output.available === true) {
		return price === undefined ? "in stock" : `in stock, ${formatPrice(price)}`;
	}
	return "no longer available at the recorded price";
};

const readLotDetail = (part: Record<string, unknown>): string =>
	readString(readRecord(part.output).note) ?? "";

const readLogsDetail = (part: Record<string, unknown>): string => {
	const logs = readArray(readRecord(part.output).logs);
	return `${logs.length} logs`;
};

const handoffDetail = (part: Record<string, unknown>): string => {
	const picks = readArray(readRecord(part.input).picks);
	return `${picks.length} picks`;
};

const stepFromPart = (
	part: Record<string, unknown>,
	index: number,
	message: ThreadMessage
): Step => {
	const state = readString(part.state) ?? "";
	const name =
		part.type === "dynamic-tool"
			? (readString(part.toolName) ?? "tool")
			: String(part.type).slice("tool-".length);
	const key = `${message.key}:${index}`;
	let label = name;
	let detail = "";
	if (state === "input-streaming" || state === "input-available") {
		detail = "working";
	} else if (state === "output-error") {
		detail = "failed";
	} else if (name === "searchCatalog") {
		label = "Search";
		detail = searchDetail(part);
	} else if (name === "readLotFacts") {
		label = "Page read";
		detail = readLotDetail(part);
	} else if (name === "checkAvailability") {
		label = "Checked";
		detail = availabilityDetail(part);
	} else if (name === "readMyLogs") {
		label = "Read your logs";
		detail = readLogsDetail(part);
	} else if (name === "submitPicks") {
		label = "Handoff";
		detail = handoffDetail(part);
	}
	return { detail, key, label };
};

/** Tool-call parts across the thread, in message order. */
const stepsFromMessages = (messages: ThreadPage): Step[] =>
	messages.flatMap((message) =>
		message.parts
			.map((part, index) => ({ index, message, part }))
			.filter(({ part }) => isToolPart(part))
			.map(({ index, part }) => stepFromPart(part, index, message))
	);

const StepList = ({ messages }: { messages: ThreadPage }) => (
	<ul aria-live="polite" className="mt-3 space-y-1">
		{stepsFromMessages(messages).map((step) => (
			<li className="text-muted-foreground flex gap-3 text-sm" key={step.key}>
				<span className="label-caps shrink-0 pt-0.5">{step.label}</span>
				<span className="tnum [overflow-wrap:anywhere]">{step.detail}</span>
			</li>
		))}
	</ul>
);

/**
 * The candidate's page on Nouveau, addressed by the (roaster, lot) pair
 * (ADR-0011). Runs stored before the field carry no handle or roaster slug,
 * so those fall back to the roaster's own product page.
 */
const CandidateLink = ({
	className,
	owner,
	row,
}: {
	className: string;
	/** "name" links the lot name; "page" links the actions row. */
	owner: "name" | "page";
	row: PickRow;
}) => {
	const { candidate } = row;
	if (candidate.handle === undefined || candidate.roasterSlug === undefined) {
		return (
			<a
				className={className}
				href={candidate.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{owner === "name" ? candidate.name : "Read the source page"}
			</a>
		);
	}
	return (
		<Link
			className={className}
			params={{ lot: candidate.handle, roaster: candidate.roasterSlug }}
			to="/roaster/$roaster/$lot"
		>
			{owner === "name" ? candidate.name : "Coffee page and logs"}
		</Link>
	);
};

const PickCard = ({ row, runId }: { row: PickRow; runId: Run["id"] }) => {
	const { candidate, canBuy, imageUrl, pick } = row;
	return (
		<article className="grid gap-x-6 gap-y-4 py-6 sm:grid-cols-[160px_1fr]">
			<div className="bg-muted aspect-[3/2]">
				{imageUrl !== null && (
					<img
						alt={candidate.name}
						className="h-full w-full object-cover"
						loading="lazy"
						src={thumbUrl(imageUrl, 600)}
					/>
				)}
			</div>
			<div className="min-w-0">
				<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
					<h3 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
						<CandidateLink className="hover:underline" owner="name" row={row} />
					</h3>
					<p className="tnum shrink-0 text-sm">
						{`${formatPrice(candidate.priceCents)} USD · ${candidate.variantName} (${candidate.grams} g)`}
					</p>
				</div>
				<p className="text-muted-foreground mt-1 text-sm">
					{candidate.roasterName}
				</p>
				<p className="mt-3 text-sm [overflow-wrap:anywhere]">
					<span className="label-caps text-muted-foreground mr-2">OpenAI</span>
					{pick.why}
				</p>
				{!canBuy && (
					<p className="text-muted-foreground mt-2 text-sm">
						This size, price or availability can no longer be confirmed. Check
						the source before deciding.
					</p>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
					<SaveButton fromRunId={runId} lotId={candidate.productId} />
					<CandidateLink
						className="label-caps inline-flex min-h-11 items-center"
						owner="page"
						row={row}
					/>
					<a
						className="label-caps inline-flex min-h-11 items-center underline-offset-4 hover:underline"
						href={candidate.url}
						rel="noopener noreferrer"
						target="_blank"
					>
						{canBuy ? "See this coffee at the roaster" : "Read the source page"}
					</a>
				</div>
			</div>
		</article>
	);
};

/** The finished run's step record, folded away; nothing when there is none. */
const HowItLooked = ({ messages }: { messages: ThreadPage }) => {
	if (stepsFromMessages(messages).length === 0) {
		return null;
	}
	return (
		<details className="text-sm">
			<summary className="label-caps min-h-11 cursor-pointer py-3">
				How it looked
			</summary>
			<StepList messages={messages} />
		</details>
	);
};

export const RecommendationResults = ({ run }: { run: Run | null }) => {
	const retry = useMutation(api.recommendations.retry);
	const [retrying, setRetrying] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	// The thread is the run's HOW IT LOOKED record (ADR-0017); steps stream
	// in while the loop works.
	const thread = useUIMessages(
		api.recommendationThreads.list,
		run?.threadId !== undefined && run?.threadId !== null
			? { threadId: run.threadId }
			: "skip",
		{ initialNumItems: 24, stream: true }
	);
	if (!run) {
		return null;
	}
	const working = run.status === "queued" || run.status === "running";
	const messages: ThreadPage = thread.results ?? [];
	const retryRun = async () => {
		setRetrying(true);
		setFailure(null);
		try {
			await retry({ runId: run.id });
		} catch (error) {
			setFailure(
				`${describeMutationError(error, "Could not retry.")} Your request is saved.`
			);
		}
		setRetrying(false);
	};
	return (
		<section
			aria-labelledby="shortlist-heading"
			className="mt-10 border-t pt-6"
		>
			<h2 className="text-xl font-semibold" id="shortlist-heading">
				Your latest shortlist
			</h2>
			<p className="text-muted-foreground mt-2 flex items-start gap-2 text-sm">
				{working && (
					<span
						aria-hidden
						className="bg-foreground mt-1.5 inline-block size-2 shrink-0 rounded-full motion-safe:animate-pulse"
					/>
				)}
				{run.message}
			</p>
			{working && <StepList messages={messages} />}
			{run.status === "ready" && run.picks.length === 0 && (
				<p className="mt-4">
					Nothing in the catalog fits the request yet. Describe it differently,
					or{" "}
					<Link className="underline underline-offset-4" to="/roasters">
						browse the roasters
					</Link>
					.
				</p>
			)}
			{run.picks.length > 0 && (
				<div className="divide-y">
					{run.picks.map((row) => (
						<PickCard key={row.candidate.productId} row={row} runId={run.id} />
					))}
				</div>
			)}
			{!working && <HowItLooked messages={messages} />}
			{run.canRetry && (
				<div className="mt-4">
					<p className="text-sm">
						A retry uses this saved request, not the box above.{" "}
						{run.input.includeNotes
							? "It includes your logs."
							: "It does not include your logs."}
					</p>
					<Button
						className="mt-4 min-h-11"
						disabled={retrying}
						onClick={() => {
							void retryRun();
						}}
						type="button"
						variant="outline"
					>
						{retrying ? "Retrying..." : "Retry this request once"}
					</Button>
				</div>
			)}
			{failure && (
				<p className="text-destructive mt-3 text-sm" role="alert">
					{failure}
				</p>
			)}
			{run.model && (
				<p className="text-muted-foreground mt-3 text-xs">
					Runtime model: {run.model}. Prices and availability come from the
					catalog, not the model.
				</p>
			)}
		</section>
	);
};
