import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { ArrowCell, TableHoverImage } from "@/components/table";
import { DROP_TYPE_LABEL, formatDropDate } from "@/lib/drops";
import type { DropRow, DropType } from "@/lib/drops";
import { displayPriceCents, formatPrice } from "@/lib/format";
import { bodyCell, headCell } from "@/lib/ui";

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
	<div className="flex justify-center">
		<div
			className="flex max-w-full gap-5 overflow-x-auto border-b md:gap-8"
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
}: {
	index: number;
	row: DropRow;
	showRoaster: boolean;
}) => {
	const price = displayPriceCents(row.newPriceCents);
	const oldPrice = displayPriceCents(row.oldPriceCents);
	return (
		<tr
			className="group hover:bg-muted focus-within:bg-muted border-b transition-colors"
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
				{oldPrice !== null && price !== null && oldPrice !== price && (
					<span className="mr-2 line-through opacity-60">
						{formatPrice(oldPrice)}
					</span>
				)}
				{price === null ? "" : formatPrice(price)}
			</td>
			<ArrowCell
				label={`Open ${row.productName} at ${row.roasterName}`}
				params={{ lot: row.lotHandle, roaster: row.roasterSlug }}
				to="/roaster/$roaster/$lot"
			/>
		</tr>
	);
};

/**
 * The hairline drop table on its own: N°, lot, roaster and city (unless the
 * page is that roaster's), origin, event, released (MM.DD, ADR-0014), price.
 * The lot name and the arrow at the row's end both open the Nouveau lot page
 * (ADR-0015); hovering a row floats the lot's photo above the table,
 * following the pointer.
 */
export const DropTable = ({
	className = "",
	rows,
	showRoaster = true,
}: {
	className?: string;
	rows: DropRow[];
	/** Off on a roaster's own page, where the name is the title. */
	showRoaster?: boolean;
}) => {
	const tableRef = useRef<HTMLTableElement>(null);
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
						<th
							className={`${headCell} hidden text-right sm:table-cell`}
							scope="col"
						>
							Price
						</th>
						<th className={headCell} scope="col">
							<span className="sr-only">Open the lot</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<DropTableRow
							index={index}
							key={row.eventId}
							row={row}
							showRoaster={showRoaster}
						/>
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
