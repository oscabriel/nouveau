import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import type { TastingNote } from "@nouveau/backend/convex/tasting";
import { Button } from "@nouveau/ui/components/button";
import { Checkbox } from "@nouveau/ui/components/checkbox";
import { Label } from "@nouveau/ui/components/label";
import { Textarea } from "@nouveau/ui/components/textarea";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Stars } from "@/components/stars";
import { TastingNotesPicker } from "@/components/tasting-picker";

const NOTES_MAX_LENGTH = 1000;
const DEFAULT_RATING = 3;

/**
 * Create or edit a Log (build spec §14.1, ADR-0016). Inline rather than a
 * modal — the ui kit has no dialog primitive and the form is three fields.
 * Unchecking the rating stores a rating-less log; clearing it on edit sends
 * `null`. The freeform field is the review; the structured picks are the
 * tasting notes. `roasterNotes` (§14.4) sits beside the picker as read-only
 * reference: descriptors the roaster published, verbatim, to crib from —
 * never prefilled into the taster's own picks.
 */
export const LogForm = ({
	existing,
	lotId,
	onDone,
	roasterNotes,
}: {
	existing?: {
		logId: Id<"logs">;
		notes: string | null;
		rating: number | null;
		tastingNotes: TastingNote[] | null;
	};
	lotId: Id<"products">;
	onDone: () => void;
	roasterNotes: string | null;
}) => {
	const [rateIt, setRateIt] = useState(
		existing?.rating !== undefined && existing.rating !== null
	);
	const [rating, setRating] = useState(existing?.rating ?? DEFAULT_RATING);
	const [notes, setNotes] = useState(existing?.notes ?? "");
	const [picks, setPicks] = useState<TastingNote[]>(
		existing?.tastingNotes ?? []
	);
	const [saving, setSaving] = useState(false);

	const create = useMutation(api.logs.createLog);
	const update = useMutation(api.logs.updateLog);
	const restore = useMutation(api.savedCoffees.save);
	const checkboxId = `rate-${existing?.logId ?? lotId}`;

	const save = async () => {
		const trimmed = notes.trim();
		setSaving(true);
		try {
			if (existing === undefined) {
				const { removedSaveFromRunId } = await create({
					...(rateIt ? { rating } : {}),
					...(trimmed === "" ? {} : { notes: trimmed }),
					...(picks.length > 0 ? { tastingNotes: picks } : {}),
					productId: lotId,
				});
				// Logging a lot on the try list removes the save (ADR-0016); the
				// undo puts it back exactly as it was, run citation included.
				if (removedSaveFromRunId === null) {
					toast.success("Logged.");
				} else {
					toast.success("Logged. Removed from Want to try.", {
						action: {
							label: "Undo",
							onClick: () => {
								void restore({
									fromRunId: removedSaveFromRunId,
									productId: lotId,
								});
							},
						},
					});
				}
			} else {
				await update({
					logId: existing.logId,
					notes: trimmed === "" ? null : trimmed,
					rating: rateIt ? rating : null,
					tastingNotes: picks.length === 0 ? null : picks,
				});
				toast.success("Log updated.");
			}
			onDone();
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Something went wrong."
			);
			setSaving(false);
		}
	};

	return (
		<div className="my-2 flex flex-col gap-3 rounded-md border p-3">
			<div className="flex flex-col gap-4 md:flex-row md:gap-8">
				<div className="md:w-1/2">
					<p className="label-caps text-foreground mb-2">Tasting notes</p>
					<TastingNotesPicker onChange={setPicks} value={picks} />
				</div>
				{roasterNotes !== null && (
					<p className="text-muted-foreground text-xs italic md:w-1/2">
						<span className="font-medium not-italic">Roaster notes:</span>{" "}
						{roasterNotes}
					</p>
				)}
			</div>
			<div className="flex items-center gap-3">
				<Checkbox
					checked={rateIt}
					id={checkboxId}
					onCheckedChange={(checked) => {
						setRateIt(checked);
					}}
				/>
				<Label htmlFor={checkboxId}>Rate it</Label>
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
				aria-label="Review"
				maxLength={NOTES_MAX_LENGTH}
				onChange={(event) => {
					setNotes(event.target.value);
				}}
				placeholder="Your review — jasmine? lemon? too thin?"
				rows={2}
				value={notes}
			/>
			<div className="flex gap-2">
				<Button
					disabled={saving}
					onClick={() => {
						save();
					}}
					size="sm"
				>
					{existing === undefined ? "Save log" : "Update log"}
				</Button>
				<Button disabled={saving} onClick={onDone} size="sm" variant="ghost">
					Cancel
				</Button>
			</div>
		</div>
	);
};
