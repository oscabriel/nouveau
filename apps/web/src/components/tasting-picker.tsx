import {
	MAX_TASTING_NOTES,
	TASTING_PICKER,
} from "@nouveau/backend/convex/tasting";
import type { TastingNote } from "@nouveau/backend/convex/tasting";

const BASE =
	"inline-flex min-h-8 items-center text-sm leading-none transition-colors disabled:cursor-default";

/**
 * A note is text, no box: picked in ink and underlined like an active nav
 * link, selectable in grey going ink on hover, capped out at half grey.
 */
const noteClass = (picked: boolean, selectable: boolean): string => {
	if (picked) {
		return `${BASE} text-foreground underline decoration-1 underline-offset-4`;
	}
	if (selectable) {
		return `${BASE} text-muted-foreground hover:text-foreground`;
	}
	return `${BASE} text-muted-foreground/50`;
};

/**
 * The tasting-note picker (ADR-0016): up to four picks from the SCA wheel's
 * top two levels, category and its terms side by side, never prefilled from
 * the roaster's notes. The four-pick cap disables further notes; an already
 * picked note always unselects.
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
			<div className="flex flex-wrap gap-x-8 gap-y-5">
				{TASTING_PICKER.map(({ category, notes }) => (
					<div className="min-w-40" key={category}>
						<p className="label-caps text-foreground">{category}</p>
						<div className="mt-1 flex flex-wrap gap-x-4">
							<button
								aria-pressed={value.includes(category)}
								className={noteClass(
									value.includes(category),
									!full || value.includes(category)
								)}
								disabled={full && !value.includes(category)}
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
									className={noteClass(
										value.includes(note),
										!full || value.includes(note)
									)}
									disabled={full && !value.includes(note)}
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
