import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import { Label } from "@nouveau/ui/components/label";
import { Textarea } from "@nouveau/ui/components/textarea";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Stars } from "@/components/stars";

/**
 * Create or edit a Log (build spec §14.1). Inline rather than a modal — the
 * ui kit has no dialog primitive and the form is two fields. Unchecking the
 * rating stores a rating-less log; clearing it on edit sends `null`.
 */
export const LogForm = ({
	existing,
	lotId,
	onDone,
}: {
	existing?: {
		logId: Id<"logs">;
		notes: string | null;
		rating: number | null;
	};
	lotId: Id<"products">;
	onDone: () => void;
}) => {
	const [rateIt, setRateIt] = useState(
		existing?.rating !== undefined && existing.rating !== null
	);
	const [rating, setRating] = useState(existing?.rating ?? 3);
	const [notes, setNotes] = useState(existing?.notes ?? "");

	const create = useMutation(api.logs.createLog);
	const update = useMutation(api.logs.updateLog);

	const save = async () => {
		const trimmed = notes.trim();
		try {
			if (existing === undefined) {
				await create({
					...(rateIt ? { rating } : {}),
					...(trimmed === "" ? {} : { notes: trimmed }),
					productId: lotId,
				});
				toast.success("Logged.");
			} else {
				await update({
					logId: existing.logId,
					notes: trimmed === "" ? null : trimmed,
					rating: rateIt ? rating : null,
				});
				toast.success("Log updated.");
			}
			onDone();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Something went wrong."
			);
		}
	};

	return (
		<div className="my-2 flex flex-col gap-3 rounded-md border p-3">
			<div className="flex items-center gap-3">
				<input
					checked={rateIt}
					id={`rate-${existing?.logId ?? lotId}`}
					onChange={(event) => {
						setRateIt(event.target.checked);
					}}
					type="checkbox"
				/>
				<Label htmlFor={`rate-${existing?.logId ?? lotId}`}>Rate it</Label>
				{rateIt && (
					<div className="flex items-center gap-2">
						<input
							aria-label="Rating"
							max={5}
							min={1}
							onChange={(event) => {
								setRating(Number(event.target.value));
							}}
							step={0.5}
							type="range"
							value={rating}
						/>
						<Stars rating={rating} />
						<span className="text-muted-foreground w-8 text-right text-xs tabular-nums">
							{rating}
						</span>
					</div>
				)}
			</div>
			<Textarea
				aria-label="Notes"
				maxLength={1000}
				onChange={(event) => {
					setNotes(event.target.value);
				}}
				placeholder="Your notes — jasmine? lemon? too thin?"
				rows={2}
				value={notes}
			/>
			<div className="flex gap-2">
				<Button
					onClick={() => {
						save();
					}}
					size="sm"
				>
					{existing === undefined ? "Save log" : "Update log"}
				</Button>
				<Button onClick={onDone} size="sm" variant="ghost">
					Cancel
				</Button>
			</div>
		</div>
	);
};
