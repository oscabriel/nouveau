import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";

import { DotToggle } from "@/components/dot-toggle";
import { Loader } from "@/components/loader";
import { Stars } from "@/components/stars";
import { thumbUrl } from "@/lib/drops";

/**
 * The landing's three tiles (ADR-0014): the most recent rated logs whose lot
 * has a photo, padded with recent drops until three ratings exist, one per
 * taster. Each tile carries the rating as black stars in the top-right,
 * over the same white chip treatment as the name, with the rater's name
 * under the stars linking their /$user page. The chip sits beside the lot
 * link, not inside it, so the two links never nest. LATEST / SHUFFLE is a
 * DotToggle pair like every other selected-or-not control (owner,
 * 2026-09-21: the dot means selected, site-wide). Shuffle redraws
 * server-side from the recent pool through the seed.
 */
const noop = () => {
	// The loading state shows the pair in place; nothing to toggle yet.
};

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
					<DotToggle onClick={noop} pressed>
						Latest
					</DotToggle>
					<DotToggle onClick={noop} pressed={false}>
						Shuffle
					</DotToggle>
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
				<DotToggle
					id="latest-heading"
					onClick={() => {
						setSeed(undefined);
					}}
					pressed={seed === undefined}
				>
					Latest
				</DotToggle>
				<DotToggle
					onClick={() => {
						setSeed(Date.now());
					}}
					pressed={seed !== undefined}
				>
					Shuffle
				</DotToggle>
			</div>
			<ul className="mt-3 grid gap-4 md:grid-cols-3 md:gap-6">
				{tiles.map((tile) => (
					<li className="relative" key={`${tile.kind}-${tile.id}`}>
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
						</Link>
						{tile.rating !== null && (
							<span className="absolute top-3 right-3 flex flex-col items-end gap-1.5 bg-white px-2 py-1.5 leading-none text-neutral-950">
								<Stars rating={tile.rating} />
								{tile.taster !== null && (
									<Link
										className="max-w-40 truncate text-[11px] leading-none text-neutral-600 hover:text-neutral-950 hover:underline"
										params={{ user: tile.taster.address }}
										to="/$user"
									>
										{tile.taster.name ?? "A taster"}
									</Link>
								)}
							</span>
						)}
					</li>
				))}
			</ul>
		</section>
	);
};
