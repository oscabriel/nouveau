import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "@nouveau/ui/components/sheet";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";

import Loader from "@/components/loader";
import { NextBagRun } from "@/components/next-bag-run";
import { SignInCta } from "@/components/sign-in-cta";
import { describeMutationError } from "@/lib/errors";
import { closeNextBag, openNextBag } from "@/lib/next-bag-search";
import { navLinkClass } from "@/lib/ui";

const PREFERENCES_MAX_CHARS = 500;
/** The counter appears only when the box is getting full. */
const COUNTER_FROM_CHARS = 400;

/**
 * The filled block that opens the pane on whichever page it sits on
 * (ADR-0014 for the landing slot; the same block on the owner's profile).
 */
export const NextBagLink = () => (
	<Link
		className="label-caps bg-foreground text-background inline-flex min-h-11 items-center px-5 transition-opacity hover:opacity-80"
		search={openNextBag}
		to="."
	>
		Find my next bag
	</Link>
);

/**
 * One text box (ADR-0017): the whole request in plain language. Enter
 * submits; Shift+Enter breaks a line. The consent toggle lets the loop read
 * the user's own logs, off by default so consent stays explicit. The request
 * key makes a double submit land on the same run instead of fighting the
 * one-active-run rule.
 */
const RequestBox = ({ busy }: { busy: boolean }) => {
	const request = useMutation(api.recommendations.request);
	const [preferences, setPreferences] = useState("");
	const [includeNotes, setIncludeNotes] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const submission = useRef<{ key: string; payload: string } | null>(null);
	const box = useRef<HTMLTextAreaElement>(null);

	const submit = async () => {
		setFailure(null);
		const text = preferences.trim();
		if (text === "") {
			box.current?.focus();
			return;
		}
		const payload = `${includeNotes ? "notes" : "plain"}\n${text}`;
		if (submission.current?.payload !== payload) {
			submission.current = { key: crypto.randomUUID(), payload };
		}
		setSubmitting(true);
		try {
			await request({
				includeNotes,
				preferences: text,
				requestKey: submission.current.key,
			});
			submission.current = null;
			// The request now shows as the run's first line; the box is ready
			// for the next one.
			setPreferences("");
		} catch (error) {
			setFailure(describeMutationError(error, "Could not start."));
		}
		setSubmitting(false);
	};

	const disabled = busy || submitting;
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<fieldset className="disabled:opacity-60" disabled={disabled}>
				<textarea
					aria-label="What are you looking for?"
					className="focus-visible:border-foreground placeholder:text-muted-foreground w-full resize-none border-b bg-transparent py-3 text-[15px] leading-snug outline-none focus-visible:outline-none md:text-base"
					maxLength={PREFERENCES_MAX_CHARS}
					onChange={(event) => setPreferences(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							void submit();
						}
					}}
					placeholder="What are you looking for?"
					ref={box}
					rows={2}
					value={preferences}
				/>
				<div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
					<button
						aria-pressed={includeNotes}
						className={`label-caps inline-flex min-h-11 items-center gap-2 whitespace-nowrap transition-colors ${
							includeNotes
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
						onClick={() => {
							setIncludeNotes((current) => !current);
						}}
						type="button"
					>
						<span
							aria-hidden
							className={`inline-block size-2 rounded-full bg-current transition-opacity ${
								includeNotes ? "opacity-100" : "opacity-30"
							}`}
						/>
						{includeNotes ? "Including my logs" : "Include my logs"}
					</button>
					<div className="flex items-center gap-x-5">
						{preferences.length >= COUNTER_FROM_CHARS && (
							<span className="text-muted-foreground tnum text-xs">
								{PREFERENCES_MAX_CHARS - preferences.length}
							</span>
						)}
						<button className={navLinkClass} type="submit">
							{disabled ? "Finding..." : "Find"}
						</button>
					</div>
				</div>
				{includeNotes && (
					<p className="text-muted-foreground text-sm">
						Your recent logs, ratings and notes go to OpenAI with this request.
					</p>
				)}
			</fieldset>
			{failure && (
				<p className="text-destructive mt-2 text-sm" role="alert">
					{failure}
				</p>
			)}
		</form>
	);
};

const SignedInPane = () => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, []);
	const latest = useQuery(api.recommendations.latest, { now });
	const busy = latest?.status === "queued" || latest?.status === "running";
	return (
		<>
			<RequestBox busy={busy} />
			{latest === undefined && <Loader />}
			{latest && <NextBagRun run={latest} />}
		</>
	);
};

const PaneContent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return (
			<div className="space-y-4">
				<p className="text-sm">Sign in to ask for a shortlist.</p>
				<SignInCta />
			</div>
		);
	}
	return <SignedInPane />;
};

/**
 * Find my next bag as a pane that slides in from the right (ADR-0017,
 * amendment of 2026-09-20): a prompt box, then the run under it, the cards
 * arriving as the model picks them. Mounted once in the root layout; open
 * state is the `bag` search param, so the back button closes it.
 */
export const NextBagSheet = () => {
	const open = useSearch({
		select: (search) => search.bag === true,
		strict: false,
	});
	const navigate = useNavigate();
	// Opening pushes a history entry so the back button closes the pane;
	// closing replaces it so back does not reopen it.
	const setOpen = (next: boolean) => {
		void navigate({
			replace: !next,
			search: next ? openNextBag : closeNextBag,
			to: ".",
		});
	};
	return (
		<Sheet modal onOpenChange={setOpen} open={open}>
			<SheetContent
				aria-describedby={undefined}
				className="px-5 pt-3 pb-16 md:px-8 md:pt-4"
			>
				<div className="flex items-center justify-between">
					<SheetTitle className="label-caps inline-flex min-h-11 items-center font-semibold">
						Find my next bag
					</SheetTitle>
					<SheetClose className={navLinkClass}>Close</SheetClose>
				</div>
				<div className="mt-6">
					<PaneContent />
				</div>
			</SheetContent>
		</Sheet>
	);
};
