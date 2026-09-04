import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { FeedCard } from "@/components/feed-card";
import Loader from "@/components/loader";
import { Lots } from "@/components/lots";
import { StatusChip } from "@/components/status-chip";
import { WatchButton } from "@/components/watch-button";

const DropHistory = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const history = useQuery(api.feed.roasterFeed, { roasterId });
	if (history === undefined) {
		return <Loader />;
	}
	if (history.length === 0) {
		return (
			<p className="text-muted-foreground py-6 text-sm">
				No alert-worthy drops recorded yet. The baseline crawl is still learning
				this catalog.
			</p>
		);
	}
	return (
		<div className="divide-y">
			{history.map((card) => (
				<FeedCard card={card} key={card.eventId} showRoaster={false} />
			))}
		</div>
	);
};

const RoasterComponent = () => {
	const { slug } = useParams({ from: "/roasters/$slug" });
	const roaster = useQuery(api.roasters.getBySlug, { slug });
	const { isAuthenticated } = useConvexAuth();

	if (roaster === undefined) {
		return <Loader />;
	}
	if (roaster === null) {
		return (
			<div className="container mx-auto max-w-3xl px-4 py-8">
				<p className="text-muted-foreground py-8 text-sm">
					No roaster at this address.{" "}
					<Link className="underline" to="/roasters">
						Browse the roasters
					</Link>
					.
				</p>
			</div>
		);
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
				<div>
					<h1 className="text-2xl font-semibold">{roaster.name}</h1>
					<p className="text-muted-foreground text-sm">
						{roaster.city}, {roaster.state} · {roaster.followerCount}{" "}
						{roaster.followerCount === 1 ? "watcher" : "watchers"}
					</p>
					<div className="mt-1.5">
						<StatusChip status={roaster.status} />
					</div>
				</div>
				{isAuthenticated && <WatchButton roasterId={roaster.id} />}
			</header>
			<section className="mb-8">
				<h2 className="mb-2 font-semibold">Drop history</h2>
				<DropHistory roasterId={roaster.id} />
			</section>
			<Lots roasterId={roaster.id} />
		</div>
	);
};

export const Route = createFileRoute("/roasters/$slug")({
	component: RoasterComponent,
});
