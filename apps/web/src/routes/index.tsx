import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { DropIndex } from "@/components/drop-index";
import { FeedCard } from "@/components/feed-card";
import { LatestTiles } from "@/components/latest-tiles";
import Loader from "@/components/loader";
import { SavedCoffeeCard } from "@/components/saved-coffee-card";
import { SignInCta } from "@/components/sign-in-cta";
import { SiteFooter } from "@/components/site-footer";

/*
 * Direction contract (owner-pinned to two references, 2026-09-16; the
 * pinned brief beats the roll, so no concept-seed run):
 * THESIS: Nouveau is an index, not a store. One column, centered, sparse;
 *   the page refuses the two-column pitch-plus-feed landing and every card.
 * OWN-WORLD: white ground, black type, one grey, hairline rules, square
 *   corners. Grotesk caps labels at 11px tracked; a text serif for the one
 *   sentence of prose. No accent color; the only color is the coffee itself
 *   (Thornton's 1808 Coffea arabica plate, lot photos).
 * STORY: a visitor sees a specimen, a name, one sentence, three lots, then
 *   the whole recent index; they open a lot, a roaster, or sign in.
 * FIRST VIEWPORT: caps nav top; plate centered ~260px tall; NOUVEAU
 *   wordmark; serif sentence; sign-in block; LATEST/SHUFFLE and three tiles
 *   start at the fold.
 * SIGNATURE: table row hover slides the lot photo in from the left over its
 *   number; footer wordmark NOUVEAU.COFFEE at 22vw scrolls, cropped at the
 *   baseline.
 * FORM: reference-pinned (theindex.website structure, vanschneider.com
 *   row hover). Code-led, no comp.
 * FINISH: unreviewed and undocumented is unfinished; this build ends with
 *   the finish review, the verdict, DESIGN.md, and every shipping raster
 *   carrying its provenance.
 */

/** How many drop events the landing index lists. */
const INDEX_LIMIT = 50;

const SignedOutHome = () => {
	const feed = useQuery(api.feed.globalFeed, { limit: INDEX_LIMIT });
	return (
		<main>
			<section className="flex flex-col items-center px-5 pt-14 text-center md:pt-20">
				<img
					alt="Coffea arabica: a flowering, fruiting branch, engraved and hand-colored for Robert Thornton in 1808"
					className="h-56 w-auto md:h-[17rem]"
					fetchPriority="high"
					height={900}
					src="/coffea-arabica.png"
					width={580}
				/>
				<h1 className="mt-10 text-[1.75rem] leading-none font-semibold tracking-[0.01em] uppercase md:mt-12 md:text-[2.25rem]">
					Nouveau
				</h1>
				<p className="mt-4 max-w-[44rem] font-serif text-[1.375rem] leading-[1.3] text-balance md:text-[1.75rem]">
					A live index of American specialty coffee. Every new lot, restock and
					price drop from the roasters we watch, and a place to remember what
					you tried.
				</p>
				<div className="mt-9">
					<SignInCta />
				</div>
			</section>

			{feed === undefined ? (
				<div className="py-24">
					<Loader />
				</div>
			) : (
				<>
					<div className="mt-20 px-5 md:mt-28 md:px-10">
						<LatestTiles rows={feed} />
					</div>
					<div className="mt-20 px-5 md:mt-28 md:px-10">
						<DropIndex rows={feed} />
					</div>
				</>
			)}
			<SiteFooter />
		</main>
	);
};

const PersonalizedFeed = () => {
	const feed = useQuery(api.feed.personalizedFeed, {});
	const unhealthy = useQuery(api.feed.unhealthyWatches, {});
	if (feed === undefined || unhealthy === undefined) {
		return <Loader />;
	}
	return (
		<>
			{unhealthy.length > 0 && (
				<Link
					className="mb-4 block bg-amber-500/10 px-3 py-2 text-sm text-amber-700 hover:underline dark:text-amber-400"
					to="/settings/alerts"
				>
					{unhealthy.length === 1
						? `${unhealthy[0]?.name ?? "A roaster"} needs attention`
						: `${unhealthy.length} of your roasters need attention`}{" "}
					· check your watches
				</Link>
			)}
			{feed.length === 0 ? (
				<p className="text-muted-foreground py-8 text-sm">
					Nothing from your roasters yet. Find one to watch in the{" "}
					<Link className="underline" to="/roasters">
						roaster list
					</Link>
					.
				</p>
			) : (
				<div className="divide-y">
					{feed.map((card) => (
						<FeedCard card={card} key={card.eventId} />
					))}
				</div>
			)}
		</>
	);
};

/** The signed-in home's "Want to try" section; hidden until the first save. */
const WantToTry = () => {
	const saved = useQuery(api.savedCoffees.recentMine, {});
	if (saved === undefined || saved.items.length === 0) {
		return null;
	}
	return (
		<section className="mb-8">
			<div className="mb-1 flex items-baseline justify-between gap-4">
				<h2 className="font-semibold">Want to try</h2>
				<Link className="text-sm hover:underline" to="/saved">
					{saved.more ? "All saved lots" : "Saved lots"}
				</Link>
			</div>
			<div className="divide-y">
				{saved.items.map((item) => (
					<SavedCoffeeCard item={item} key={item.savedId} />
				))}
			</div>
		</section>
	);
};

/** Signed-in home; its redesign in the new world is a later task. */
const SignedInHome = () => (
	<div className="mx-auto max-w-3xl px-4 py-8">
		<header className="mb-6 flex items-baseline justify-between gap-4">
			<h1 className="text-2xl font-semibold">Your roasters</h1>
			<nav className="flex gap-4 text-sm">
				<Link className="hover:underline" to="/drops">
					Live feed
				</Link>
				<Link className="hover:underline" to="/roasters">
					All roasters
				</Link>
				<Link className="hover:underline" to="/settings/alerts">
					Your watches
				</Link>
			</nav>
		</header>
		<Link
			className="mb-6 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
			to="/next-bag"
		>
			Find my next bag
		</Link>
		<WantToTry />
		<PersonalizedFeed />
	</div>
);

const HomeComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();

	if (isLoading) {
		return <Loader />;
	}
	return isAuthenticated ? <SignedInHome /> : <SignedOutHome />;
};

export const Route = createFileRoute("/")({
	component: HomeComponent,
});
