import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import type { TastingNote } from "@nouveau/backend/convex/tasting";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { DotToggle } from "@/components/dot-toggle";
import { Stars } from "@/components/stars";
import { TastingNotesPicker } from "@/components/tasting-picker";
import { navLinkClass } from "@/lib/ui";

const NOTES_MAX_LENGTH = 1000;
const DEFAULT_RATING = 3;

/**
 * Create or edit a Log (build spec §14.1, ADR-0016). Inline under a
 * hairline, no box: the picker beside the roaster's notes, RATE IT as a
 * toggle that reveals the slider, REVIEW as one line over a hairline that
 * grows with the text, then SAVE LOG and CANCEL as caps actions. Turning
 * the rating off stores a rating-less log; clearing it on edit sends
 * `null`. The freeform field is the review; the structured picks are the
 * tasting notes. `roasterNotes` (§14.4) is read-only reference, the
 * descriptors the roaster published, verbatim, never prefilled into the
 * taster's own picks.
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
	const reviewId = `review-${existing?.logId ?? lotId}`;

	const save = async () => {
		const trimmed = notes.trim();
		setSaving(true);
		try {
			if (existing === undefined) {
				const { removedSave } = await create({
					...(rateIt ? { rating } : {}),
					...(trimmed === "" ? {} : { notes: trimmed }),
					...(picks.length > 0 ? { tastingNotes: picks } : {}),
					productId: lotId,
				});
				// Logging a lot on the try list removes the save (ADR-0016); the
				// undo puts it back exactly as it was, run citation included.
				if (removedSave === null) {
					toast.success("Logged.");
				} else {
					toast.success("Logged. Removed from your try list.", {
						action: {
							label: "Undo",
							onClick: () => {
								void restore({
									...(removedSave.fromRunId === null
										? {}
										: { fromRunId: removedSave.fromRunId }),
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
		<div className="my-4 flex flex-col gap-6 border-t pt-5">
			<div className="flex flex-col gap-6 md:flex-row md:gap-10">
				<div className="md:w-1/2">
					<p className="label-caps text-foreground mb-4">Tasting notes</p>
					<TastingNotesPicker onChange={setPicks} value={picks} />
				</div>
				{roasterNotes !== null && (
					<div className="md:w-1/2">
						<p className="label-caps text-foreground mb-4">Roaster notes</p>
						<p className="text-muted-foreground text-sm leading-snug md:text-[15px]">
							{roasterNotes}
						</p>
					</div>
				)}
			</div>
			<div className="flex flex-wrap items-center gap-x-5 gap-y-2">
				<DotToggle
					onClick={() => {
						setRateIt((value) => !value);
					}}
					pressed={rateIt}
				>
					Rate it
				</DotToggle>
				{rateIt && (
					<div className="flex items-center gap-3">
						<input
							aria-label="Rating"
							className="accent-foreground h-11 w-32"
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
						<span className="text-muted-foreground tnum w-6 text-right text-xs">
							{rating}
						</span>
					</div>
				)}
			</div>
			<div>
				<label
					className="label-caps text-foreground mb-2 block"
					htmlFor={reviewId}
				>
					Review
				</label>
				<textarea
					className="placeholder:text-muted-foreground focus-visible:border-foreground field-sizing-content min-h-11 w-full resize-none border-b bg-transparent py-2.5 text-[15px] leading-snug outline-none focus-visible:outline-none md:text-base"
					id={reviewId}
					maxLength={NOTES_MAX_LENGTH}
					onChange={(event) => {
						setNotes(event.target.value);
					}}
					placeholder="Jasmine? Lemon? Too thin?"
					rows={1}
					value={notes}
				/>
			</div>
			<div className="flex items-center gap-5">
				<button
					className={`${navLinkClass} disabled:text-muted-foreground disabled:no-underline`}
					disabled={saving}
					onClick={() => {
						save();
					}}
					type="button"
				>
					{existing === undefined ? "Save log" : "Update log"}
				</button>
				<button
					className={`${navLinkClass} text-muted-foreground hover:text-foreground disabled:no-underline`}
					disabled={saving}
					onClick={onDone}
					type="button"
				>
					Cancel
				</button>
			</div>
		</div>
	);
};
