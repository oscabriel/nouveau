import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import Loader from "@/components/loader";
import { StatusChip } from "@/components/status-chip";
import { WatchButton } from "@/components/watch-button";

const RoastersComponent = () => {
	const roasters = useQuery(api.roasters.listActive, {});
	const { isAuthenticated } = useConvexAuth();

	if (roasters === undefined) {
		return <Loader />;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex items-baseline justify-between gap-4">
				<h1 className="text-2xl font-semibold">Roasters</h1>
				{isAuthenticated && (
					<Link className="text-sm hover:underline" to="/watches">
						Your watches
					</Link>
				)}
			</header>
			<ul className="divide-y">
				{roasters.map((roaster) => (
					<li
						className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-4"
						key={roaster.id}
					>
						<div>
							<Link
								className="font-medium hover:underline"
								params={{ slug: roaster.slug }}
								to="/roasters/$slug"
							>
								{roaster.name}
							</Link>
							<div className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 text-sm">
								<span>
									{roaster.city}, {roaster.state}
								</span>
								<StatusChip compact status={roaster.status} />
							</div>
						</div>
						{isAuthenticated && <WatchButton roasterId={roaster.id} />}
					</li>
				))}
			</ul>
		</div>
	);
};

export const Route = createFileRoute("/roasters/")({
	component: RoastersComponent,
});
