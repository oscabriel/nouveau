import { Star } from "lucide-react";
import { useRef, useState } from "react";

import { quietLinkClass } from "@/lib/ui";

const STAR_COUNT = 5;
const HALF = 0.5;

/** The half-step rating under the pointer, from its x inside the strip. */
const ratingAt = (strip: HTMLElement, clientX: number): number => {
	const { left, width } = strip.getBoundingClientRect();
	const fraction = Math.min(Math.max((clientX - left) / width, 0), 1);
	const halves = Math.ceil(fraction * STAR_COUNT * 2);
	return Math.max(halves * HALF, HALF);
};

/**
 * The rating as five stars you click or drag across (batch 8,
 * 2026-09-21): pointer down sets, pointer move while down keeps setting,
 * both in half steps; the rating under the pointer previews before the
 * pointer settles. The accessible control is a visually hidden range
 * input (0 to 5 by halves, 0 unrated) that the keyboard and screen readers
 * drive; the stars are its aria-hidden pointer surface. `null` is unrated,
 * all stars faded. Filled stars are ink like the read-only `Stars`; 24px here so a
 * half step is a real target.
 */
export const StarsInput = ({
	onChange,
	value,
}: {
	onChange: (next: number | null) => void;
	value: number | null;
}) => {
	const strip = useRef<HTMLDivElement>(null);
	const [preview, setPreview] = useState<number | null>(null);
	const shown = preview ?? value ?? 0;

	const set = (clientX: number) => {
		if (strip.current === null) {
			return;
		}
		onChange(ratingAt(strip.current, clientX));
	};

	return (
		<div className="flex items-center gap-3">
			<div className="relative inline-flex">
				{/* The real control: a range for the keyboard and the screen reader; 0 is unrated. */}
				<input
					aria-label="Rating"
					aria-valuetext={value === null ? "Unrated" : `${value} out of 5`}
					className="peer sr-only"
					max={STAR_COUNT}
					min={0}
					onChange={(event) => {
						const next = Number(event.target.value);
						onChange(next === 0 ? null : next);
					}}
					step={HALF}
					type="range"
					value={value ?? 0}
				/>
				<div
					aria-hidden
					className="inline-flex cursor-pointer touch-none items-center gap-1 peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-current"
					onPointerDown={(event) => {
						event.currentTarget.setPointerCapture(event.pointerId);
						set(event.clientX);
					}}
					onPointerLeave={() => {
						setPreview(null);
					}}
					onPointerMove={(event) => {
						if (strip.current === null) {
							return;
						}
						const under = ratingAt(strip.current, event.clientX);
						if (event.buttons === 1) {
							onChange(under);
						} else if (event.pointerType === "mouse") {
							setPreview(under);
						}
					}}
					onPointerUp={(event) => {
						event.currentTarget.releasePointerCapture(event.pointerId);
						setPreview(null);
					}}
					ref={strip}
				>
					{Array.from({ length: STAR_COUNT }, (_, index) => index + 1).map(
						(position) => {
							const fill = Math.min(Math.max(shown - (position - 1), 0), 1);
							return (
								<span className="relative inline-block" key={position}>
									<Star className="text-muted-foreground/40 size-6" />
									<span
										className="absolute inset-0 overflow-hidden"
										style={{ width: `${fill * 100}%` }}
									>
										<Star className="size-6 fill-current text-current" />
									</span>
								</span>
							);
						}
					)}
				</div>
			</div>
			<span className="text-muted-foreground tnum w-8 text-xs">
				{value === null ? "" : value}
			</span>
			{value !== null && (
				<button
					className={quietLinkClass}
					onClick={() => {
						onChange(null);
					}}
					type="button"
				>
					Clear
				</button>
			)}
		</div>
	);
};
