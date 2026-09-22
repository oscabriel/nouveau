import { Link } from "@tanstack/react-router";

import { navLinkClass } from "@/lib/ui";

const scrollToTop = () => {
	window.scrollTo({ behavior: "smooth", top: 0 });
};

/**
 * Site footer. Every route ends in it (ADR-0012, amended 2026-09-21). One
 * row of caps links: NOUVEAU, ROASTERS, DROPS left, mirroring the header,
 * BACK TO THE TOP centered, ABOUT and GITHUB right; no user links. Below
 * `md` the row becomes two columns like the header, left links at the left
 * edge and right links at the right edge, and BACK TO THE TOP is hidden
 * (owner, 2026-09-21). Under a hairline, NOUVEAU.COFFEE set huge in the
 * Garamond italic of the landing wordmark. The flower (the plate's
 * five-stamen detail) sits to its left from `md`, at the page's left edge
 * with both bottoms flush; below `md` it stacks under the wordmark, the
 * bottom-most thing on the page. The webp is square with the drawing at
 * 448x361 inside a 540x540 canvas (margins 46 and 90, symmetric), so at the
 * wordmark's own font-size the drawing matches the caps' cap height.
 */
export const SiteFooter = () => (
	<footer className="mt-32 md:mt-40">
		<div className="flex items-start justify-between gap-x-6 px-5 pt-4 pb-5 md:items-center md:px-10">
			<nav
				aria-label="Footer"
				className="flex flex-col items-start md:flex-row md:items-center md:gap-x-5"
			>
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
			<div className="hidden md:block">
				<button className={navLinkClass} onClick={scrollToTop} type="button">
					Back to the top
				</button>
			</div>
			<nav className="flex flex-col items-end md:flex-row md:items-center md:gap-x-5">
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
		<div className="border-t px-5 pt-6 pb-10 md:px-10 md:pt-7 md:pb-12">
			<div className="flex flex-col items-center gap-y-6 md:flex-row md:items-end md:justify-between">
				<p className="w-full text-center font-serif text-[10.5vw] leading-none tracking-[-0.01em] uppercase italic md:order-last md:w-auto md:text-right md:text-[8.5vw]">
					Nouveau.coffee
				</p>
				<a
					className="group md:order-first"
					href="https://en.wikipedia.org/wiki/Coffea_arabica"
				>
					<img
						alt="The flower of Coffea arabica, five white petals with the stamens showing, engraved and hand-colored for Robert Thornton in 1808"
						className="h-32 w-auto transition-opacity group-hover:opacity-80 md:h-[8.5vw]"
						height={540}
						loading="lazy"
						src="/coffea-arabica-flower.webp"
						width={540}
					/>
				</a>
			</div>
		</div>
	</footer>
);
