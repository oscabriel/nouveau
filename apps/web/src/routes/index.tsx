import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";

import { DropIndex } from "@/components/drop-index";
import { LatestTiles } from "@/components/latest-tiles";
import Loader from "@/components/loader";
import { NextBagLink } from "@/components/next-bag-sheet";
import { SignInCta } from "@/components/sign-in-cta";

/*
 * Direction contract (owner-pinned references, 2026-09-16):
 * THESIS: Nouveau is an index, not a store. One column, centered, sparse;
 *   the page refuses the two-column pitch-plus-feed landing and every card.
 * OWN-WORLD: white ground, black type, one grey, hairline rules, square
 *   corners. Grotesk caps labels at 11px tracked; a Garamond for the
 *   wordmark, the titles and the one sentence of prose (amended 2026-09-21,
 *   was grotesk wordmark + serif lede only). No accent color; the only color
 *   is the coffee itself (Thornton's 1808 Coffea arabica branch, lot photos).
 * STORY: a visitor sees the name with the specimen through it, one
 *   sentence, three lots, then the whole recent index; they open a lot, a
 *   roaster, or sign in.
 * FIRST VIEWPORT: caps nav top; the NOUVEAU wordmark spanning the width with
 *   the branch threaded through the V; serif sentence; the primary button
 *   (sign in, or Find my next bag signed in, ADR-0014); LATEST/SHUFFLE and
 *   the tiles start just above the fold at 1440x900.
 * FORM: reference-pinned (theindex.website structure, vanschneider.com
 *   row hover). Code-led, no comp.
 */

/** How many drop events the landing index lists. */
const INDEX_LIMIT = 50;

/**
 * The one filled control, shared slot: sign in signed out, Find my next bag
 * signed in (ADR-0014). Same block, same height; copy and destination differ
 * by state.
 */
const PrimarySlot = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	if (isLoading) {
		return null;
	}
	if (isAuthenticated) {
		return <NextBagLink />;
	}
	return <SignInCta />;
};

/**
 * The branch behind the V: a link to the species' Wikipedia article, with a
 * soft glow inside the drawing that follows the cursor (owner, 2026-09-21).
 * The glow is a radial gradient masked to the webp's own alpha, so it lights
 * the leaves and berries and never the paper around them. Mouse only: the
 * position updates on mouse pointer moves, and `motion-reduce` hides the
 * layer. The V stays in front and outside the link.
 */
const BranchLink = () => {
	const [glow, setGlow] = useState<{ x: number; y: number } | null>(null);
	return (
		<a
			aria-label="Coffea arabica on Wikipedia"
			className="absolute top-1/2 left-1/2 z-10 block h-[2.05em] -translate-x-1/2 -translate-y-[54%]"
			href="https://en.wikipedia.org/wiki/Coffea_arabica"
			onPointerLeave={() => {
				setGlow(null);
			}}
			onPointerMove={(event) => {
				if (event.pointerType !== "mouse") {
					return;
				}
				const box = event.currentTarget.getBoundingClientRect();
				setGlow({
					x: ((event.clientX - box.left) / box.width) * 100,
					y: ((event.clientY - box.top) / box.height) * 100,
				});
			}}
			rel="noreferrer"
			target="_blank"
		>
			<img
				alt=""
				className="h-full w-auto max-w-none"
				fetchPriority="high"
				height={1160}
				src="/coffea-arabica.webp"
				width={1112}
			/>
			<span
				aria-hidden
				className={`pointer-events-none absolute inset-0 transition-opacity duration-300 motion-reduce:hidden ${
					glow === null ? "opacity-0" : "opacity-100"
				}`}
				style={{
					background: `radial-gradient(circle at ${glow?.x ?? 50}% ${glow?.y ?? 50}%, rgb(255 255 255 / 0.55), transparent 28%)`,
					maskImage: "url(/coffea-arabica.webp)",
					maskSize: "100% 100%",
					WebkitMaskImage: "url(/coffea-arabica.webp)",
					WebkitMaskSize: "100% 100%",
				}}
			/>
		</a>
	);
};

/**
 * The wordmark (owner's mock, 2026-09-21): NOUVEAU in Garamond italic
 * spanning the viewport, three layers deep. NOU and EAU sit at the back, the Thornton
 * branch in front of them, and the V in front of the branch, so the branch
 * threads through the word instead of sitting beside it. The letters are
 * hidden from assistive tech (the h1 carries the name); the branch link is
 * not, so it stays reachable.
 */
const Wordmark = () => (
	<h1
		aria-label="Nouveau"
		className="relative w-full font-serif text-[17.5vw] leading-none font-normal tracking-[-0.01em] uppercase italic"
	>
		<span className="flex items-baseline justify-center">
			<span aria-hidden="true">Nou</span>
			<span className="relative inline-block">
				<BranchLink />
				<span aria-hidden="true" className="relative z-20">
					V
				</span>
			</span>
			<span aria-hidden="true">eau</span>
		</span>
	</h1>
);

/** One page for both states (ADR-0014); only the primary slot differs. */
const LandingComponent = () => {
	const feed = useQuery(api.feed.globalFeed, { limit: INDEX_LIMIT });
	return (
		<main>
			<section className="flex flex-col items-center px-5 pt-[14vw] text-center md:pt-[9vw]">
				<Wordmark />
				<p className="mt-[9vw] max-w-[44rem] font-serif text-[1.5rem] leading-[1.25] text-balance md:text-[1.875rem]">
					Never forget your favorite cup or miss the next big drop.
				</p>
				<div className="mt-6 min-h-11">
					<PrimarySlot />
				</div>
			</section>

			{feed === undefined ? (
				<div className="py-24">
					<Loader />
				</div>
			) : (
				<>
					<div className="mt-16 px-5 md:mt-14 md:px-10">
						<LatestTiles />
					</div>
					<div className="mt-16 px-5 md:mt-20 md:px-10">
						<DropIndex rows={feed} />
					</div>
				</>
			)}
		</main>
	);
};

export const Route = createFileRoute("/")({
	component: LandingComponent,
});
