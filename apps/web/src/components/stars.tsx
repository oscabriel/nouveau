import { Star } from "lucide-react";

/**
 * Five stars with half-step fills (spec §14.1: 1–5, half steps allowed).
 * Filled stars take the current text color: ink on the page in either
 * theme, black on the tile's white chip (ADR-0014). Empty stars are the
 * faded grey. No hue; the rating is a value, not a decoration.
 */
export const Stars = ({ rating }: { rating: number }) => (
	<span className="inline-flex items-center gap-0.5">
		<span className="sr-only">{`Rated ${rating} out of 5`}</span>
		{[1, 2, 3, 4, 5].map((position) => {
			const fill = Math.min(Math.max(rating - (position - 1), 0), 1);
			return (
				<span className="relative inline-block" key={position}>
					<Star aria-hidden className="text-muted-foreground/40 size-4" />
					<span
						aria-hidden
						className="absolute inset-0 overflow-hidden"
						style={{ width: `${fill * 100}%` }}
					>
						<Star className="size-4 fill-current text-current" />
					</span>
				</span>
			);
		})}
	</span>
);
