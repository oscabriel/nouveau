import { Link } from "@tanstack/react-router";

import branch from "@/assets/coffea-arabica/01-branch.webp";
import stamens from "@/assets/coffea-arabica/02-five-stamina.webp";
import pistil from "@/assets/coffea-arabica/03-pistillium.webp";
import berry from "@/assets/coffea-arabica/04-berry.webp";
import berryHalves from "@/assets/coffea-arabica/05-berry-halves.webp";
import seed from "@/assets/coffea-arabica/06-seed.webp";
import arilCup from "@/assets/coffea-arabica/07-arillus-cup.webp";
import { navLinkClass } from "@/lib/ui";

const scrollToTop = () => {
	window.scrollTo({ behavior: "smooth", top: 0 });
};

/** One engraved detail with its Caveat caption naming the part and its Wikipedia article. */
const PlateDetail = ({
	alt,
	caption,
	height,
	src,
	wiki,
}: {
	alt: string;
	caption: string;
	/* Rendered height in px; inline, because preflight's height:auto beats the attribute. */
	height: number;
	src: string;
	wiki: string;
}) => (
	<a
		className="group inline-flex flex-col items-center gap-3"
		href={`https://en.wikipedia.org/wiki/${wiki}`}
	>
		<img
			alt={alt}
			className="transition-opacity group-hover:opacity-80"
			src={src}
			style={{ height, width: "auto" }}
		/>
		<span className="font-caveat text-foreground text-2xl leading-none md:text-3xl">
			{caption}
		</span>
	</a>
);

/** The two berry details share the one caption; Drupe is the fruit's name. */
const DrupePair = () => (
	<figure className="inline-flex flex-col items-center gap-3">
		<div className="flex items-center gap-5 md:gap-6">
			<a href="https://en.wikipedia.org/wiki/Drupe" className="group">
				<img
					alt="A ripe Coffea arabica cherry, whole, engraved and hand-colored for Thornton in 1808"
					className="h-16 w-auto md:h-20"
					src={berry}
				/>
			</a>
			<a href="https://en.wikipedia.org/wiki/Drupe" className="group">
				<img
					alt="A Coffea arabica cherry cut in half, showing the two seeds in the pulp, engraved and hand-colored for Thornton in 1808"
					className="h-16 w-auto md:h-20"
					src={berryHalves}
				/>
			</a>
		</div>
		<a href="https://en.wikipedia.org/wiki/Drupe">
			<figcaption className="font-caveat text-foreground text-2xl leading-none md:text-3xl">
				Drupe
			</figcaption>
		</a>
	</figure>
);

/**
 * Site footer. Every route ends in it (ADR-0012). One row of caps links
 * mirroring the header on the left, BACK TO THE TOP centered, ABOUT and
 * GITHUB right, no user links. Below the links, the plate's parts with
 * Caveat captions naming each part and linking its Wikipedia article, and
 * the branch, much larger, linking Coffea arabica. The captions are
 * content: every image carries alt text and nothing here is aria-hidden.
 */
export const SiteFooter = () => (
	<footer className="mt-32 md:mt-40">
		<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 pt-4 pb-5 md:px-10">
			<nav aria-label="Footer" className="flex gap-4 md:gap-5">
				<Link className={navLinkClass} to="/">
					Nouveau
				</Link>
				<Link className={navLinkClass} to="/roasters">
					Roasters
				</Link>
				<Link className={navLinkClass} to="/drops">
					Drops
				</Link>
			</nav>
			<button className={navLinkClass} onClick={scrollToTop} type="button">
				Back to the top
			</button>
			<nav className="flex gap-4 md:gap-5">
				<Link className={navLinkClass} to="/about">
					About
				</Link>
				<a
					className={navLinkClass}
					href="https://github.com/oscabriel/nouveau"
					rel="noreferrer"
					target="_blank"
				>
					GitHub
				</a>
			</nav>
		</div>
		<div className="border-t px-5 pt-12 pb-14 md:px-10 md:pt-16">
			<div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-12">
				<div className="flex flex-wrap items-end gap-x-10 gap-y-10 md:gap-x-12">
					<PlateDetail
						alt="Five stamens of Coffea arabica, the flower's pollen-bearing organs, engraved and hand-colored for Thornton in 1808"
						caption="Stamen"
						height={112}
						src={stamens}
						wiki="Stamen"
					/>
					<PlateDetail
						alt="The gynoecium of Coffea arabica, the flower's pistil, engraved and hand-colored for Thornton in 1808"
						caption="Gynoecium"
						height={128}
						src={pistil}
						wiki="Gynoecium"
					/>
					<DrupePair />
					<PlateDetail
						alt="A seed of Coffea arabica, a coffee bean, engraved and hand-colored for Thornton in 1808"
						caption="Seed"
						height={96}
						src={seed}
						wiki="Seed"
					/>
					<PlateDetail
						alt="A Coffea arabica seed sitting in its aril cup, engraved and hand-colored for Thornton in 1808"
						caption="Aril"
						height={96}
						src={arilCup}
						wiki="Aril"
					/>
				</div>
				<a
					className="group"
					href="https://en.wikipedia.org/wiki/Coffea_arabica"
				>
					<img
						alt="The full Coffea arabica plate: a flowering and fruiting branch, engraved and hand-colored for Robert Thornton in 1808"
						className="h-44 w-auto transition-opacity group-hover:opacity-80 md:h-64"
						src={branch}
					/>
				</a>
			</div>
		</div>
	</footer>
);
