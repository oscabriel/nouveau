import { api } from "@nouveau/backend/convex/_generated/api";
import { Button } from "@nouveau/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { SaveButton } from "@/components/save-button";
import { describeMutationError } from "@/lib/errors";
import { formatPrice } from "@/lib/format";

type Run = NonNullable<FunctionReturnType<typeof api.recommendations.latest>>;
type Result = Run["results"][number];
const comparisonLabels = {
	contrast: "A possible change of direction",
	explore: "Something to explore",
	similar: "A possible similarity",
} as const;

const basisLabel = (logCount: number): string => {
	if (logCount === 0) {
		return "Based on your stated preferences, not a taste history.";
	}
	if (logCount === 1) {
		return "Based on 1 selected log and your request.";
	}
	return `Based on ${logCount} selected logs and your request.`;
};

/**
 * The candidate's page on Nouveau, addressed by the (roaster, lot) pair
 * (ADR-0011). Runs stored before the field carry no handle or roaster slug,
 * so those fall back to the roaster's own product page.
 */
const CandidateLink = ({
	candidate,
	className,
	children,
}: {
	candidate: Result["candidate"];
	className: string;
	children: React.ReactNode;
}) => {
	if (candidate.handle === undefined || candidate.roasterSlug === undefined) {
		return (
			<a
				className={className}
				href={candidate.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				{children}
			</a>
		);
	}
	return (
		<Link
			className={className}
			params={{ lot: candidate.handle, roaster: candidate.roasterSlug }}
			to="/roaster/$roaster/$lot"
		>
			{children}
		</Link>
	);
};

const Recommendation = ({
	result,
	runId,
}: {
	result: Result;
	runId: Run["id"];
}) => {
	const { candidate, selection } = result;
	const evidence = candidate.evidence.find(
		(item) => item.id === selection.evidenceId
	);
	// Page evidence the model did not quote still reached the user's screen.
	const pageEvidence = candidate.evidence.filter(
		(item) => item.source === "firecrawl" && item.id !== selection.evidenceId
	);
	return (
		<article className="py-6">
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h3 className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">
					<CandidateLink candidate={candidate} className="hover:underline">
						{candidate.name}
					</CandidateLink>
				</h3>
				<p className="shrink-0 text-sm tabular-nums">
					{`${formatPrice(candidate.priceCents)} USD · ${candidate.variantName} (${candidate.grams} g)`}
				</p>
			</div>
			<p className="text-muted-foreground mt-1 text-sm">
				{candidate.roasterName}
			</p>
			<p className="mt-4 text-sm font-medium">
				{comparisonLabels[selection.relation]}
			</p>
			<p className="text-muted-foreground mt-1 text-sm">
				An OpenAI comparison with your selected preference, not a prediction
				that you will like it.
			</p>
			{selection.reason && (
				<p className="mt-2 text-sm [overflow-wrap:anywhere]">
					<span className="text-muted-foreground">
						OpenAI&apos;s comparison:{" "}
					</span>
					{selection.reason}
				</p>
			)}
			<blockquote className="mt-3 [overflow-wrap:anywhere]">
				&quot;{selection.quote}&quot;
			</blockquote>
			<p className="text-muted-foreground mt-2 text-sm">
				Roaster&apos;s published words
				{evidence?.source === "firecrawl"
					? ", fetched with Firecrawl"
					: ", from the catalog"}
				.
				{evidence && (
					<>
						{" "}
						Observed{" "}
						<time dateTime={new Date(evidence.observedAt).toISOString()}>
							{new Date(evidence.observedAt).toLocaleString()}
						</time>
						.
					</>
				)}
			</p>
			{pageEvidence.length > 0 && (
				<section className="mt-3 text-sm">
					<h4 className="text-muted-foreground font-medium">
						Also on the product page, fetched with Firecrawl
					</h4>
					<ul className="mt-1 list-disc space-y-1 pl-5">
						{pageEvidence.map((item) => (
							<li className="[overflow-wrap:anywhere]" key={item.id}>
								{item.passage}
							</li>
						))}
					</ul>
					<p className="text-muted-foreground mt-1">
						Roaster&apos;s published words, not in the catalog feed. Observed{" "}
						<time
							dateTime={new Date(
								pageEvidence[0]?.observedAt ?? candidate.confirmedAt
							).toISOString()}
						>
							{new Date(
								pageEvidence[0]?.observedAt ?? candidate.confirmedAt
							).toLocaleString()}
						</time>
						.
					</p>
				</section>
			)}
			<details className="mt-2 text-sm">
				<summary className="min-h-11 cursor-pointer py-3">
					Preference used for this comparison
				</summary>
				<p className="text-muted-foreground pb-3 [overflow-wrap:anywhere]">
					{result.preference}
				</p>
			</details>
			<p className="text-muted-foreground mt-2 text-sm">
				US market. Price and stock checked{" "}
				<time dateTime={new Date(candidate.confirmedAt).toISOString()}>
					{new Date(candidate.confirmedAt).toLocaleString()}
				</time>
				. Shipping and tax excluded.
			</p>
			{!result.canBuy && (
				<output className="mt-2 block text-sm">
					This size, price or availability can no longer be confirmed. Check the
					source before deciding.
				</output>
			)}
			<div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
				<SaveButton fromRunId={runId} lotId={candidate.productId} />
				<CandidateLink
					candidate={candidate}
					className="inline-flex min-h-11 items-center underline underline-offset-4"
				>
					Coffee page and logs
				</CandidateLink>
				<a
					className="inline-flex min-h-11 items-center underline underline-offset-4"
					href={candidate.url}
					rel="noopener noreferrer"
					target="_blank"
				>
					{result.canBuy
						? "See this coffee at the roaster"
						: "Read the source page"}
				</a>
			</div>
		</article>
	);
};

export const RecommendationResults = ({ run }: { run: Run | null }) => {
	const retry = useMutation(api.recommendations.retry);
	const [retrying, setRetrying] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	if (!run) {
		return null;
	}
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
			<output className="text-muted-foreground mt-2 block text-sm">
				{run.message}
			</output>
			{run.status === "ready" && (
				<p className="text-muted-foreground mt-2 text-sm">
					{basisLabel(run.input.logIds.length)}
				</p>
			)}
			{run.status === "ready" && run.results.length === 0 && (
				<p className="mt-4">
					No verified matches to show. Try changing your preferences or limits,
					or browse the roaster catalog.
				</p>
			)}
			<div className="divide-y">
				{run.results.map((result) => (
					<Recommendation
						key={result.candidate.productId}
						result={result}
						runId={run.id}
					/>
				))}
			</div>
			{run.canRetry && (
				<div className="mt-4">
					<p className="text-sm">
						A retry uses this saved request, not the form above.{" "}
						{run.input.includeNotes
							? "It includes notes from the selected logs."
							: "It does not include your notes."}
					</p>
					<details className="text-sm">
						<summary className="min-h-11 cursor-pointer py-3">
							Review the saved inputs
						</summary>
						<ul className="space-y-2 [overflow-wrap:anywhere]">
							{run.preferences.map((preference) => (
								<li key={preference.id}>{preference.text}</li>
							))}
						</ul>
					</details>
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
