import { Link } from "@tanstack/react-router";

import stamens from "@/assets/coffea-arabica/02-five-stamina.webp";
import { navLinkClass } from "@/lib/ui";

const scrollToTop = () => {
	window.scrollTo({ behavior: "smooth", top: 0 });
};

/**
 * Site footer. Every route ends in it (ADR-0012, amended 2026-09-21). One
 * row of caps links: NOUVEAU, ROASTERS, DROPS left, mirroring the header;
 * ABOUT and GITHUB right; no user links. Under a hairline, the flower (the
 * plate's five-stamen detail) with BACK TO THE TOP beneath it, and beside
 * them NOUVEAU.COFFEE set huge in the Garamond italic of the landing
 * wordmark. The other plate details left with the captions; the flower
 * keeps its alt text and its Wikipedia link, so nothing here is aria-hidden.
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
		<div className="border-t px-5 pt-12 pb-10 md:px-10 md:pt-16 md:pb-12">
			<div className="flex flex-col items-center gap-y-10 md:flex-row md:items-end md:justify-between md:gap-x-12">
				<div className="flex flex-col items-center">
					<a
						className="group"
						href="https://en.wikipedia.org/wiki/Coffea_arabica"
					>
						<img
							alt="The flower of Coffea arabica, five white petals with the stamens showing, engraved and hand-colored for Robert Thornton in 1808"
							className="h-40 w-auto transition-opacity group-hover:opacity-80 md:h-52"
							height={540}
							loading="lazy"
							src={stamens}
							width={540}
						/>
					</a>
					<button
						className={`${navLinkClass} -mt-2`}
						onClick={scrollToTop}
						type="button"
					>
						Back to the top
					</button>
				</div>
				<p className="w-full text-center font-serif text-[10.5vw] leading-none tracking-[-0.01em] uppercase italic md:w-auto md:text-right md:text-[8.5vw]">
					Nouveau.coffee
				</p>
			</div>
		</div>
	</footer>
);
