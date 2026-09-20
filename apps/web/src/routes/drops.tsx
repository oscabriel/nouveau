import { createFileRoute, Link } from "@tanstack/react-router";

import { GlobalFeed } from "@/components/global-feed";

const FeedComponent = () => (
	<div className="container mx-auto max-w-3xl px-4 py-8">
		<header className="mb-6 flex items-baseline justify-between gap-4">
			<h1 className="text-2xl font-semibold">Live feed</h1>
			<Link className="text-sm hover:underline" to="/roasters">
				All roasters
			</Link>
		</header>
		<p className="text-muted-foreground mb-4 text-sm">
			Every alert-worthy drop across every roaster Nouveau watches, as it
			happens.
		</p>
		<GlobalFeed />
	</div>
);

export const Route = createFileRoute("/feed")({
	component: FeedComponent,
});
