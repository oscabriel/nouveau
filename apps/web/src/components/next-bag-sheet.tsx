import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useRef, useState } from "react";

import { DotToggle } from "@/components/dot-toggle";
import { Loader } from "@/components/loader";
import { Pane } from "@/components/pane";
import { SignInPrompt } from "@/components/sign-in-cta";
import { describeMutationError } from "@/lib/errors";
import { closeNextBag, openNextBag } from "@/lib/next-bag-search";
import { hairlineInputClass, navLinkClass, primaryButtonClass } from "@/lib/ui";
import { useTicker } from "@/lib/use-ticker";

const PREFERENCES_MAX_CHARS = 500;
/** The counter appears only when the box is getting full. */
const COUNTER_FROM_CHARS = 400;

/**
 * The filled block that opens the pane on whichever page it sits on
 * (ADR-0014 for the landing slot; the same block on the owner's profile).
 */
export const NextBagLink = () => (
	<Link className={primaryButtonClass} search={openNextBag} to=".">
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
					className={`${hairlineInputClass} h-auto w-full resize-none py-3 text-[15px] leading-snug md:text-base`}
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
					<DotToggle
						onClick={() => {
							setIncludeNotes((current) => !current);
						}}
						pressed={includeNotes}
					>
						{includeNotes ? "Including my logs" : "Include my logs"}
					</DotToggle>
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

/**
 * The run view pulls in the agent client (and with it the AI SDK and zod),
 * about a third of the main bundle when it was imported statically. The
 * sheet mounts on every page, so the chunk loads only once a signed-in
 * visitor opens it.
 */
const NextBagRun = lazy(async () => {
	const module = await import("@/components/next-bag-run");
	return { default: module.NextBagRun };
});

const SignedInPane = () => {
	const now = useTicker(true, 30_000);
	const fresh = useQuery(api.recommendations.latest, { now });
	// Each tick is a new subscription and `fresh` is undefined until it
	// answers; showing a Loader every 30 seconds read as a stutter. Keep the
	// last answer on screen until the next arrives (React's "adjust state
	// from a previous render" pattern; a state set during render).
	const [latest, setLatest] = useState(fresh);
	if (fresh !== undefined && fresh !== latest) {
		setLatest(fresh);
	}
	const busy = latest?.status === "queued" || latest?.status === "running";
	return (
		<>
			<RequestBox busy={busy} />
			{latest === undefined && <Loader />}
			{latest && (
				<Suspense fallback={<Loader />}>
					<NextBagRun run={latest} />
				</Suspense>
			)}
		</>
	);
};

const PaneContent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return <SignInPrompt>Sign in to ask for a shortlist.</SignInPrompt>;
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
		<Pane onOpenChange={setOpen} open={open} title="Find my next bag">
			<div className="mt-6">
				<p className="text-muted-foreground text-sm">
					Describe the coffee you&apos;re after. Our agent searches the catalog
					to find the best match based on tasting notes, origin, price, and any
					other criteria you specify.
				</p>
				<div className="mt-4">
					<PaneContent />
				</div>
			</div>
		</Pane>
	);
};
