import { useUIMessages } from "@convex-dev/agent/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

import { SaveButton } from "@/components/save-button";
import { thumbUrl } from "@/lib/drops";
import { describeMutationError } from "@/lib/errors";
import { formatPrice } from "@/lib/format";
import { navLinkClass } from "@/lib/ui";

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

// ---------------------------------------------------------------------------
// Steps: one line per tool call (ADR-0017), a fact the app produced, in
// tabular figures. The user's prompt and the model's prose are not steps,
// and neither is a pickLot call: the card it produced is its line. The
// steps show while the loop works and go when it settles.
// ---------------------------------------------------------------------------

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

/**
 * "“floral washed”, under $20, 250 g up to 350 g, 12 lots". The budget and
 * size come from the tool's output (`applied`), not the model's arguments:
 * a value the model sent at a field's ceiling is no limit and the tool
 * drops it.
 */
const searchDetail = (part: Record<string, unknown>): string => {
	const input = readRecord(part.input);
	const output = readRecord(part.output);
	const applied = readRecord(output.applied);
	const parts: string[] = [];
	const query = readString(input.query);
	if (query !== undefined && query.length > 0) {
		parts.push(`“${query}”`);
	}
	const cents = readNumber(applied.maxPriceCents);
	if (cents !== undefined) {
		parts.push(`under $${(cents / 100).toFixed(0)}`);
	}
	const min = readNumber(applied.minGrams);
	const max = readNumber(applied.maxGrams);
	if (min !== undefined || max !== undefined) {
		const floor = min === undefined ? "any size" : `${min} g`;
		const ceiling = max === undefined ? "" : ` up to ${max} g`;
		parts.push(`${floor}${ceiling}`);
	}
	const lots = readArray(output.lots);
	parts.push(`${lots.length} lots`);
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

const readLogsDetail = (part: Record<string, unknown>): string =>
	`${readArray(readRecord(part.output).logs).length} logs`;

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
		label = "Your logs";
		detail = readLogsDetail(part);
	}
	return { detail, key, label };
};

/** Tool-call parts across the thread, in message order. */
const isPickPart = (part: Record<string, unknown>): boolean =>
	part.type === "tool-pickLot" || part.toolName === "pickLot";

const stepsFromMessages = (messages: ThreadPage): Step[] =>
	messages.flatMap((message) =>
		message.parts
			.map((part, index) => ({ index, message, part }))
			.filter(({ part }) => isToolPart(part) && !isPickPart(part))
			.map(({ index, part }) => stepFromPart(part, index, message))
	);

const StepList = ({ steps }: { steps: Step[] }) => (
	<ul aria-live="polite" className="space-y-1">
		{steps.map((step) => (
			<li
				className="text-muted-foreground flex gap-3 text-xs leading-snug"
				key={step.key}
			>
				<span className="label-caps w-16 shrink-0 pt-px">{step.label}</span>
				<span className="tnum [overflow-wrap:anywhere]">{step.detail}</span>
			</li>
		))}
	</ul>
);

// ---------------------------------------------------------------------------
// Cards: the one surface where cards are allowed (ADR-0017). Each is a fixed
// component over validated fields from the run document; it appears when
// its pickLot call lands.
// ---------------------------------------------------------------------------

/**
 * The lot's name, linking its page on Nouveau by the (roaster, lot) pair
 * (ADR-0011). Runs stored before the field carry no handle or roaster slug,
 * so those link the roaster's own product page instead.
 */
const CandidateName = ({ row }: { row: PickRow }) => {
	const { candidate } = row;
	if (candidate.handle === undefined || candidate.roasterSlug === undefined) {
		return (
			<a
				className="hover:underline"
				href={candidate.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{candidate.name}
			</a>
		);
	}
	return (
		<Link
			className="hover:underline"
			params={{ lot: candidate.handle, roaster: candidate.roasterSlug }}
			to="/roaster/$roaster/$lot"
		>
			{candidate.name}
		</Link>
	);
};

const PickCard = ({
	rank,
	row,
	runId,
}: {
	rank: number;
	row: PickRow;
	runId: Run["id"];
}) => {
	const { candidate, canBuy, imageUrl, pick } = row;
	return (
		<li className="motion-safe:animate-in motion-safe:fade-in grid grid-cols-[88px_1fr] gap-x-4 py-5 motion-safe:duration-300">
			<div className="bg-muted aspect-[3/2]">
				{imageUrl !== null && (
					<img
						alt={candidate.name}
						className="h-full w-full object-cover"
						loading="lazy"
						src={thumbUrl(imageUrl, 300)}
					/>
				)}
			</div>
			<div className="min-w-0">
				<p className="text-muted-foreground tnum text-xs">{rank}</p>
				<h3 className="mt-1 min-w-0 text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">
					<CandidateName row={row} />
				</h3>
				<p className="text-muted-foreground mt-0.5 text-sm">
					{candidate.roasterName}
					<span className="tnum">
						{` · ${formatPrice(candidate.priceCents)} · ${candidate.grams} g`}
					</span>
				</p>
				<p className="mt-2 text-sm leading-snug [overflow-wrap:anywhere]">
					{pick.why}
				</p>
				{!canBuy && (
					<p className="text-muted-foreground mt-1 text-sm">
						Price or stock changed since. Check the roaster.
					</p>
				)}
				<div className="mt-1 flex flex-wrap items-center gap-x-4 text-sm">
					<SaveButton fromRunId={runId} lotId={candidate.productId} />
					<a
						className={`${navLinkClass} inline-flex items-center gap-0.5`}
						href={candidate.url}
						rel="noopener noreferrer"
						target="_blank"
					>
						Buy
						<ArrowUpRight aria-hidden className="size-3.5" />
					</a>
				</div>
			</div>
		</li>
	);
};

const RetryAction = ({ run }: { run: Run }) => {
	const retry = useMutation(api.recommendations.retry);
	const [retrying, setRetrying] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const retryRun = async () => {
		setRetrying(true);
		setFailure(null);
		try {
			await retry({ runId: run.id });
		} catch (error) {
			setFailure(describeMutationError(error, "Could not retry."));
		}
		setRetrying(false);
	};
	return (
		<div className="flex flex-wrap items-center gap-x-4">
			<button
				className={navLinkClass}
				disabled={retrying}
				onClick={() => {
					void retryRun();
				}}
				type="button"
			>
				{retrying ? "Retrying..." : "Retry"}
			</button>
			{failure && (
				<p className="text-destructive text-sm" role="alert">
					{failure}
				</p>
			)}
		</div>
	);
};

/**
 * The run under the box: the request as the user typed it, the status line,
 * the steps while the loop works, and the cards as they land. Finished, the
 * steps go and the cards and summary line stay.
 */
export const NextBagRun = ({ run }: { run: Run }) => {
	const working = run.status === "queued" || run.status === "running";
	// The thread is where the steps stream from while the loop works
	// (ADR-0017); a settled run does not read it.
	const thread = useUIMessages(
		api.recommendationThreads.list,
		working && run.threadId !== null ? { threadId: run.threadId } : "skip",
		{ initialNumItems: 24, stream: true }
	);
	const steps = stepsFromMessages(thread.results ?? []);
	return (
		<section aria-label="Your shortlist" className="mt-8">
			<p className="text-[15px] leading-snug [overflow-wrap:anywhere]">
				{run.input.preferences}
			</p>
			<p className="text-muted-foreground mt-2 flex items-start gap-2 text-sm leading-snug">
				{working && (
					<span
						aria-hidden
						className="bg-foreground mt-1.5 inline-block size-2 shrink-0 rounded-full motion-safe:animate-pulse"
					/>
				)}
				{run.message}
			</p>
			{working && steps.length > 0 && (
				<div className="mt-3">
					<StepList steps={steps} />
				</div>
			)}
			{run.status === "ready" && run.picks.length === 0 && (
				<p className="mt-4 text-sm">
					Nothing in stock fits yet. Try other words, or{" "}
					<Link className="underline underline-offset-4" to="/roasters">
						browse the roasters
					</Link>
					.
				</p>
			)}
			{run.picks.length > 0 && (
				<ol className="mt-2 divide-y border-b">
					{run.picks.map((row, index) => (
						<PickCard
							key={row.candidate.productId}
							rank={index + 1}
							row={row}
							runId={run.id}
						/>
					))}
				</ol>
			)}
			{run.canRetry && (
				<div className="mt-3">
					<RetryAction run={run} />
				</div>
			)}
		</section>
	);
};
