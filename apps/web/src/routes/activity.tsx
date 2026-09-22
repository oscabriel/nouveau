import { createFileRoute } from "@tanstack/react-router";

import { ActivityFeed } from "@/components/activity-feed";
import { Page } from "@/components/page";

/**
 * The community feed (ADR-0016): the one place other people's logs appear
 * together. The same inner-page shell as /drops; the rows are the page.
 */
const ActivityComponent = () => (
	<Page>
		<ActivityFeed />
	</Page>
);

export const Route = createFileRoute("/activity")({
	component: ActivityComponent,
	head: () => ({ meta: [{ title: "Activity | Nouveau" }] }),
});
