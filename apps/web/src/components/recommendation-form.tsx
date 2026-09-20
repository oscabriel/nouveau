import { api } from "@nouveau/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { useRef, useState } from "react";

import { describeMutationError } from "@/lib/errors";

const PREFERENCES_MAX_CHARS = 500;

/**
 * One text box (ADR-0017): the whole request in plain language. The consent
 * toggle lets the loop read the user's own logs; off by default so consent
 * stays explicit. The request key makes a double submit land on the same
 * run instead of fighting the one-active-run rule.
 */
export const RecommendationForm = ({ busy }: { busy: boolean }) => {
	const request = useMutation(api.recommendations.request);
	const [preferences, setPreferences] = useState("");
	const [includeNotes, setIncludeNotes] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const submission = useRef<{ key: string; payload: string } | null>(null);

	const submit = async () => {
		setFailure(null);
		const text = preferences.trim();
		if (text === "") {
			setFailure("Describe what you are looking for in one sentence.");
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
		} catch (error) {
			setFailure(
				`${describeMutationError(error, "Could not start the shortlist.")} Your request is still here.`
			);
		}
		setSubmitting(false);
	};

	return (
		<form
			className="mt-8"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<fieldset
				className="space-y-5 disabled:opacity-60"
				disabled={busy || submitting}
			>
				<textarea
					aria-label="What are you looking for?"
					className="focus-visible:border-foreground placeholder:text-muted-foreground min-h-11 w-full resize-none border-b bg-transparent py-3 text-[15px] leading-snug outline-none focus-visible:outline-none md:text-base"
					maxLength={PREFERENCES_MAX_CHARS}
					onChange={(event) => setPreferences(event.target.value)}
					placeholder="What are you looking for? Something floral, or a change from the washed coffees you usually drink"
					rows={2}
					value={preferences}
				/>
				<div>
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
						title={
							includeNotes
								? "Stop sending your logs with this request"
								: undefined
						}
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
					<p className="text-muted-foreground mt-2 max-w-prose text-sm">
						{includeNotes
							? "Your recent coffee logs, with ratings and notes, go to OpenAI. Only you can read the shortlist."
							: "The agent sees only this request. Turn the toggle on to let it read your recent coffee logs, with ratings and notes."}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
					<button
						className="label-caps inline-flex min-h-11 items-center underline-offset-4 hover:underline"
						type="submit"
					>
						{busy || submitting
							? "Finding your next bag..."
							: "Find my next bag"}
					</button>
					<p className="text-muted-foreground text-sm tabular-nums">
						{PREFERENCES_MAX_CHARS - preferences.length} characters left
					</p>
				</div>
			</fieldset>
			{failure && (
				<p className="text-destructive mt-3 text-sm" role="alert">
					{failure}
				</p>
			)}
		</form>
	);
};
