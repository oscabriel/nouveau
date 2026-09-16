import { api } from "@nouveau/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import { FeedCard } from "@/components/feed-card";
import Loader from "@/components/loader";

/**
 * Global live feed (build spec §8.1): recent drops across every roaster.
 * `limit` caps the rows shown (the landing page's teaser); the feed page
 * renders everything.
 */
export const GlobalFeed = ({ limit }: { limit?: number }) => {
	const feed = useQuery(api.feed.globalFeed, {});
	if (feed === undefined) {
		return <Loader />;
	}
	const shown = limit === undefined ? feed : feed.slice(0, limit);
	if (shown.length === 0) {
		return (
			<p className="text-muted-foreground py-8 text-sm">
				No drops yet. The crawlers are out there checking.
			</p>
		);
	}
	return (
		<div className="divide-y">
			{shown.map((card) => (
				<FeedCard card={card} key={card.eventId} />
			))}
		</div>
	);
};
