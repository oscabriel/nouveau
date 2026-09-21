import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import Loader from "@/components/loader";
import { PageTitle } from "@/components/page-title";
import { SearchField } from "@/components/search-field";
import { ArrowCell } from "@/components/table";
import { WatchButton } from "@/components/watch-button";
import { matchesRoaster } from "@/lib/roaster-search";
import { bodyCell, headCell, navLinkClass } from "@/lib/ui";

type Roaster = FunctionReturnType<typeof api.roasters.listActive>[number];

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
				params={{ roaster: roaster.slug }}
				to="/roaster/$roaster"
			>
				{roaster.name}
			</Link>
		</td>
		<td
			className={`${bodyCell} text-muted-foreground hidden pr-4 whitespace-nowrap sm:table-cell`}
		>
			{roaster.city}, {roaster.state}
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
		<ArrowCell
			label={`Open ${roaster.name}`}
			to="/roaster/$roaster"
			params={{ roaster: roaster.slug }}
		/>
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
					<th
						className={`${headCell} hidden text-right md:table-cell`}
						scope="col"
					>
						Watchers
					</th>
					{canWatch && (
						<th className={`${headCell} text-right`} scope="col">
							Status
						</th>
					)}
					<th className={headCell} scope="col">
						<span className="sr-only">Open the roaster</span>
					</th>
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
 * The directory: every active roaster in one hairline table. Your status is
 * the Status column: the WATCH / WATCHING toggle signed in, no column at all
 * signed out (ADR-0015). Crawl health lives on the roaster page's status
 * line, not here. Search filters the loaded list client-side.
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
						<Link className={navLinkClass} to="/settings/alerts">
							Your watches
						</Link>
					)}
					<Link className={navLinkClass} to="/roasters/submit">
						Add a roaster
					</Link>
				</PageTitle>
				<p className="text-muted-foreground mt-4 max-w-prose text-sm md:text-[15px]">
					The American specialty roasters Nouveau watches around the clock, with
					their live catalogs.
				</p>
				<div className="mt-10 md:mt-12">
					<SearchField
						label="Search by name, city or state"
						onChange={setSearch}
						value={search}
					/>
				</div>
				<Directory canWatch={isAuthenticated} visible={visible} />
			</div>
		</main>
	);
};

export const Route = createFileRoute("/roasters/")({
	component: RoastersComponent,
});
