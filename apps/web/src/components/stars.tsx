import { Star } from "lucide-react";

/**
 * Five stars with half-step fills (spec §14.1: 1–5, half steps allowed).
 * The landing's tiles render the rating in ink over the white chip
 * (ADR-0014); every other mount keeps the amber fill.
 */
export const Stars = ({
	rating,
	tone = "amber",
}: {
	rating: number;
	tone?: "amber" | "ink";
}) => (
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
						<Star
							className={`size-4 ${
								tone === "ink"
									? "fill-neutral-950 text-neutral-950"
									: "fill-amber-400 text-amber-400"
							}`}
						/>
					</span>
				</span>
			);
		})}
	</span>
);
