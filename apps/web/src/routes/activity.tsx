import { createFileRoute } from "@tanstack/react-router";

import { ActivityFeed } from "@/components/activity-feed";

/**
 * The community feed (ADR-0016): the one place other people's logs appear
 * together. The same inner-page shell as /drops; the rows are the page.
 */
const ActivityComponent = () => (
	<main>
		<div className="px-5 pt-10 md:px-10 md:pt-14">
			<ActivityFeed />
		</div>
	</main>
);

export const Route = createFileRoute("/activity")({
	component: ActivityComponent,
});
