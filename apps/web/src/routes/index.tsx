import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowRight } from "lucide-react";

import { FeedCard } from "@/components/feed-card";
import { GlobalFeed } from "@/components/global-feed";
import Loader from "@/components/loader";
import { SavedCoffeeCard } from "@/components/saved-coffee-card";
import { SignInCta } from "@/components/sign-in-cta";
import { HealthDot } from "@/components/status-chip";

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
					className="mb-4 block rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 hover:underline dark:text-amber-400"
					to="/watches"
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

/** How many roaster pills the signed-out home shows before "All roasters". */
const TEASER_LIMIT = 8;

const RoasterTeaser = () => {
	const roasters = useQuery(api.roasters.listActive, {});
	if (roasters === undefined || roasters.length === 0) {
		return null;
	}
	const shown = roasters.slice(0, TEASER_LIMIT);
	return (
		<section className="mt-12">
			<div className="mb-3 flex items-baseline justify-between gap-4">
				<h2 className="font-semibold">Roasters being watched</h2>
				<Link className="text-sm hover:underline" to="/roasters">
					All {roasters.length} roasters
				</Link>
			</div>
			<div className="flex flex-wrap gap-2">
				{shown.map((roaster) => (
					<Link
						className="bg-card hover:bg-accent inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors"
						key={roaster.id}
						params={{ slug: roaster.slug }}
						to="/roasters/$slug"
					>
						<HealthDot health={roaster.status.health} />
						{roaster.name}
					</Link>
				))}
			</div>
		</section>
	);
};

/**
 * Signed-out home. Persuade duty: the live global feed is the proof, sitting
 * right beside the pitch; on desktop the pitch sticks so the sign-in CTA
 * stays in view while the feed scrolls. Real data only — the feed and the
 * roaster pills are the same queries the signed-in app reads.
 *
 * Direction contract (brief-pinned from spec §8 and handoff 3f; no roll run):
 * THESIS: the live feed is the hero, proof before persuasion; the page
 *   refuses the stock landing-page stack of feature cards and testimonials.
 * OWN-WORLD: light neutral ground, graphite text, one deep blue action
 *   color; hairline-divided typographic feed rows, no card containers.
 * STORY: a visitor understands what Nouveau watches, sees real drops
 *   arriving, and signs in or browses the directory.
 * FIRST VIEWPORT: two columns at desktop — pitch and CTA left, live feed
 *   right; the pitch sticks while the feed scrolls. Mobile stacks pitch,
 *   feed, directory.
 * FORM: brief-pinned (spec §8 vocabulary); composition shaped directly from
 *   build-spec §11's locked signed-out-home contents.
 */
const SignedOutHome = () => (
	<div className="mx-auto w-full max-w-6xl px-4 md:px-6">
		<div className="grid gap-2 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-0">
			<section className="flex flex-col pt-10 pb-4 md:sticky md:top-6 md:self-start md:pt-14 md:pb-0">
				<h1 className="max-w-md text-4xl font-semibold tracking-tight text-balance md:text-[2.75rem] md:leading-[1.1]">
					Know the moment coffee drops
				</h1>
				<p className="text-muted-foreground mt-4 max-w-[34rem] leading-relaxed">
					Nouveau watches specialty roasters&apos; shops around the clock and
					tells you when a new lot lands, a sold-out one comes back, or a price
					drops. The feed beside this is live; no account needed to read it.
				</p>
				<div className="mt-7">
					<SignInCta />
				</div>
				<Link
					className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium hover:underline"
					to="/roasters"
				>
					Browse the roaster directory
					<ArrowRight aria-hidden className="size-4" />
				</Link>
				<p className="text-muted-foreground mt-8 max-w-sm text-sm leading-relaxed">
					Buying happens at the roaster. Nouveau watches their shops, keeps your
					coffee history, and links out when it&apos;s time to buy.
				</p>
			</section>
			<section className="min-w-0 pb-16 md:border-l md:py-14 md:pl-12">
				<div className="mb-1 flex items-baseline justify-between gap-4">
					<h2 className="flex items-center gap-2 font-semibold">
						Live now
						<span
							aria-hidden
							className="inline-block size-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"
						/>
					</h2>
					<Link className="text-sm hover:underline" to="/feed">
						Full feed
					</Link>
				</div>
				<GlobalFeed limit={8} />
				<RoasterTeaser />
			</section>
		</div>
	</div>
);

/** Signed-in home; reshaped into the My coffee page in its own task. */
const SignedInHome = () => (
	<div className="mx-auto max-w-3xl px-4 py-8">
		<header className="mb-6 flex items-baseline justify-between gap-4">
			<h1 className="text-2xl font-semibold">Your roasters</h1>
			<nav className="flex gap-4 text-sm">
				<Link className="hover:underline" to="/feed">
					Live feed
				</Link>
				<Link className="hover:underline" to="/roasters">
					All roasters
				</Link>
				<Link className="hover:underline" to="/watches">
					Your watches
				</Link>
			</nav>
		</header>
		<Link
			className="text-primary mb-6 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
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
