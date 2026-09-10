import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import { Input } from "@nouveau/ui/components/input";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import Loader from "@/components/loader";
import { LogForm } from "@/components/log-form";

type LotRow = FunctionReturnType<typeof api.roasters.searchLots>[number];

const PAGE_SIZE = 20;

const LotRowItem = ({
	canLog,
	isOpen,
	lot,
	onClose,
	onOpen,
}: {
	canLog: boolean;
	isOpen: boolean;
	lot: LotRow;
	onClose: () => void;
	onOpen: () => void;
}) => (
	<li className="py-2">
		<div className="flex items-center justify-between gap-3">
			<p
				className={`min-w-0 truncate text-sm ${lot.status === "archived" ? "text-muted-foreground" : undefined}`}
			>
				{lot.name}
				{lot.status === "archived" && (
					<span className="text-muted-foreground/70 ml-2 text-xs">
						archived
					</span>
				)}
			</p>
			{canLog && !isOpen && (
				<Button onClick={onOpen} size="sm" variant="outline">
					Log
				</Button>
			)}
		</div>
		{lot.roasterNotes !== null && !isOpen && (
			<p className="text-muted-foreground mt-0.5 truncate text-xs italic">
				{lot.roasterNotes}
			</p>
		)}
		{canLog && isOpen && (
			<LogForm
				lotId={lot.id}
				onDone={onClose}
				roasterNotes={lot.roasterNotes}
			/>
		)}
	</li>
);

/**
 * The roaster's lot catalog (screen inventory §11), the place a log starts:
 * find the lot you tried, hit Log, rate it, keep a note. Browsing pages the
 * full catalog; typing in the filter switches to a name search over the whole
 * catalog (Sey runs ~887 lots, so paging alone would never find anything).
 */
export const Lots = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const { isAuthenticated } = useConvexAuth();
	const [openLotId, setOpenLotId] = useState<Id<"products"> | null>(null);
	const [search, setSearch] = useState("");
	const term = search.trim();

	const pages = usePaginatedQuery(
		api.roasters.listLots,
		{ roasterId },
		{ initialNumItems: PAGE_SIZE }
	);
	const hits = useQuery(
		api.roasters.searchLots,
		term === "" ? "skip" : { roasterId, term }
	);

	const searching = term !== "";
	const visible = searching ? hits : pages.results;

	const renderRows = (lots: LotRow[]) =>
		lots.map((lot) => (
			<LotRowItem
				canLog={isAuthenticated}
				isOpen={openLotId === lot.id}
				key={lot.id}
				lot={lot}
				onClose={() => {
					setOpenLotId(null);
				}}
				onOpen={() => {
					setOpenLotId(lot.id);
				}}
			/>
		));

	return (
		<section>
			<div className="mb-2 flex items-baseline justify-between gap-4">
				<h2 className="font-semibold">Lots</h2>
				<Input
					aria-label="Search lots"
					className="h-8 w-48 text-sm"
					onChange={(event) => {
						setSearch(event.target.value);
					}}
					placeholder="Search lots"
					value={search}
				/>
			</div>
			{visible === undefined || pages.status === "LoadingFirstPage" ? (
				<Loader />
			) : (
				<>
					<ul className="divide-y">{renderRows(visible)}</ul>
					{visible.length === 0 && (
						<p className="text-muted-foreground py-4 text-sm">
							{searching ? `No lots match "${term}".` : "No lots yet."}
						</p>
					)}
					{!searching && pages.status === "CanLoadMore" && (
						<Button
							className="mt-3"
							onClick={() => {
								pages.loadMore(PAGE_SIZE);
							}}
							size="sm"
							variant="ghost"
						>
							Load more
						</Button>
					)}
				</>
			)}
		</section>
	);
};
