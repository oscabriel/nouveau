import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import { Input } from "@nouveau/ui/components/input";
import { Label } from "@nouveau/ui/components/label";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { SignInCta } from "@/components/sign-in-cta";
import { StatusChip } from "@/components/status-chip";

const SignedOut = () => (
	<div className="container mx-auto max-w-3xl px-4 py-8">
		<h1 className="mb-2 font-serif text-[2rem] leading-none font-normal">
			Add a roaster
		</h1>
		<p className="text-muted-foreground mb-4 max-w-prose text-sm">
			Sign in to add a roaster we don&apos;t watch yet. Paste the page that
			lists their coffees; we read the shop and start watching it for you.
		</p>
		<SignInCta />
	</div>
);

type Submission = (typeof api.submissions.mine._returnType)[number];

/** The one line a submission row needs beyond the chip. */
const submissionLine = (submission: Submission): string | null => {
	if (submission.status === "rejected") {
		return "Not a coffee roaster we can list.";
	}
	if (submission.status === "active") {
		return null;
	}
	if (submission.crawl.checking || submission.crawl.lastCheckedAt === null) {
		return "Reading the shop. This usually takes under a minute.";
	}
	if (submission.crawl.health === "crawl_failed") {
		return "We couldn't read this shop yet.";
	}
	return null;
};

const SubmissionRow = ({ submission }: { submission: Submission }) => {
	const retry = useMutation(api.submissions.retry);
	const [busy, setBusy] = useState(false);
	const line = submissionLine(submission);
	const failed =
		submission.status === "pending" &&
		!submission.crawl.checking &&
		submission.crawl.health === "crawl_failed";

	const retryNow = async () => {
		setBusy(true);
		try {
			const result = await retry({ roasterId: submission.id });
			if (result.status === "limited") {
				toast.error(
					`Try again in ${Math.ceil(result.retryAfter / 60_000)} min.`
				);
			}
		} catch {
			toast.error("Couldn't start a retry.");
		}
		setBusy(false);
	};

	return (
		<li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-4">
			<div className="min-w-0">
				<div className="flex items-baseline gap-3">
					{submission.status === "active" ? (
						<Link
							className="font-medium hover:underline"
							params={{ roaster: submission.slug }}
							to="/roaster/$roaster"
						>
							{submission.name}
						</Link>
					) : (
						<span className="font-medium">{submission.name}</span>
					)}
					<span className="text-muted-foreground text-sm">
						{submission.city}, {submission.state}
					</span>
				</div>
				<div className="mt-1 flex flex-wrap items-baseline gap-x-3">
					{submission.status === "active" && (
						<StatusChip compact status={submission.crawl} />
					)}
					{line !== null && (
						<span className="text-muted-foreground text-sm">{line}</span>
					)}
				</div>
			</div>
			{failed && (
				<button
					className="hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
					disabled={busy}
					onClick={retryNow}
					type="button"
				>
					Retry
				</button>
			)}
		</li>
	);
};

const SubmitForm = ({
	onSubmitted,
}: {
	onSubmitted: (roasterId: Id<"roasters">) => void;
}) => {
	const submit = useMutation(api.submissions.submit);
	const quota = useQuery(api.submissions.quota, {});
	const navigate = useNavigate();
	const [url, setUrl] = useState("");
	const [name, setName] = useState("");
	const [city, setCity] = useState("");
	const [state, setState] = useState("");
	const [saving, setSaving] = useState(false);

	const blocked =
		quota !== undefined &&
		quota !== null &&
		(!quota.todayOk || quota.activeLeft === 0);

	const send = async (event: React.FormEvent) => {
		event.preventDefault();
		setSaving(true);
		try {
			const result = await submit({ city, name, state, url });
			switch (result.status) {
				case "submitted": {
					setUrl("");
					setName("");
					setCity("");
					setState("");
					onSubmitted(result.roasterId);
					break;
				}
				case "already": {
					toast("We already watch this one. You do too, now.");
					await navigate({
						params: { roaster: result.slug },
						to: "/roaster/$roaster",
					});
					break;
				}
				case "invalid": {
					toast.error(
						"Check the fields: a shop URL, a name, a city and a two-letter state."
					);
					break;
				}
				case "limited": {
					toast.error("Three a day. Try again tomorrow.");
					break;
				}
				case "quota": {
					toast.error("Five submitted roasters at a time is the limit.");
					break;
				}
				default: {
					result satisfies never;
				}
			}
		} catch {
			toast.error("Couldn't submit that.");
		}
		setSaving(false);
	};

	return (
		<form className="grid gap-4" onSubmit={send}>
			<div className="grid gap-1.5">
				<Label htmlFor="submit-url">Shop page</Label>
				<Input
					autoComplete="url"
					id="submit-url"
					inputMode="url"
					onChange={(event) => setUrl(event.target.value)}
					placeholder="roaster.com/collections/coffee"
					required
					value={url}
				/>
				<p className="text-muted-foreground text-xs">
					The page that lists their coffees. The domain is what we watch.
				</p>
			</div>
			<div className="grid gap-1.5">
				<Label htmlFor="submit-name">Roaster name</Label>
				<Input
					id="submit-name"
					maxLength={80}
					onChange={(event) => setName(event.target.value)}
					required
					value={name}
				/>
			</div>
			<div className="grid grid-cols-[1fr_5rem] gap-4">
				<div className="grid gap-1.5">
					<Label htmlFor="submit-city">City</Label>
					<Input
						autoComplete="address-level2"
						id="submit-city"
						maxLength={60}
						onChange={(event) => setCity(event.target.value)}
						required
						value={city}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="submit-state">State</Label>
					<Input
						autoComplete="address-level1"
						className="uppercase"
						id="submit-state"
						maxLength={2}
						onChange={(event) => setState(event.target.value)}
						pattern="[A-Za-z]{2}"
						placeholder="WI"
						required
						value={state}
					/>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-4">
				<Button disabled={saving || blocked} type="submit">
					{saving ? "Adding" : "Add roaster"}
				</Button>
				{quota !== undefined && quota !== null && (
					<span className="text-muted-foreground text-xs">
						{quota.todayOk
							? `${quota.activeLeft} of 5 slots left`
							: "Three a day; more tomorrow"}
					</span>
				)}
			</div>
		</form>
	);
};

const SubmissionList = ({
	submissions,
}: {
	submissions: Submission[] | undefined;
}) => {
	if (submissions === undefined) {
		return <Loader />;
	}
	if (submissions.length === 0) {
		return <p className="text-muted-foreground py-4 text-sm">None yet.</p>;
	}
	return (
		<ul className="divide-y">
			{submissions.map((submission) => (
				<SubmissionRow key={submission.id} submission={submission} />
			))}
		</ul>
	);
};

const SubmitComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const mine = useQuery(api.submissions.mine, isAuthenticated ? {} : "skip");

	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return <SignedOut />;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex items-baseline justify-between gap-4">
				<h1 className="font-serif text-[2rem] leading-none font-normal">
					Add a roaster
				</h1>
				<Link className="text-sm hover:underline" to="/roasters">
					All roasters
				</Link>
			</header>
			<p className="text-muted-foreground mb-6 max-w-prose text-sm">
				Paste a US roaster&apos;s shop. We work out how to read it, load their
				current coffees, and start watching. You&apos;ll be watching it too as
				soon as the first read lands.
			</p>
			<SubmitForm
				onSubmitted={() => {
					toast.success("Added. Reading the shop now.");
				}}
			/>
			<section className="mt-10">
				<h2 className="mb-2 text-lg font-semibold">Your submissions</h2>
				<SubmissionList submissions={mine} />
			</section>
		</div>
	);
};

export const Route = createFileRoute("/roasters/submit")({
	component: SubmitComponent,
});
