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
import { displayPriceCents, formatGrams, formatPrice } from "@/lib/format";

type LotRow = FunctionReturnType<typeof api.roasters.listLots>["page"][number];

const PAGE_SIZE = 20;

/** The grid's filters, as the backend queries take them. */
interface LotFilters {
	availableOnly?: boolean;
	grams?: number;
	maxPriceCents?: number;
	origin?: string;
}

const fromPrice = (minPriceCents: number | null): string => {
	const cents = displayPriceCents(minPriceCents);
	return cents === null ? "" : `from ${formatPrice(cents)}`;
};

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
	const soldOut = !archived && !lot.available;
	return (
		<>
			<tr
				className={`group hover:bg-muted focus-within:bg-muted transition-colors ${isOpen ? "bg-muted" : "border-b"} ${archived || !lot.available ? "opacity-50" : ""}`}
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
					{soldOut && (
						<span className="label-caps ml-3 align-middle opacity-70">
							Sold out
						</span>
					)}
				</td>
				<td
					className={`${bodyCell} text-muted-foreground hidden max-w-0 truncate pr-4 md:table-cell md:w-[40%]`}
				>
					{lot.roasterNotes ?? ""}
				</td>
				<td
					className={`${bodyCell} text-muted-foreground hidden pr-4 lg:table-cell`}
				>
					{lot.origin ?? ""}
				</td>
				<td
					className={`${bodyCell} text-muted-foreground tnum hidden pr-4 whitespace-nowrap sm:table-cell`}
				>
					{fromPrice(lot.minPriceCents)}
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
					<td className="pr-4 pb-5" colSpan={4}>
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
				{searching
					? `No lots match "${term}".`
					: "No lots match these filters."}
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
						<th className={`${headCell} hidden lg:table-cell`} scope="col">
							Origin
						</th>
						<th
							className={`${headCell} hidden text-right sm:table-cell`}
							scope="col"
						>
							Price
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

/** The filter row: one hairline control per axis, no boxes. */
const LotFilterRow = ({
	origin,
	onOrigin,
	onPrice,
	onSize,
	onStock,
	price,
	size,
	stock,
	weightOptions,
}: {
	origin: string;
	onOrigin: (next: string) => void;
	onPrice: (next: string) => void;
	onSize: (next: number | null) => void;
	onStock: (next: boolean) => void;
	price: string;
	size: number | null;
	stock: boolean;
	weightOptions: number[];
}) => (
	<div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-3">
		<button
			aria-pressed={stock}
			className={`label-caps inline-flex min-h-11 items-center ${stock ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
			onClick={() => {
				onStock(!stock);
			}}
			type="button"
		>
			In stock{stock ? " ✓" : ""}
		</button>
		<select
			aria-label="Bag size"
			className="text-muted-foreground h-11 max-w-40 border-b bg-transparent text-sm outline-none"
			onChange={(event) => {
				onSize(event.target.value === "" ? null : Number(event.target.value));
			}}
			value={size ?? ""}
		>
			<option value="">Any size</option>
			{weightOptions.map((option) => (
				<option key={option} value={option}>
					{formatGrams(option)}
				</option>
			))}
		</select>
		<input
			aria-label="Price at most, dollars"
			autoComplete="off"
			className="placeholder:text-muted-foreground focus-visible:border-foreground h-11 w-28 border-b bg-transparent text-sm outline-none"
			min="0"
			onChange={(event) => {
				onPrice(event.target.value);
			}}
			placeholder="≤ $ price"
			step="any"
			type="number"
			value={price}
		/>
		<input
			aria-label="Origin contains"
			autoComplete="off"
			className="placeholder:text-muted-foreground focus-visible:border-foreground h-11 w-40 border-b bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
			onChange={(event) => {
				onOrigin(event.target.value);
			}}
			placeholder="Origin"
			type="search"
			value={origin}
		/>
	</div>
);

/**
 * The roaster's lot catalog (screen inventory §11), the place a log starts:
 * find the lot you tried, hit Log, rate it, keep a note. Browsing pages the
 * full catalog; typing in the filter switches to a name search over the
 * whole catalog (Sey runs ~887 lots, so paging alone would never find
 * anything). Same hairline table as the index; the roaster's notes fill the
 * wide column. The stock boundary is explicit: unavailable lots dim and say
 * so, and filters (size, price, origin, in stock) run against the whole
 * catalog.
 */
export const Lots = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const { isAuthenticated } = useConvexAuth();
	const [openLotId, setOpenLotId] = useState<Id<"products"> | null>(null);
	const [search, setSearch] = useState("");
	const [inStockOnly, setInStockOnly] = useState(false);
	const [maxPriceDollars, setMaxPriceDollars] = useState("");
	const [weight, setWeight] = useState<number | null>(null);
	const [originTerm, setOriginTerm] = useState("");
	const term = search.trim();

	const priceCents = Number(maxPriceDollars);
	const filters: LotFilters = {};
	if (inStockOnly) {
		filters.availableOnly = true;
	}
	if (!Number.isNaN(priceCents) && priceCents > 0) {
		filters.maxPriceCents = Math.round(priceCents * 100);
	}
	if (weight !== null) {
		filters.grams = weight;
	}
	const origin = originTerm.trim();
	if (origin !== "") {
		filters.origin = origin;
	}
	const filtered = Object.keys(filters).length > 0;
	const searching = term !== "";

	const pages = usePaginatedQuery(
		api.roasters.listLots,
		{ roasterId },
		{ initialNumItems: PAGE_SIZE }
	);
	const filteredRows = useQuery(
		api.roasters.listLotsFiltered,
		filtered && !searching ? { roasterId, ...filters } : "skip"
	);
	const hits = useQuery(
		api.roasters.searchLots,
		searching ? { roasterId, term, ...filters } : "skip"
	);

	const browsable = filtered ? filteredRows : pages.results;
	const visible = searching ? hits : browsable;
	const loading =
		visible === undefined ||
		(!searching && !filtered && pages.status === "LoadingFirstPage");

	// The size filter's choices: the bag sizes the catalog carries, from the
	// loaded browse pages (they cover what a visitor is likely to filter on).
	const weightOptions = [
		...new Set((pages.results ?? []).flatMap((lot) => lot.grams)),
	].toSorted((a, b) => a - b);

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
			<LotFilterRow
				origin={originTerm}
				onOrigin={setOriginTerm}
				onPrice={setMaxPriceDollars}
				onSize={setWeight}
				onStock={setInStockOnly}
				price={maxPriceDollars}
				size={weight}
				stock={inStockOnly}
				weightOptions={weightOptions}
			/>
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
