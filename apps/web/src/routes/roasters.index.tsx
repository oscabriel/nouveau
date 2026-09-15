import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Input } from "@nouveau/ui/components/input";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useState } from "react";

import Loader from "@/components/loader";
import { StatusChip } from "@/components/status-chip";
import { WatchButton } from "@/components/watch-button";
import { matchesRoaster } from "@/lib/roaster-search";

const RoastersComponent = () => {
	const roasters = useQuery(api.roasters.listActive, {});
	const { isAuthenticated } = useConvexAuth();
	const [search, setSearch] = useState("");

	if (roasters === undefined) {
		return <Loader />;
	}
	// 20 curated roasters today; a client-side filter over the loaded list
	// beats a search index until user submissions grow the directory.
	const visible = roasters.filter((roaster) => matchesRoaster(roaster, search));

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
			<Input
				aria-label="Search roasters by name, city or state"
				className="mb-4 h-9"
				onChange={(event) => {
					setSearch(event.target.value);
				}}
				placeholder="Search roasters"
				type="search"
				value={search}
			/>
			{visible.length === 0 && (
				<p className="text-muted-foreground py-6 text-sm">
					No roaster matches that.
				</p>
			)}
			<ul className="divide-y">
				{visible.map((roaster) => (
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
