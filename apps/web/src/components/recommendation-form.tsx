import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import { Input } from "@nouveau/ui/components/input";
import { Textarea } from "@nouveau/ui/components/textarea";
import { useMutation, usePaginatedQuery } from "convex/react";
import { useRef, useState } from "react";

import { describeMutationError } from "@/lib/errors";

export const RecommendationForm = ({ busy }: { busy: boolean }) => {
	const history = usePaginatedQuery(
		api.recommendations.history,
		{},
		{ initialNumItems: 10 }
	);
	const request = useMutation(api.recommendations.request);
	const [selected, setSelected] = useState<Id<"logs">[]>([]);
	const [preferences, setPreferences] = useState("");
	const [includeNotes, setIncludeNotes] = useState(false);
	const [budget, setBudget] = useState("");
	const [grams, setGrams] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const submission = useRef<{ key: string; payload: string } | null>(null);

	const submit = async () => {
		setFailure(null);
		const input = {
			includeNotes,
			logIds: selected,
			preferences: preferences.trim(),
			...(budget === ""
				? {}
				: { maxPriceCents: Math.round(Number(budget) * 100) }),
			...(grams === "" ? {} : { minGrams: Number(grams) }),
		};
		if (!input.preferences && selected.length === 0) {
			setFailure(
				"Describe what you want or choose a coffee from your history."
			);
			return;
		}
		const payload = JSON.stringify(input);
		if (submission.current?.payload !== payload) {
			submission.current = { key: crypto.randomUUID(), payload };
		}
		setSubmitting(true);
		try {
			await request({ ...input, requestKey: submission.current.key });
			submission.current = null;
		} catch (error) {
			setFailure(
				`${describeMutationError(error, "Could not start the shortlist.")} Your choices are still here.`
			);
		}
		setSubmitting(false);
	};

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<fieldset className="space-y-6" disabled={busy || submitting}>
				<div>
					<label className="mb-2 block font-medium" htmlFor="bag-preferences">
						What would you like?
					</label>
					<Textarea
						aria-describedby="bag-preferences-help"
						className="min-h-24 text-base"
						id="bag-preferences"
						maxLength={500}
						onChange={(event) => setPreferences(event.target.value)}
						placeholder="Something floral, or a change from the washed coffees I usually drink"
						rows={3}
						value={preferences}
					/>
					<p
						className="text-muted-foreground mt-2 text-sm"
						id="bag-preferences-help"
					>
						No history needed. Similar or different, your request guides the
						comparison.
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<div>
						<label
							className="mb-2 block text-sm font-medium"
							htmlFor="bag-budget"
						>
							Maximum per bag, USD
						</label>
						<Input
							className="min-h-11 text-base"
							id="bag-budget"
							inputMode="decimal"
							max={1000}
							min={0.01}
							onChange={(event) => setBudget(event.target.value)}
							placeholder="No maximum"
							step={0.01}
							type="number"
							value={budget}
						/>
					</div>
					<div>
						<label
							className="mb-2 block text-sm font-medium"
							htmlFor="bag-size"
						>
							Minimum bag size, grams
						</label>
						<Input
							className="min-h-11 text-base"
							id="bag-size"
							inputMode="numeric"
							max={100_000}
							min={1}
							onChange={(event) => setGrams(event.target.value)}
							placeholder="Any confirmed size"
							step={1}
							type="number"
							value={grams}
						/>
					</div>
					<p className="text-muted-foreground text-sm sm:col-span-2">
						US market, USD only. Shipping and tax are excluded. Coffees without
						confirmed stock, price or size cannot qualify.
					</p>
				</div>
				<details>
					<summary className="min-h-11 cursor-pointer py-2 font-medium">
						Choose from your history, {selected.length} of 5 selected
					</summary>
					{history.status === "LoadingFirstPage" && (
						<output className="text-muted-foreground block py-3 text-sm">
							Loading your history...
						</output>
					)}
					{history.status !== "LoadingFirstPage" &&
						history.results.length === 0 && (
							<p className="text-muted-foreground py-3 text-sm">
								No logs yet. Describe your preferences above to start.
							</p>
						)}
					<div className="divide-y">
						{history.results.map((log) => (
							<label
								className="flex min-h-11 cursor-pointer items-start gap-3 py-3"
								key={log.id}
							>
								<input
									checked={selected.includes(log.id)}
									className="accent-primary mt-1 size-5 shrink-0"
									disabled={!selected.includes(log.id) && selected.length >= 5}
									onChange={(event) =>
										setSelected((current) =>
											event.target.checked
												? [...current, log.id]
												: current.filter((id) => id !== log.id)
										)
									}
									type="checkbox"
								/>
								<span className="min-w-0">
									<span className="block font-medium">{log.name}</span>
									<span className="text-muted-foreground block text-sm">
										Logged {new Date(log.loggedAt).toLocaleDateString()}
										{log.rating === null ? "" : `, rated ${log.rating}/5`}
									</span>
									{includeNotes && selected.includes(log.id) && log.notes && (
										<span className="text-muted-foreground mt-1 block text-sm [overflow-wrap:anywhere]">
											Note to include: {log.notes}
										</span>
									)}
								</span>
							</label>
						))}
					</div>
					{history.status === "CanLoadMore" && (
						<Button
							className="min-h-11"
							onClick={() => history.loadMore(10)}
							type="button"
							variant="outline"
						>
							Older logs
						</Button>
					)}
				</details>
				<div className="border-t pt-5">
					<p className="text-muted-foreground text-sm">
						OpenAI receives your request, the names and ratings of selected
						coffees, their published descriptors, and candidate source excerpts.
						We do not add your account email or unselected history. Only you can
						read this shortlist.
					</p>
					<label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
						<input
							checked={includeNotes}
							className="accent-primary size-5 shrink-0"
							onChange={(event) => setIncludeNotes(event.target.checked)}
							type="checkbox"
						/>
						Include my notes from the selected logs in the OpenAI request
					</label>
					<Button className="mt-3 min-h-11 px-5" type="submit">
						{busy || submitting
							? "Preparing your shortlist..."
							: "Find my next bag"}
					</Button>
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
