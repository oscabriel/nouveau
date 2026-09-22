import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Link } from "@tanstack/react-router";
import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { useRef, useState } from "react";

import { DotToggle } from "@/components/dot-toggle";
import Loader from "@/components/loader";
import { EmptyLine, SectionHeading } from "@/components/page";
import { SearchField } from "@/components/search-field";
import { ArrowCell, TableHoverImage } from "@/components/table";
import { TastingPill } from "@/components/tasting-pill";
import { displayPriceCents, formatPrice } from "@/lib/format";
import {
	bodyCell,
	hairlineInputClass,
	hairlineSelectClass,
	headCell,
	headCellRight,
	navLinkClass,
} from "@/lib/ui";
import { useFormatWeight } from "@/lib/weight";

type LotRow = FunctionReturnType<typeof api.roasters.listLots>["page"][number];

const PAGE_SIZE = 20;

/** The grid's filters, as the backend queries take them. */
type LotFilters = Omit<
	FunctionArgs<typeof api.roasters.listLotsFiltered>,
	"roasterId"
>;

const fromPrice = (minPriceCents: number | null): string => {
	const cents = displayPriceCents(minPriceCents);
	return cents === null ? "" : `from ${formatPrice(cents)}`;
};

const LotTableRow = ({
	index,
	lot,
	slug,
}: {
	index: number;
	lot: LotRow;
	slug: string;
}) => {
	const archived = lot.status === "archived";
	// Unknown stock (available null, no rollup yet) renders like in stock:
	// neither dimmed nor labelled. Only a known sold-out lot says so.
	const soldOut = !archived && lot.available === false;
	return (
		<tr
			className={`group hover:bg-muted focus-within:bg-muted border-b transition-colors ${archived || soldOut ? "opacity-50" : ""}`}
			data-image-url={lot.imageUrl ?? undefined}
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
					params={{ lot: lot.handle, roaster: slug }}
					to="/roaster/$roaster/$lot"
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
				className={`${bodyCell} hidden max-w-0 pr-4 md:table-cell md:w-[40%]`}
			>
				{/* Pills, one row, fading out at the cell's edge: the row stays one line tall. */}
				<div className="flex gap-1.5 overflow-hidden [mask-image:linear-gradient(to_right,black_88%,transparent)]">
					{lot.roasterTags.map(({ family, note }) => (
						<TastingPill family={family} key={note} link>
							{note}
						</TastingPill>
					))}
				</div>
			</td>
			<td
				className={`${bodyCell} text-muted-foreground hidden pr-4 lg:table-cell`}
			>
				{lot.origin ?? ""}
			</td>
			<td
				className={`${bodyCell} text-muted-foreground tnum hidden pr-4 text-right whitespace-nowrap sm:table-cell`}
			>
				{fromPrice(lot.minPriceCents)}
			</td>
			<ArrowCell
				label={`Open ${lot.name}`}
				params={{ lot: lot.handle, roaster: slug }}
				to="/roaster/$roaster/$lot"
			/>
		</tr>
	);
};

const LotsBody = ({
	loading,
	pages,
	searching,
	slug,
	term,
	visible,
}: {
	loading: boolean;
	pages: { loadMore: (count: number) => void; status: string };
	searching: boolean;
	slug: string;
	term: string;
	visible: LotRow[] | undefined;
}) => {
	const tableRef = useRef<HTMLTableElement>(null);
	if (loading || visible === undefined) {
		return (
			<div className="py-16">
				<Loader />
			</div>
		);
	}
	if (visible.length === 0) {
		return (
			<EmptyLine>
				{searching
					? `No lots match "${term}".`
					: "No lots match these filters."}
			</EmptyLine>
		);
	}
	return (
		<>
			<table className="mt-8 w-full border-collapse" ref={tableRef}>
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
						<th className={`${headCellRight} hidden sm:table-cell`} scope="col">
							Price
						</th>
						<th className={headCell} scope="col">
							<span className="sr-only">Open the lot</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{visible.map((lot, index) => (
						<LotTableRow index={index} key={lot.id} lot={lot} slug={slug} />
					))}
				</tbody>
			</table>
			<TableHoverImage tableRef={tableRef} />
			{!searching && pages.status === "CanLoadMore" && (
				<div className="flex justify-center pt-8">
					<button
						className={navLinkClass}
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
}) => {
	const formatWeight = useFormatWeight();
	return (
		<div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-3">
			<DotToggle
				onClick={() => {
					onStock(!stock);
				}}
				pressed={stock}
			>
				In stock
			</DotToggle>
			<select
				aria-label="Bag size"
				className={hairlineSelectClass}
				onChange={(event) => {
					onSize(event.target.value === "" ? null : Number(event.target.value));
				}}
				value={size ?? ""}
			>
				<option value="">Any size</option>
				{weightOptions.map((option) => (
					<option key={option} value={option}>
						{formatWeight(option)}
					</option>
				))}
			</select>
			<input
				aria-label="Price at most, dollars"
				autoComplete="off"
				className={`${hairlineInputClass} w-28 text-sm`}
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
				className={`${hairlineInputClass} w-40 text-sm`}
				onChange={(event) => {
					onOrigin(event.target.value);
				}}
				placeholder="Origin"
				type="search"
				value={origin}
			/>
		</div>
	);
};

/**
 * The roaster's lot catalog (screen inventory §11). Browsing pages the
 * full catalog; typing in the filter switches to a name search over the
 * whole catalog (Sey runs ~887 lots, so paging alone would never find
 * anything). Same hairline table as the index; the roaster's notes fill the
 * wide column; hovering a row floats the lot's photo above the table
 * (ADR-0015). Logging happens on the lot page, so the catalog's rows end
 * in the arrow instead of a Log button. The stock boundary is explicit:
 * unavailable lots dim and say so, and filters (size, price, origin, in
 * stock) run against the whole catalog.
 */
export const Lots = ({
	roasterId,
	slug,
}: {
	roasterId: Id<"roasters">;
	slug: string;
}) => {
	const [search, setSearch] = useState("");
	// In stock by default (owner, 2026-09-21); the toggle shows everything.
	const [inStockOnly, setInStockOnly] = useState(true);
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

	// The size filter's choices: every bag size the whole catalog carries,
	// not only the loaded pages. Empty until the query answers.
	const weightOptions =
		useQuery(api.roasters.lotWeightOptions, { roasterId }) ?? [];

	return (
		<section aria-labelledby="lots-heading">
			<div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-4">
				<SectionHeading id="lots-heading">Lots</SectionHeading>
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
				loading={loading}
				pages={pages}
				searching={searching}
				slug={slug}
				term={term}
				visible={visible}
			/>
		</section>
	);
};
