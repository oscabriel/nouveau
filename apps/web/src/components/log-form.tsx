import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { Pane } from "@/components/pane";
import { StarsInput } from "@/components/stars-input";
import { TastingTagsInput } from "@/components/tasting-tags-input";
import { describeMutationError } from "@/lib/errors";
import { hairlineInputClass, navLinkClass, quietLinkClass } from "@/lib/ui";

const NOTES_MAX_LENGTH = 1000;

/** A log being edited: the row's id and its three fields as stored. */
export interface ExistingLog {
	logId: Id<"logs">;
	notes: string | null;
	rating: number | null;
	tastingNotes: string[] | null;
}

/**
 * The log form's fields (build spec §14.1, ADR-0016, amended 2026-09-21),
 * top to bottom under caps labels: RATING as five stars you click or drag
 * across (unrated until touched; CLEAR takes it back), TASTING NOTES as
 * the tag field, the roaster's own notes as one grey line under it for
 * reference (never prefilled into the taster's), REVIEW as one line on a
 * hairline that grows, then SAVE LOG (UPDATE LOG when editing) and CANCEL
 * as caps actions. Saving with no rating stores a rating-less log;
 * clearing on edit sends `null`.
 */
const LogFields = ({
	existing,
	lotId,
	onDone,
	roasterNotes,
}: {
	existing?: ExistingLog;
	lotId: Id<"products">;
	onDone: () => void;
	roasterNotes: string | null;
}) => {
	const [rating, setRating] = useState<number | null>(existing?.rating ?? null);
	const [notes, setNotes] = useState(existing?.notes ?? "");
	const [picks, setPicks] = useState<string[]>(existing?.tastingNotes ?? []);
	const [saving, setSaving] = useState(false);

	const create = useMutation(api.logs.createLog);
	const update = useMutation(api.logs.updateLog);
	const restore = useMutation(api.savedCoffees.save);
	const key = existing?.logId ?? lotId;
	const reviewId = `review-${key}`;
	const tagsId = `tasting-${key}`;

	const save = async () => {
		const trimmed = notes.trim();
		setSaving(true);
		try {
			if (existing === undefined) {
				const { removedSave } = await create({
					...(rating === null ? {} : { rating }),
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
					rating,
					tastingNotes: picks.length === 0 ? null : picks,
				});
				toast.success("Log updated.");
			}
			onDone();
		} catch (error) {
			toast.error(describeMutationError(error, "Could not save the log."));
			setSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-8">
			<div>
				<p className="label-caps text-foreground mb-2">Rating</p>
				<StarsInput onChange={setRating} value={rating} />
			</div>
			<div>
				<label
					className="label-caps text-foreground mb-2 block"
					htmlFor={tagsId}
				>
					Tasting notes
				</label>
				<TastingTagsInput id={tagsId} onChange={setPicks} value={picks} />
				{roasterNotes !== null && (
					<p className="text-muted-foreground mt-2 text-xs leading-snug">
						The roaster says: {roasterNotes}
					</p>
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
					className={`${hairlineInputClass} field-sizing-content h-auto min-h-11 w-full resize-none py-2.5 text-[15px] leading-snug md:text-base`}
					id={reviewId}
					maxLength={NOTES_MAX_LENGTH}
					onChange={(event) => {
						setNotes(event.target.value);
					}}
					placeholder="What'd you think?"
					rows={1}
					value={notes}
				/>
			</div>
			<div className="flex items-center gap-5">
				<button
					className={`${navLinkClass} disabled:text-muted-foreground disabled:no-underline`}
					disabled={saving}
					onClick={() => {
						void save();
					}}
					type="button"
				>
					{existing === undefined ? "Save log" : "Update log"}
				</button>
				<button
					className={quietLinkClass}
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

/**
 * Create or edit a log in a pane that slides in from the right, like the
 * Find my next bag pane (batch 8, 2026-09-21; was an inline form under a
 * hairline). The header names the action and the lot; CLOSE and the
 * backdrop dismiss it. The fields remount on each open, so a cancelled
 * edit leaves nothing behind.
 */
export const LogSheet = ({
	existing,
	lotId,
	lotName,
	onOpenChange,
	open,
	roasterNotes,
}: {
	existing?: ExistingLog;
	lotId: Id<"products">;
	lotName: string;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	roasterNotes: string | null;
}) => (
	<Pane
		onOpenChange={onOpenChange}
		open={open}
		title={existing === undefined ? "Log this lot" : "Edit log"}
	>
		<p className="mt-4 text-[15px] leading-snug md:text-base">{lotName}</p>
		<div className="mt-8">
			{open && (
				<LogFields
					existing={existing}
					lotId={lotId}
					onDone={() => {
						onOpenChange(false);
					}}
					roasterNotes={roasterNotes}
				/>
			)}
		</div>
	</Pane>
);
