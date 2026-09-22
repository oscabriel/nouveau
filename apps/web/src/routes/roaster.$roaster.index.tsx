import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { CheckNowButton } from "@/components/check-now-button";
import { DropTable } from "@/components/drop-index";
import { Loader } from "@/components/loader";
import { Lots } from "@/components/lots";
import {
	EmptyLine,
	MissingPage,
	Page,
	PageLoader,
	PageTitle,
	SectionHeading,
} from "@/components/page";
import { StatusChip } from "@/components/status-chip";
import { WatchButton } from "@/components/watch-button";
import { plural } from "@/lib/format";
import { ledeClass } from "@/lib/ui";
import { useDocumentTitle } from "@/lib/use-document-title";

const route = getRouteApi("/roaster/$roaster/");

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
			<EmptyLine>
				No alert-worthy drops recorded yet. The baseline crawl is still learning
				this catalog.
			</EmptyLine>
		);
	}
	return <DropTable className="mt-8" rows={history} showRoaster={false} />;
};

const DropHistory = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const history = useQuery(api.feed.roasterFeed, { roasterId });
	return (
		<section aria-labelledby="drops-heading">
			<SectionHeading count={history?.length} id="drops-heading">
				Drop history
			</SectionHeading>
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
	const { roaster: slug } = route.useParams();
	const roaster = useQuery(api.roasters.getBySlug, { slug });
	const { isAuthenticated } = useConvexAuth();
	useDocumentTitle(roaster?.name);

	if (roaster === undefined) {
		return <PageLoader />;
	}
	if (roaster === null) {
		return (
			<MissingPage linkLabel="Browse the roasters" to="/roasters">
				No roaster at this address.
			</MissingPage>
		);
	}

	return (
		<Page>
			<PageTitle title={roaster.name}>
				{isAuthenticated && <WatchButton roasterId={roaster.id} />}
			</PageTitle>
			<p className={ledeClass}>
				{roaster.city}, {roaster.state}
				<span aria-hidden className="mx-2">
					·
				</span>
				<span className="tnum">{plural(roaster.followerCount, "watcher")}</span>
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
		</Page>
	);
};

export const Route = createFileRoute("/roaster/$roaster/")({
	component: RoasterComponent,
	head: () => ({ meta: [{ title: "Roaster | Nouveau" }] }),
});
