import {
	MAX_TASTING_NOTES,
	TASTING_PICKER,
} from "@nouveau/backend/convex/tasting";
import type { TastingNote } from "@nouveau/backend/convex/tasting";

const chipClass = (picked: boolean, selectable: boolean): string => {
	if (picked) {
		return "border-foreground bg-foreground text-background rounded-full border px-3 py-1 text-sm transition-colors";
	}
	if (selectable) {
		return "text-muted-foreground hover:text-foreground hover:border-foreground rounded-full border px-3 py-1 text-sm transition-colors";
	}
	return "text-muted-foreground/50 border-muted rounded-full border px-3 py-1 text-sm";
};

/**
 * The tasting-note picker (ADR-0016): up to four picks from the SCA wheel's
 * top two levels, category and its terms side by side, never prefilled from
 * the roaster's notes. The four-pick cap disables further chips; an already
 * picked chip always unselects.
 */
export const TastingNotesPicker = ({
	onChange,
	value,
}: {
	onChange: (next: TastingNote[]) => void;
	value: TastingNote[];
}) => {
	const full = value.length >= MAX_TASTING_NOTES;
	const toggle = (note: TastingNote) => {
		onChange(
			value.includes(note)
				? value.filter((picked) => picked !== note)
				: [...value, note]
		);
	};
	return (
		<div>
			<div className="flex flex-wrap gap-3">
				{TASTING_PICKER.map(({ category, notes }) => (
					<div className="min-w-40" key={category}>
						<p className="label-caps text-foreground">{category}</p>
						<div className="mt-2 flex flex-wrap gap-1.5">
							<button
								aria-pressed={value.includes(category)}
								className={chipClass(
									value.includes(category),
									!full || value.includes(category)
								)}
								onClick={() => {
									toggle(category);
								}}
								type="button"
							>
								{category}
							</button>
							{notes.map((note) => (
								<button
									aria-pressed={value.includes(note)}
									className={chipClass(
										value.includes(note),
										!full || value.includes(note)
									)}
									key={note}
									onClick={() => {
										toggle(note);
									}}
									type="button"
								>
									{note}
								</button>
							))}
						</div>
					</div>
				))}
			</div>
			<p className="text-muted-foreground tnum mt-3 text-xs">
				{value.length}/{MAX_TASTING_NOTES} picked
			</p>
		</div>
	);
};
