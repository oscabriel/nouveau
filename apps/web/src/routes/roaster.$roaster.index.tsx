import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { CheckNowButton } from "@/components/check-now-button";
import { DropTable } from "@/components/drop-index";
import Loader from "@/components/loader";
import { Lots } from "@/components/lots";
import { PageTitle } from "@/components/page-title";
import { StatusChip } from "@/components/status-chip";
import { WatchButton } from "@/components/watch-button";

const DropHistoryBody = ({
	history,
}: {
	history: FunctionReturnType<typeof api.feed.roasterFeed> | undefined;
}) => {
	if (history === undefined) {
		return (
			<div className="py-16">
				<Loader />
			</div>
		);
	}
	if (history.length === 0) {
		return (
			<p className="text-muted-foreground py-16 text-center text-[15px]">
				No alert-worthy drops recorded yet. The baseline crawl is still learning
				this catalog.
			</p>
		);
	}
	return <DropTable className="mt-8" rows={history} showRoaster={false} />;
};

const DropHistory = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const history = useQuery(api.feed.roasterFeed, { roasterId });
	return (
		<section aria-labelledby="drops-heading">
			<h2 className="text-xl md:text-2xl" id="drops-heading">
				Drop history
				{history !== undefined && (
					<span className="text-muted-foreground tnum ml-2 text-xs">
						({history.length})
					</span>
				)}
			</h2>
			<DropHistoryBody history={history} />
		</section>
	);
};

/**
 * One roaster: name at title scale, city and watcher count under it, the
 * honest status line with Check now beside it, Watch on the right baseline.
 * Then every alert-worthy drop as a table, then the whole lot catalog.
 */
const RoasterComponent = () => {
	const { roaster: slug } = useParams({ from: "/roaster/$roaster/" });
	const roaster = useQuery(api.roasters.getBySlug, { slug });
	const { isAuthenticated } = useConvexAuth();

	if (roaster === undefined) {
		return (
			<main className="py-24">
				<Loader />
			</main>
		);
	}
	if (roaster === null) {
		return (
			<main>
				<p className="text-muted-foreground px-5 py-24 text-center text-[15px] md:px-10">
					No roaster at this address.{" "}
					<Link className="text-foreground underline" to="/roasters">
						Browse the roasters
					</Link>
					.
				</p>
			</main>
		);
	}

	const watchers =
		roaster.followerCount === 1
			? "1 watcher"
			: `${roaster.followerCount} watchers`;

	return (
		<main>
			<div className="px-5 pt-10 md:px-10 md:pt-14">
				<PageTitle title={roaster.name}>
					{isAuthenticated && <WatchButton roasterId={roaster.id} />}
				</PageTitle>
				<p className="text-muted-foreground mt-4 text-sm md:text-[15px]">
					{roaster.city}, {roaster.state}
					<span aria-hidden className="mx-2">
						·
					</span>
					<span className="tnum">{watchers}</span>
				</p>
				<div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
					<StatusChip status={roaster.status} />
					{isAuthenticated && (
						<CheckNowButton roasterId={roaster.id} status={roaster.status} />
					)}
				</div>

				<div className="mt-16 md:mt-24">
					<DropHistory roasterId={roaster.id} />
				</div>
				<div className="mt-16 md:mt-24">
					<Lots roasterId={roaster.id} slug={roaster.slug} />
				</div>
			</div>
		</main>
	);
};

export const Route = createFileRoute("/roaster/$roaster/")({
	component: RoasterComponent,
});
