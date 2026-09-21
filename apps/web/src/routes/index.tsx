import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";

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
 *   corners. Grotesk caps labels at 11px tracked; a text serif for the one
 *   sentence of prose. No accent color; the only color is the coffee itself
 *   (Thornton's 1808 Coffea arabica plate, lot photos).
 * STORY: a visitor sees a specimen, a name, one sentence, three lots, then
 *   the whole recent index; they open a lot, a roaster, or sign in.
 * FIRST VIEWPORT: caps nav top; plate centered; NOUVEAU wordmark; serif
 *   sentence; the primary button (sign in, or Find my next bag signed in,
 *   ADR-0014); LATEST/SHUFFLE and three tiles start at the fold.
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

/** One page for both states (ADR-0014); only the primary slot differs. */
const LandingComponent = () => {
	const feed = useQuery(api.feed.globalFeed, { limit: INDEX_LIMIT });
	return (
		<main>
			<section className="flex flex-col items-center px-5 pt-14 text-center md:pt-20">
				<img
					alt="Coffea arabica: a flowering, fruiting branch, engraved and hand-colored for Robert Thornton in 1808"
					className="h-64 w-auto md:h-96"
					fetchPriority="high"
					height={1160}
					src="/coffea-arabica.webp"
					width={1112}
				/>
				<h1 className="mt-10 text-[1.75rem] leading-none font-semibold tracking-[0.01em] uppercase md:mt-12 md:text-[2.25rem]">
					Nouveau
				</h1>
				<p className="mt-4 max-w-[44rem] font-serif text-[1.375rem] leading-[1.3] text-balance md:text-[1.75rem]">
					A live index of American specialty coffee. Every new lot, restock and
					price drop from the roasters we watch, and a place to remember what
					you tried.
				</p>
				<div className="mt-9 min-h-11">
					<PrimarySlot />
				</div>
			</section>

			{feed === undefined ? (
				<div className="py-24">
					<Loader />
				</div>
			) : (
				<>
					<div className="mt-20 px-5 md:mt-28 md:px-10">
						<LatestTiles />
					</div>
					<div className="mt-20 px-5 md:mt-28 md:px-10">
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
