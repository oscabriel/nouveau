import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { Page, PageTitle, SectionHeading } from "@/components/page";
import { SignInPrompt } from "@/components/sign-in-cta";
import { StatusChip } from "@/components/status-chip";
import { describeMutationError } from "@/lib/errors";
import {
	hairlineInputClass,
	navLinkClass,
	primaryButtonClass,
	quietLinkClass,
} from "@/lib/ui";

type Submission = (typeof api.submissions.mine._returnType)[number];

const LEDE =
	"Paste a US roaster's shop. We work out how to read it, load their current coffees, and start watching. You'll be watching it too as soon as the first read lands.";

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
		} catch (error) {
			toast.error(describeMutationError(error, "Couldn't start a retry."));
		}
		setBusy(false);
	};

	return (
		<li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b py-4 last:border-b-0">
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
					className={quietLinkClass}
					disabled={busy}
					onClick={() => {
						void retryNow();
					}}
					type="button"
				>
					Retry
				</button>
			)}
		</li>
	);
};

/** A caps label over a hairline field, the account form's shape. */
const Field = ({
	children,
	hint,
	id,
	label,
}: {
	children: React.ReactNode;
	hint?: string;
	id: string;
	label: string;
}) => (
	<div>
		<label className="label-caps text-foreground" htmlFor={id}>
			{label}
		</label>
		<div className="mt-2">{children}</div>
		{hint !== undefined && (
			<p className="text-muted-foreground mt-2 max-w-prose text-sm">{hint}</p>
		)}
	</div>
);

const fieldClass = `${hairlineInputClass} w-full text-sm md:text-[15px]`;

const SubmitForm = ({
	onSubmitted,
}: {
	onSubmitted: (roasterId: Submission["id"]) => void;
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
		} catch (error) {
			toast.error(describeMutationError(error, "Couldn't submit that."));
		}
		setSaving(false);
	};

	return (
		<form className="flex flex-col gap-6" onSubmit={send}>
			<Field
				hint="The page that lists their coffees. The domain is what we watch."
				id="submit-url"
				label="Shop page"
			>
				<input
					autoComplete="url"
					className={fieldClass}
					id="submit-url"
					inputMode="url"
					onChange={(event) => setUrl(event.target.value)}
					placeholder="roaster.com/collections/coffee"
					required
					type="text"
					value={url}
				/>
			</Field>
			<Field id="submit-name" label="Roaster name">
				<input
					className={fieldClass}
					id="submit-name"
					maxLength={80}
					onChange={(event) => setName(event.target.value)}
					required
					type="text"
					value={name}
				/>
			</Field>
			<div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-6">
				<Field id="submit-city" label="City">
					<input
						autoComplete="address-level2"
						className={fieldClass}
						id="submit-city"
						maxLength={60}
						onChange={(event) => setCity(event.target.value)}
						required
						type="text"
						value={city}
					/>
				</Field>
				<Field id="submit-state" label="State">
					<input
						autoComplete="address-level1"
						className={`${fieldClass} uppercase`}
						id="submit-state"
						maxLength={2}
						onChange={(event) => setState(event.target.value)}
						pattern="[A-Za-z]{2}"
						placeholder="WI"
						required
						type="text"
						value={state}
					/>
				</Field>
			</div>
			<div className="flex flex-wrap items-center gap-4">
				<button
					className={primaryButtonClass}
					disabled={saving || blocked}
					type="submit"
				>
					{saving ? "Adding" : "Add roaster"}
				</button>
				{quota !== undefined && quota !== null && (
					<span className="text-muted-foreground tnum text-xs">
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
		return (
			<p className="text-muted-foreground mt-4 max-w-prose text-sm">
				None yet.
			</p>
		);
	}
	return (
		<ul className="mt-6">
			{submissions.map((submission) => (
				<SubmissionRow key={submission.id} submission={submission} />
			))}
		</ul>
	);
};

/**
 * Add a roaster: the same inner-page shell as the directory it comes
 * from, the form in the account form's shape (caps label, hairline field),
 * the filled block to submit, and the visitor's own submissions as rows
 * under a section heading. Signed out, the page says what it is for and
 * offers sign-in.
 */
const SubmitComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const mine = useQuery(api.submissions.mine, isAuthenticated ? {} : "skip");

	let body: React.ReactNode;
	if (isLoading) {
		body = <Loader />;
	} else if (isAuthenticated) {
		body = (
			<>
				<div className="mt-10 max-w-xl">
					<SubmitForm
						onSubmitted={() => {
							toast.success("Added. Reading the shop now.");
						}}
					/>
				</div>
				<section
					aria-labelledby="submissions-heading"
					className="mt-16 md:mt-24"
				>
					<SectionHeading id="submissions-heading">
						Your submissions
					</SectionHeading>
					<SubmissionList submissions={mine} />
				</section>
			</>
		);
	} else {
		body = (
			<SignInPrompt className="mt-10">
				Sign in to add a roaster we don&apos;t watch yet. Paste the page that
				lists their coffees; we read the shop and start watching it for you.
			</SignInPrompt>
		);
	}

	return (
		<Page>
			<PageTitle lede={LEDE} title="Add a roaster">
				<Link className={navLinkClass} to="/roasters">
					All roasters
				</Link>
			</PageTitle>
			{body}
		</Page>
	);
};

export const Route = createFileRoute("/roasters/submit")({
	component: SubmitComponent,
	head: () => ({ meta: [{ title: "Add a roaster | Nouveau" }] }),
});
