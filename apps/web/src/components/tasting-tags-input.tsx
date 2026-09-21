import {
	familyOf,
	MAX_TASTING_NOTE_LENGTH,
	MAX_TASTING_NOTES,
	normalizeTastingNote,
} from "@nouveau/backend/convex/tasting";
import { useState } from "react";

import { pillClass } from "@/components/tasting-pill";

/**
 * The log form's tasting-notes field (ADR-0016, amended 2026-09-21): free
 * text. Type a word or two, press Enter or comma, and it becomes a pill
 * colored by the wheel family it resolves to, with an x to remove it.
 * Backspace on an empty field removes the last pill. Duplicates are
 * ignored; the field closes at MAX_TASTING_NOTES. What the taster typed is
 * stored lowercased, the same shape the backend keeps.
 */
export const TastingTagsInput = ({
	id,
	onChange,
	value,
}: {
	id: string;
	onChange: (next: string[]) => void;
	value: string[];
}) => {
	const [draft, setDraft] = useState("");
	const full = value.length >= MAX_TASTING_NOTES;

	const commit = (text: string) => {
		const note = normalizeTastingNote(text);
		setDraft("");
		if (note === "" || value.includes(note) || full) {
			return;
		}
		onChange([...value, note]);
	};

	const remove = (note: string) => {
		onChange(value.filter((item) => item !== note));
	};

	return (
		<div className="focus-within:border-foreground flex min-h-11 flex-wrap items-center gap-2 border-b py-2">
			{value.map((note) => (
				<span
					className={`${pillClass(familyOf(note))} gap-1.5 pr-1.5`}
					key={note}
				>
					{note}
					<button
						aria-label={`Remove ${note}`}
						className="text-muted-foreground hover:text-foreground -my-1 inline-flex size-5 items-center justify-center"
						onClick={() => {
							remove(note);
						}}
						type="button"
					>
						<span aria-hidden>×</span>
					</button>
				</span>
			))}
			{!full && (
				<input
					autoCapitalize="off"
					autoComplete="off"
					className="placeholder:text-muted-foreground min-w-32 flex-1 bg-transparent text-[15px] leading-snug outline-none md:text-base"
					id={id}
					maxLength={MAX_TASTING_NOTE_LENGTH}
					onBlur={() => {
						commit(draft);
					}}
					onChange={(event) => {
						const typed = event.target.value;
						if (typed.includes(",")) {
							commit(typed.split(",")[0] ?? "");
							return;
						}
						setDraft(typed);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit(draft);
						} else if (
							event.key === "Backspace" &&
							draft === "" &&
							value.length > 0
						) {
							event.preventDefault();
							remove(value.at(-1) ?? "");
						}
					}}
					placeholder={
						value.length === 0 ? "Blackberry, jasmine, brown sugar" : ""
					}
					type="text"
					value={draft}
				/>
			)}
		</div>
	);
};
