import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Button } from "@nouveau/ui/components/button";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";

import Loader from "@/components/loader";
import { LogCard } from "@/components/log-card";
import { LogForm } from "@/components/log-form";
import { SaveButton } from "@/components/save-button";
import { SignInCta } from "@/components/sign-in-cta";

export type LotPageData = FunctionReturnType<typeof api.lots.get>;
type LotData = NonNullable<LotPageData>["lot"];

const LotAttribute = ({ label, value }: { label: string; value: string }) => (
	<span className="rounded-full border px-3 py-1 text-sm">
		<span className="text-muted-foreground mr-1.5 text-xs">{label}</span>
		{value}
	</span>
);

const LotDetail = ({
	lot,
	roaster,
}: {
	lot: LotData;
	roaster: { name: string; slug: string };
}) => (
	<>
		<header className="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold">{lot.name}</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					at{" "}
					<Link
						className="font-medium hover:underline"
						params={{ slug: roaster.slug }}
						to="/roasters/$slug"
					>
						{roaster.name}
					</Link>
					{lot.status === "archived" && (
						<span className="ml-2">· archived lot</span>
					)}
				</p>
			</div>
			<a
				className="inline-flex items-center gap-0.5 text-sm hover:underline"
				href={lot.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				See at {roaster.name}
				<ArrowUpRight aria-hidden className="size-3.5" />
			</a>
		</header>
		<div className="flex flex-wrap items-start gap-6">
			{lot.imageUrl !== null && (
				<img
					alt=""
					className="h-40 w-40 shrink-0 rounded-md border object-cover"
					src={lot.imageUrl}
				/>
			)}
			<div className="min-w-0 flex-1">
				{(lot.origin !== null ||
					lot.process !== null ||
					lot.roastLevel !== null) && (
					<div className="mb-3 flex flex-wrap gap-2">
						{lot.origin !== null && (
							<LotAttribute label="Origin" value={lot.origin} />
						)}
						{lot.process !== null && (
							<LotAttribute label="Process" value={lot.process} />
						)}
						{lot.roastLevel !== null && (
							<LotAttribute label="Roast" value={lot.roastLevel} />
						)}
					</div>
				)}
				{lot.roasterNotes !== null && (
					<p className="text-muted-foreground mb-3 text-sm italic">
						<span className="font-medium not-italic">Roaster notes:</span>{" "}
						{lot.roasterNotes}
					</p>
				)}
				{lot.description !== null && (
					<p className="text-sm">{lot.description}</p>
				)}
			</div>
		</div>
	</>
);

const LotComponent = () => {
	const { lotId } = useParams({ from: "/lots/$lotId" });
	// The id is whatever the URL holds; the query resolves bad ones to null.
	const page = useQuery(api.lots.get, { lotId });
	const me = useQuery(api.users.getCurrentUser);
	const { isAuthenticated } = useConvexAuth();
	const [logging, setLogging] = useState(false);

	if (page === undefined || me === undefined) {
		return <Loader />;
	}
	if (page === null) {
		return (
			<div className="container mx-auto max-w-3xl px-4 py-8">
				<p className="text-muted-foreground py-8 text-sm">
					No lot at this address.{" "}
					<Link className="underline" to="/roasters">
						Browse the roasters
					</Link>
					.
				</p>
			</div>
		);
	}

	const { lot, roaster } = page;
	const isMine = (logId: string) =>
		page.logs.some((log) => log.logId === logId && log.user.id === me?.id);

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<LotDetail lot={lot} roaster={roaster} />
			<section className="mt-8">
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2 className="font-semibold">
						{page.logsTruncated ? "Recent logs" : "Logs"}
					</h2>
					{isAuthenticated ? (
						<div className="flex items-center gap-2">
							<SaveButton lotId={lot.id} size="sm" />
							<Button
								onClick={() => {
									setLogging((value) => !value);
								}}
								size="sm"
								variant={logging ? "ghost" : "outline"}
							>
								{logging ? "Close" : "Log this lot"}
							</Button>
						</div>
					) : (
						<SignInCta />
					)}
				</div>
				{logging && isAuthenticated && (
					<LogForm
						lotId={lot.id}
						onDone={() => {
							setLogging(false);
						}}
						roasterNotes={lot.roasterNotes}
					/>
				)}
				{page.logs.length === 0 ? (
					<p className="text-muted-foreground py-6 text-sm">
						{isAuthenticated
							? "Nobody has logged this lot yet — be the first."
							: "No logs yet."}
					</p>
				) : (
					<div className="divide-y">
						{page.logs.map((log) => (
							<LogCard isMine={isMine(log.logId)} key={log.logId} log={log} />
						))}
					</div>
				)}
			</section>
		</div>
	);
};

export const Route = createFileRoute("/lots/$lotId")({
	component: LotComponent,
});
