import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";

import Loader from "@/components/loader";
import { Stars } from "@/components/stars";
import { thumbUrl } from "@/lib/drops";

const toggleClass =
	"label-caps inline-flex min-h-11 items-center text-muted-foreground transition-colors aria-pressed:text-foreground";

/**
 * The landing's three tiles (ADR-0014): the most recent rated logs whose lot
 * has a photo, padded with recent drops until three ratings exist, one per
 * taster. Each tile carries the rating as black stars in the top-right,
 * over the same white chip treatment as the name. The active word of the
 * LATEST / SHUFFLE pair is underlined, like an active nav link; the dot is
 * gone. Shuffle redraws server-side from the recent pool through the seed.
 */
export const LatestTiles = () => {
	const [seed, setSeed] = useState<number | undefined>();
	const tiles = useQuery(
		api.tiles.ratedTiles,
		seed === undefined ? {} : { shuffleSeed: seed }
	);

	if (tiles === undefined) {
		return (
			<section aria-label="Latest">
				<div className="flex items-center gap-5">
					<button aria-pressed className={toggleClass} type="button">
						Latest
					</button>
					<button aria-pressed={false} className={toggleClass} type="button">
						Shuffle
					</button>
				</div>
				<div className="mt-3 grid gap-4 md:grid-cols-3 md:gap-6">
					<div className="bg-muted aspect-[3/2]" />
					<div className="bg-muted aspect-[3/2]" />
					<div className="bg-muted aspect-[3/2]" />
				</div>
			</section>
		);
	}
	if (tiles.length === 0) {
		return (
			<section aria-labelledby="latest-heading">
				<h2 className="label-caps text-foreground" id="latest-heading">
					Latest
				</h2>
				<div className="mt-3">
					<Loader />
				</div>
			</section>
		);
	}

	return (
		<section aria-labelledby="latest-heading">
			<div className="flex items-center gap-5">
				<button
					aria-pressed={seed === undefined}
					className={`${toggleClass} ${
						seed === undefined ? "underline underline-offset-4" : ""
					}`}
					id="latest-heading"
					onClick={() => {
						setSeed(undefined);
					}}
					type="button"
				>
					Latest
				</button>
				<button
					aria-pressed={seed !== undefined}
					className={`${toggleClass} ${
						seed === undefined ? "" : "underline underline-offset-4"
					}`}
					onClick={() => {
						setSeed(Date.now());
					}}
					type="button"
				>
					Shuffle
				</button>
			</div>
			<ul className="mt-3 grid gap-4 md:grid-cols-3 md:gap-6">
				{tiles.map((tile) => (
					<li key={`${tile.kind}-${tile.id}`}>
						<Link
							className="bg-muted group relative block aspect-[3/2] overflow-hidden"
							params={{ lot: tile.handle, roaster: tile.roaster.slug }}
							to="/roaster/$roaster/$lot"
						>
							<img
								alt={tile.name}
								className="size-full object-cover"
								decoding="async"
								loading="lazy"
								src={thumbUrl(tile.imageUrl, 900)}
							/>
							<span className="absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate bg-white px-2.5 py-1.5 text-[13px] leading-none text-neutral-950">
								{tile.name}
							</span>
							{tile.rating !== null && (
								<span className="absolute top-3 right-3 bg-white px-2 py-1.5 leading-none text-neutral-950">
									<Stars rating={tile.rating} />
								</span>
							)}
						</Link>
					</li>
				))}
			</ul>
		</section>
	);
};
