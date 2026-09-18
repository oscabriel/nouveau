import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { bodyCell, headCell } from "@/components/drop-index";
import Loader from "@/components/loader";
import { LogForm } from "@/components/log-form";
import { SearchField } from "@/components/search-field";

type LotRow = FunctionReturnType<typeof api.roasters.searchLots>[number];

const PAGE_SIZE = 20;

const LotTableRow = ({
	canLog,
	index,
	isOpen,
	lot,
	onClose,
	onOpen,
}: {
	canLog: boolean;
	index: number;
	isOpen: boolean;
	lot: LotRow;
	onClose: () => void;
	onOpen: () => void;
}) => {
	const archived = lot.status === "archived";
	return (
		<>
			<tr
				className={`group hover:bg-muted focus-within:bg-muted transition-colors ${isOpen ? "bg-muted" : "border-b"}`}
			>
				<td
					className={`${bodyCell} text-muted-foreground tnum w-10 pr-2 text-xs md:w-28 md:pr-3`}
				>
					{index + 1}
				</td>
				<td
					className={`${bodyCell} pr-4 ${archived ? "text-muted-foreground" : ""}`}
				>
					<Link
						className="hover:underline"
						params={{ lotId: lot.id }}
						to="/lots/$lotId"
					>
						{lot.name}
					</Link>
					{archived && (
						<span className="label-caps ml-3 align-middle opacity-70">
							Archived
						</span>
					)}
				</td>
				<td
					className={`${bodyCell} text-muted-foreground hidden max-w-0 truncate pr-4 md:table-cell md:w-[40%]`}
				>
					{lot.roasterNotes ?? ""}
				</td>
				{canLog && (
					<td className={`${bodyCell} w-12 py-0 text-right align-middle`}>
						{isOpen ? (
							<button
								className="label-caps inline-flex min-h-11 items-center hover:underline"
								onClick={onClose}
								type="button"
							>
								Close
							</button>
						) : (
							<button
								className="label-caps inline-flex min-h-11 items-center hover:underline"
								onClick={onOpen}
								type="button"
							>
								Log
							</button>
						)}
					</td>
				)}
			</tr>
			{canLog && isOpen && (
				<tr className="bg-muted border-b">
					{/* Spans Lot, Notes and Log; the spacer sits under N° from md. */}
					<td aria-hidden className="hidden md:table-cell" />
					<td className="pr-4 pb-5" colSpan={3}>
						<LogForm
							lotId={lot.id}
							onDone={onClose}
							roasterNotes={lot.roasterNotes}
						/>
					</td>
				</tr>
			)}
		</>
	);
};

const LotsBody = ({
	isAuthenticated,
	loading,
	onClose,
	onOpen,
	openLotId,
	pages,
	searching,
	term,
	visible,
}: {
	isAuthenticated: boolean;
	loading: boolean;
	onClose: () => void;
	onOpen: (lotId: Id<"products">) => void;
	openLotId: Id<"products"> | null;
	pages: { loadMore: (count: number) => void; status: string };
	searching: boolean;
	term: string;
	visible: LotRow[] | undefined;
}) => {
	if (loading || visible === undefined) {
		return (
			<div className="py-16">
				<Loader />
			</div>
		);
	}
	if (visible.length === 0) {
		return (
			<p className="text-muted-foreground py-16 text-center text-[15px]">
				{searching ? `No lots match "${term}".` : "No lots yet."}
			</p>
		);
	}
	return (
		<>
			<table className="mt-8 w-full border-collapse">
				<thead>
					<tr className="border-b">
						<th className={`${headCell} w-10 md:w-28`} scope="col">
							N°
						</th>
						<th className={headCell} scope="col">
							Lot
						</th>
						<th className={`${headCell} hidden md:table-cell`} scope="col">
							Roaster notes
						</th>
						{isAuthenticated && (
							<th className={headCell} scope="col">
								<span className="sr-only">Log</span>
							</th>
						)}
					</tr>
				</thead>
				<tbody>
					{visible.map((lot, index) => (
						<LotTableRow
							canLog={isAuthenticated}
							index={index}
							isOpen={openLotId === lot.id}
							key={lot.id}
							lot={lot}
							onClose={onClose}
							onOpen={() => {
								onOpen(lot.id);
							}}
						/>
					))}
				</tbody>
			</table>
			{!searching && pages.status === "CanLoadMore" && (
				<div className="flex justify-center pt-8">
					<button
						className="label-caps inline-flex min-h-11 items-center hover:underline"
						onClick={() => {
							pages.loadMore(PAGE_SIZE);
						}}
						type="button"
					>
						Load more
					</button>
				</div>
			)}
			{!searching && pages.status === "LoadingMore" && (
				<div className="pt-8">
					<Loader />
				</div>
			)}
		</>
	);
};

/**
 * The roaster's lot catalog (screen inventory §11), the place a log starts:
 * find the lot you tried, hit Log, rate it, keep a note. Browsing pages the
 * full catalog; typing in the filter switches to a name search over the whole
 * catalog (Sey runs ~887 lots, so paging alone would never find anything).
 * Same hairline table as the index; the roaster's notes fill the wide column.
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
	const loading = visible === undefined || pages.status === "LoadingFirstPage";

	return (
		<section aria-labelledby="lots-heading">
			<div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4">
				<h2 className="text-xl md:text-2xl" id="lots-heading">
					Lots
				</h2>
				<div className="w-full sm:w-72">
					<SearchField
						label="Search lots"
						onChange={setSearch}
						value={search}
					/>
				</div>
			</div>
			<LotsBody
				isAuthenticated={isAuthenticated}
				loading={loading}
				onClose={() => {
					setOpenLotId(null);
				}}
				onOpen={setOpenLotId}
				openLotId={openLotId}
				pages={pages}
				searching={searching}
				term={term}
				visible={visible}
			/>
		</section>
	);
};
