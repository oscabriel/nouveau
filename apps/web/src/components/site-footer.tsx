import { Link } from "@tanstack/react-router";

import stamens from "@/assets/coffea-arabica/02-five-stamina.webp";
import { navLinkClass } from "@/lib/ui";

const scrollToTop = () => {
	window.scrollTo({ behavior: "smooth", top: 0 });
};

/**
 * Site footer. Every route ends in it (ADR-0012, amended 2026-09-21). One
 * row of caps links: NOUVEAU, ROASTERS, DROPS left, mirroring the header,
 * BACK TO THE TOP centered again (owner, 2026-09-21: out and back the same
 * day), ABOUT and GITHUB right; no user links. Below `md` the row stacks
 * as three left-aligned rows: the left links, BACK TO THE TOP, then ABOUT
 * and GITHUB (owner, 2026-09-21), no flex-wrap. Under a hairline NOUVEAU.COFFEE
 * set huge in the Garamond italic of the landing wordmark, and the flower (the
 * plate's five-stamen detail) under it, the bottom-most thing on the page
 * (owner, 2026-09-21; beside the wordmark before). The webp is square with the
 * drawing at 448x361 inside a 540x540 canvas (margins 46 and 90, symmetric),
 * so the visible drawing is 0.67 of the element height; at the wordmark's
 * own font-size the drawing then matches the caps' cap height exactly.
 * The other plate details left with the captions; the flower keeps its alt
 */
export const SiteFooter = () => (
	<footer className="mt-32 md:mt-40">
		<div className="flex flex-col items-start gap-y-0 px-5 pt-4 pb-5 md:flex-row md:items-center md:justify-between md:gap-x-6 md:px-10">
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
		<div className="border-t px-5 pt-6 pb-10 md:px-10 md:pt-7 md:pb-12">
			<div className="flex flex-col items-center gap-y-6 md:items-end">
				<p className="w-full text-center font-serif text-[10.5vw] leading-none tracking-[-0.01em] uppercase italic md:w-auto md:text-right md:text-[8.5vw]">
					Nouveau.coffee
				</p>
				<a
					className="group"
					href="https://en.wikipedia.org/wiki/Coffea_arabica"
				>
					<img
						alt="The flower of Coffea arabica, five white petals with the stamens showing, engraved and hand-colored for Robert Thornton in 1808"
						className="h-32 w-auto transition-opacity group-hover:opacity-80 md:h-[8.5vw]"
						height={540}
						loading="lazy"
						src={stamens}
						width={540}
					/>
				</a>
			</div>
		</div>
	</footer>
);
