import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { latestWithImages, shuffleWithImages, thumbUrl } from "@/lib/drops";
import type { DropRow } from "@/lib/drops";

const TILE_COUNT = 3;

type Mode = "latest" | "shuffle";

const toggleClass =
	"label-caps inline-flex min-h-11 items-center gap-2 text-muted-foreground transition-colors hover:text-foreground aria-pressed:text-foreground";

/**
 * Three lot photos, newest first, with a Shuffle toggle that redraws three
 * at random from the same feed. Each tile links to the lot page; the white
 * chip carries the lot name. Lots without a photo never appear here.
 */
export const LatestTiles = ({ rows }: { rows: DropRow[] }) => {
	const [mode, setMode] = useState<Mode>("latest");
	const [shuffled, setShuffled] = useState<DropRow[]>([]);
	const latest = latestWithImages(rows, TILE_COUNT);
	const shown = mode === "latest" ? latest : shuffled;

	if (latest.length === 0) {
		return null;
	}

	const reshuffle = () => {
		setShuffled(shuffleWithImages(rows, TILE_COUNT));
		setMode("shuffle");
	};

	return (
		<section aria-labelledby="latest-heading">
			<div className="flex items-center gap-5">
				<button
					aria-pressed={mode === "latest"}
					className={toggleClass}
					id="latest-heading"
					onClick={() => setMode("latest")}
					type="button"
				>
					<span
						aria-hidden
						className={`size-2 rounded-full bg-current transition-opacity ${mode === "latest" ? "opacity-100" : "opacity-0"}`}
					/>
					Latest
				</button>
				<button
					aria-pressed={mode === "shuffle"}
					className={toggleClass}
					onClick={reshuffle}
					type="button"
				>
					<span
						aria-hidden
						className={`size-2 rounded-full bg-current transition-opacity ${mode === "shuffle" ? "opacity-100" : "opacity-0"}`}
					/>
					Shuffle
				</button>
			</div>
			<ul className="mt-3 grid gap-4 md:grid-cols-3 md:gap-6">
				{shown.map((row) => (
					<li key={row.productId}>
						<Link
							className="bg-muted group relative block aspect-[3/2] overflow-hidden"
							params={{ lotId: row.productId }}
							to="/lots/$lotId"
						>
							{row.imageUrl !== null && (
								<img
									alt=""
									className="size-full object-cover"
									decoding="async"
									loading="lazy"
									src={thumbUrl(row.imageUrl, 900)}
								/>
							)}
							<span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate bg-white px-2.5 py-1.5 text-[13px] leading-none text-neutral-950">
								{row.productName}
							</span>
							<span className="sr-only">, {row.roasterName}</span>
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
};
