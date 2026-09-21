import {
	MAX_TASTING_NOTES,
	TASTING_PICKER,
} from "@nouveau/backend/convex/tasting";
import type { TastingNote } from "@nouveau/backend/convex/tasting";

const BASE =
	"inline-flex min-h-8 items-center text-sm leading-none transition-colors aria-disabled:cursor-default";

/**
 * A note is text, no box: picked in ink and underlined like an active nav
 * link, selectable in grey going ink on hover, locked at half grey.
 */
const noteClass = (picked: boolean, locked: boolean): string => {
	if (picked) {
		return `${BASE} text-foreground underline decoration-1 underline-offset-4`;
	}
	if (locked) {
		return `${BASE} text-muted-foreground/50`;
	}
	return `${BASE} text-muted-foreground hover:text-foreground`;
};

/**
 * One note. Locked notes (the cap is reached and this one is not picked)
 * carry `aria-disabled` rather than `disabled` so they stay in the tab
 * order and a keyboard user hears why the click does nothing; `toggle`
 * refuses the pick.
 */
const NoteButton = ({
	locked,
	note,
	picked,
	toggle,
}: {
	locked: boolean;
	note: TastingNote;
	picked: boolean;
	toggle: (note: TastingNote) => void;
}) => (
	<button
		aria-disabled={locked}
		aria-pressed={picked}
		className={noteClass(picked, locked)}
		onClick={() => {
			toggle(note);
		}}
		type="button"
	>
		{note}
	</button>
);

/**
 * The tasting-note picker (ADR-0016): up to four picks from the SCA wheel's
 * top two levels, category and its terms side by side, never prefilled from
 * the roaster's notes. At the four-pick cap the other notes lock; an already
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
		if (value.includes(note)) {
			onChange(value.filter((picked) => picked !== note));
			return;
		}
		if (full) {
			return;
		}
		onChange([...value, note]);
	};
	const noteProps = (note: TastingNote) => {
		const picked = value.includes(note);
		return { locked: full && !picked, note, picked, toggle };
	};
	return (
		<div>
			<div className="flex flex-wrap gap-x-8 gap-y-5">
				{TASTING_PICKER.map(({ category, notes }) => (
					<div className="min-w-40" key={category}>
						<p className="label-caps text-foreground">{category}</p>
						<div className="mt-1 flex flex-wrap gap-x-4">
							<NoteButton {...noteProps(category)} />
							{notes.map((note) => (
								<NoteButton key={note} {...noteProps(note)} />
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
