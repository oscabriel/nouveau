import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { bodyCell, headCell } from "@/components/drop-index";
import Loader from "@/components/loader";
import { PageTitle } from "@/components/page-title";
import { SearchField } from "@/components/search-field";
import { SiteFooter } from "@/components/site-footer";
import { StatusChip } from "@/components/status-chip";
import { WatchButton } from "@/components/watch-button";
import { matchesRoaster } from "@/lib/roaster-search";

type Roaster = FunctionReturnType<typeof api.roasters.listActive>[number];

const capsLink = "label-caps inline-flex min-h-11 items-center hover:underline";

const RoasterRow = ({
	canWatch,
	index,
	roaster,
}: {
	canWatch: boolean;
	index: number;
	roaster: Roaster;
}) => (
	<tr className="group hover:bg-muted focus-within:bg-muted border-b transition-colors">
		<td
			className={`${bodyCell} text-muted-foreground tnum w-10 pr-2 text-xs md:w-28 md:pr-3`}
		>
			{index + 1}
		</td>
		<td className={`${bodyCell} pr-4`}>
			<Link
				className="hover:underline"
				params={{ slug: roaster.slug }}
				to="/roasters/$slug"
			>
				{roaster.name}
			</Link>
		</td>
		<td
			className={`${bodyCell} text-muted-foreground hidden pr-4 whitespace-nowrap sm:table-cell`}
		>
			{roaster.city}, {roaster.state}
		</td>
		<td className={`${bodyCell} pr-4 whitespace-nowrap`}>
			<StatusChip compact status={roaster.status} />
		</td>
		<td
			className={`${bodyCell} text-muted-foreground tnum hidden pr-4 text-right md:table-cell`}
		>
			{roaster.followerCount}
		</td>
		{canWatch && (
			<td className={`${bodyCell} w-24 py-0 text-right align-middle`}>
				<WatchButton roasterId={roaster.id} />
			</td>
		)}
	</tr>
);

const Directory = ({
	canWatch,
	visible,
}: {
	canWatch: boolean;
	visible: Roaster[] | undefined;
}) => {
	if (visible === undefined) {
		return (
			<div className="py-24">
				<Loader />
			</div>
		);
	}
	if (visible.length === 0) {
		return (
			<p className="text-muted-foreground py-16 text-center text-[15px]">
				No roaster matches that.{" "}
				<Link className="text-foreground underline" to="/roasters/submit">
					Add one
				</Link>
				?
			</p>
		);
	}
	return (
		<table className="mt-12 w-full border-collapse md:mt-16">
			<thead>
				<tr className="border-b">
					<th className={`${headCell} w-10 md:w-28`} scope="col">
						N°
					</th>
					<th className={headCell} scope="col">
						Roaster
					</th>
					<th className={`${headCell} hidden sm:table-cell`} scope="col">
						City
					</th>
					<th className={headCell} scope="col">
						Status
					</th>
					<th
						className={`${headCell} hidden text-right md:table-cell`}
						scope="col"
					>
						Watchers
					</th>
					{canWatch && (
						<th className={`${headCell} text-right`} scope="col">
							<span className="sr-only">Watch</span>
						</th>
					)}
				</tr>
			</thead>
			<tbody>
				{visible.map((roaster, index) => (
					<RoasterRow
						canWatch={canWatch}
						index={index}
						key={roaster.id}
						roaster={roaster}
					/>
				))}
			</tbody>
		</table>
	);
};

/**
 * The directory: every active roaster in one hairline table, N° to Watch.
 * Search filters the loaded list client-side; 20 curated roasters today,
 * and a search index can wait until submissions grow it.
 */
const RoastersComponent = () => {
	const roasters = useQuery(api.roasters.listActive, {});
	const { isAuthenticated } = useConvexAuth();
	const [search, setSearch] = useState("");

	const visible =
		roasters === undefined
			? undefined
			: roasters.filter((roaster) => matchesRoaster(roaster, search));

	return (
		<main>
			<div className="px-5 pt-10 md:px-10 md:pt-14">
				<PageTitle count={roasters?.length} title="Roasters">
					{isAuthenticated && (
						<Link className={capsLink} to="/watches">
							Your watches
						</Link>
					)}
					<Link className={capsLink} to="/roasters/submit">
						Add a roaster
					</Link>
				</PageTitle>
				<div className="mt-10 md:mt-12">
					<SearchField
						label="Search by name, city or state"
						onChange={setSearch}
						value={search}
					/>
				</div>
				<Directory canWatch={isAuthenticated} visible={visible} />
			</div>
			<SiteFooter />
		</main>
	);
};

export const Route = createFileRoute("/roasters/")({
	component: RoastersComponent,
});
