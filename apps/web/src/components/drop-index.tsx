import { Link } from "@tanstack/react-router";
import { Fragment, useRef, useState } from "react";
import type { ReactNode } from "react";

import { ArrowCell, TableHoverImage } from "@/components/table";
import { DROP_TYPE_LABEL, formatDropDate } from "@/lib/drops";
import type { DropRow, DropType } from "@/lib/drops";
import { displayPriceCents, formatPrice } from "@/lib/format";
import { bodyCell, headCell, headCellRight } from "@/lib/ui";

type Filter = "all" | DropType;

const FILTERS: Filter[] = ["all", "new", "back_in_stock", "price_drop"];

const filterLabel = (filter: Filter): string =>
	filter === "all" ? "All" : DROP_TYPE_LABEL[filter];

/** One row per lot: the feed carries an event per variant, the index a lot. */
const onePerLot = (rows: DropRow[]): DropRow[] => {
	const seen = new Set<string>();
	return rows.filter((row) => {
		if (seen.has(row.productId)) {
			return false;
		}
		seen.add(row.productId);
		return true;
	});
};

const FilterTabs = ({
	counts,
	filter,
	onChange,
}: {
	counts: Record<Filter, number>;
	filter: Filter;
	onChange: (next: Filter) => void;
}) => (
	<div className="flex overflow-x-auto">
		<div
			className="mx-auto flex shrink-0 gap-5 border-b md:gap-8"
			role="tablist"
		>
			{FILTERS.map((option) => {
				const active = option === filter;
				return (
					<button
						aria-selected={active}
						className={`-mb-px inline-flex min-h-11 shrink-0 items-baseline gap-1 border-b pb-3 text-lg transition-colors md:text-2xl ${
							active
								? "border-foreground text-foreground"
								: "text-muted-foreground hover:text-foreground border-transparent"
						}`}
						key={option}
						onClick={() => onChange(option)}
						role="tab"
						type="button"
					>
						{filterLabel(option)}
						<span className="tnum text-xs">({counts[option]})</span>
					</button>
				);
			})}
		</div>
	</div>
);

const DropTableRow = ({
	index,
	row,
	showRoaster,
	withUnderRow,
}: {
	index: number;
	row: DropRow;
	showRoaster: boolean;
	/** The hairline moves to the under row so the pair reads as one entry. */
	withUnderRow: boolean;
}) => {
	const eventPrice = displayPriceCents(row.newPriceCents);
	const oldPrice = displayPriceCents(row.oldPriceCents);
	const minPrice = displayPriceCents(row.minPriceCents);
	// A price-drop row shows the event's own price, old one struck; every
	// other row shows the lot's lowest available price, "from" prefixed
	// (ADR-0015), falling back to the event price when the rollup has not
	// written a minimum yet.
	const isDrop = row.type === "price_drop";
	let priceCell: string;
	if (isDrop) {
		priceCell = eventPrice === null ? "" : formatPrice(eventPrice);
	} else if (minPrice === null) {
		priceCell = eventPrice === null ? "" : formatPrice(eventPrice);
	} else {
		priceCell = `from ${formatPrice(minPrice)}`;
	}
	return (
		<tr
			className={`group hover:bg-muted focus-within:bg-muted transition-colors ${
				withUnderRow ? "" : "border-b"
			}`}
			data-image-url={row.imageUrl ?? undefined}
		>
			<td
				className={`${bodyCell} text-muted-foreground tnum w-10 pr-2 text-xs md:w-28 md:pr-3`}
			>
				{index + 1}
			</td>
			<td className={`${bodyCell} pr-4`}>
				<Link
					className="hover:underline"
					params={{ lot: row.lotHandle, roaster: row.roasterSlug }}
					to="/roaster/$roaster/$lot"
				>
					{row.productName}
				</Link>
			</td>
			{showRoaster && (
				<>
					<td className={`${bodyCell} text-muted-foreground pr-3 md:pr-4`}>
						<Link
							className="hover:text-foreground hover:underline"
							params={{ roaster: row.roasterSlug }}
							to="/roaster/$roaster"
						>
							{row.roasterName}
						</Link>
					</td>
					<td
						className={`${bodyCell} text-muted-foreground hidden pr-4 lg:table-cell`}
					>
						{row.roasterCity}, {row.roasterState}
					</td>
				</>
			)}
			<td
				className={`${bodyCell} text-muted-foreground hidden pr-4 md:table-cell`}
			>
				{row.origin ?? ""}
			</td>
			<td
				className={`${bodyCell} text-muted-foreground hidden pr-4 whitespace-nowrap sm:table-cell`}
			>
				{DROP_TYPE_LABEL[row.type]}
			</td>
			<td
				className={`${bodyCell} text-muted-foreground tnum pr-2 whitespace-nowrap md:pr-4`}
			>
				{formatDropDate(row.detectedAt)}
			</td>
			<td
				className={`${bodyCell} text-muted-foreground tnum hidden pr-4 text-right whitespace-nowrap sm:table-cell`}
			>
				{isDrop &&
					oldPrice !== null &&
					eventPrice !== null &&
					oldPrice !== eventPrice && (
						<span className="mr-2 line-through opacity-60">
							{formatPrice(oldPrice)}
						</span>
					)}
				{priceCell}
			</td>
			<ArrowCell
				label={`Open ${row.productName} at ${row.roasterName}`}
				params={{ lot: row.lotHandle, roaster: row.roasterSlug }}
				to="/roaster/$roaster/$lot"
			/>
		</tr>
	);
};

/** N°, lot, origin, event, released, price, arrow; Roaster and City join them. */
const BASE_COLUMN_COUNT = 7;
const ROASTER_COLUMN_COUNT = 2;

/** How many `td`s a row spans, so an under row can cover the full width. */
export const dropTableColumnCount = (showRoaster: boolean): number =>
	BASE_COLUMN_COUNT + (showRoaster ? ROASTER_COLUMN_COUNT : 0);

/**
 * The hairline drop table on its own: N°, lot, roaster and city (unless the
 * page is that roaster's), origin, event, released (MM.DD, ADR-0014), price.
 * The lot name and the arrow at the row's end both open the Nouveau lot page
 * (ADR-0015); hovering a row floats the lot's photo above the table,
 * following the pointer. Generic over the row so a caller with a wider row
 * type (the personalized feed) gets it back unchanged in `underRow`.
 */
export const DropTable = <Row extends DropRow>({
	className = "",
	rows,
	showRoaster = true,
	underRow,
}: {
	className?: string;
	rows: Row[];
	/** Off on a roaster's own page, where the name is the title. */
	showRoaster?: boolean;
	/**
	 * An extra full-width row under each event row (the delivery lines);
	 * `columnCount` is the table's own count, for the cell's `colSpan`.
	 */
	underRow?: (row: Row, columnCount: number) => ReactNode;
}) => {
	const tableRef = useRef<HTMLTableElement>(null);
	const columnCount = dropTableColumnCount(showRoaster);
	return (
		<>
			<table className={`w-full border-collapse ${className}`} ref={tableRef}>
				<thead>
					<tr className="border-b">
						<th className={`${headCell} w-10 md:w-28`} scope="col">
							N°
						</th>
						<th className={headCell} scope="col">
							Lot
						</th>
						{showRoaster && (
							<>
								<th className={headCell} scope="col">
									Roaster
								</th>
								<th className={`${headCell} hidden lg:table-cell`} scope="col">
									City
								</th>
							</>
						)}
						<th className={`${headCell} hidden md:table-cell`} scope="col">
							Origin
						</th>
						<th className={`${headCell} hidden sm:table-cell`} scope="col">
							Event
						</th>
						<th className={headCell} scope="col">
							Released
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
					{rows.map((row, index) => (
						<Fragment key={row.eventId}>
							<DropTableRow
								index={index}
								row={row}
								showRoaster={showRoaster}
								withUnderRow={underRow !== undefined}
							/>
							{underRow?.(row, columnCount)}
						</Fragment>
					))}
				</tbody>
			</table>
			<TableHoverImage tableRef={tableRef} />
		</>
	);
};

/**
 * The index: every lot with a recent alert-worthy drop, newest first,
 * collapsed to one row per lot, with tabs by event type above the table.
 */
export const DropIndex = ({ rows: events }: { rows: DropRow[] }) => {
	const [filter, setFilter] = useState<Filter>("all");
	const rows = onePerLot(events);
	const counts: Record<Filter, number> = {
		all: rows.length,
		back_in_stock: 0,
		new: 0,
		price_drop: 0,
	};
	for (const row of rows) {
		counts[row.type] += 1;
	}
	const shown = filter === "all" ? rows : rows.filter((r) => r.type === filter);

	return (
		<section aria-label="Recent drops">
			<FilterTabs counts={counts} filter={filter} onChange={setFilter} />
			{shown.length === 0 ? (
				<p className="text-muted-foreground py-16 text-center text-[15px]">
					No drops yet. The crawlers are out there checking.
				</p>
			) : (
				<DropTable className="mt-16" rows={shown} />
			)}
		</section>
	);
};
