import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { FeedCard } from "@/components/feed-card";
import { GlobalFeed } from "@/components/global-feed";
import Loader from "@/components/loader";
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

/** How many roaster pills the signed-out home shows before "All roasters". */
const TEASER_LIMIT = 8;

const RoasterTeaser = () => {
	const roasters = useQuery(api.roasters.listActive, {});
	if (roasters === undefined || roasters.length === 0) {
		return null;
	}
	const shown = roasters.slice(0, TEASER_LIMIT);
	return (
		<section className="mt-10">
			<div className="mb-3 flex items-baseline justify-between gap-4">
				<h2 className="font-semibold">Roasters being watched</h2>
				<Link className="text-sm hover:underline" to="/roasters">
					All {roasters.length} roasters
				</Link>
			</div>
			<div className="flex flex-wrap gap-2">
				{shown.map((roaster) => (
					<Link
						className="hover:bg-accent inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors"
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

const HomeComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();

	if (isLoading) {
		return <Loader />;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			{isAuthenticated ? (
				<>
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
					<PersonalizedFeed />
				</>
			) : (
				<>
					<header className="mb-8">
						<h1 className="text-3xl font-semibold tracking-tight">
							Know the moment coffee drops
						</h1>
						<p className="text-muted-foreground mt-2 max-w-prose">
							Nouveau watches specialty roasters&apos; shops around the clock
							and tells you when a new lot lands, a sold-out one comes back, or
							a price drops. This feed is live. No account needed.
						</p>
						<div className="mt-4">
							<SignInCta />
						</div>
					</header>
					<section>
						<h2 className="mb-3 font-semibold">Live now</h2>
						<GlobalFeed />
					</section>
					<RoasterTeaser />
				</>
			)}
		</div>
	);
};

export const Route = createFileRoute("/")({
	component: HomeComponent,
});
