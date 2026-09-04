import { createFileRoute, Link } from "@tanstack/react-router";

import { ActivityFeed } from "@/components/activity-feed";

const ActivityComponent = () => (
	<div className="container mx-auto max-w-3xl px-4 py-8">
		<header className="mb-6 flex items-baseline justify-between gap-4">
			<h1 className="text-2xl font-semibold">Recent logs</h1>
			<Link className="text-sm hover:underline" to="/feed">
				Drop feed
			</Link>
		</header>
		<p className="text-muted-foreground mb-4 text-sm">
			What people are tasting right now — every lot logged across Nouveau,
			newest first.
		</p>
		<ActivityFeed />
	</div>
);

export const Route = createFileRoute("/activity")({
	component: ActivityComponent,
});
