import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { DROP_TYPE_LABEL, formatDropDate, thumbUrl } from "@/lib/drops";
import type { DropRow, DropType } from "@/lib/drops";
import { displayPriceCents, formatPrice } from "@/lib/format";

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

/** Table head and body cell classes, shared by every index table. */
export const headCell = "label-caps text-foreground pb-3 text-left font-medium";
export const bodyCell = "py-5 align-top text-sm leading-snug md:text-[15px]";

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
		<tr className="group hover:bg-muted focus-within:bg-muted border-b transition-colors">
			<td className={`${bodyCell} relative w-10 pr-2 md:w-28 md:pr-3`}>
				<span className="text-muted-foreground tnum text-xs transition-opacity group-focus-within:opacity-0 group-hover:opacity-0">
					{index + 1}
				</span>
				{row.imageUrl !== null && (
					<img
						alt=""
						aria-hidden
						className="absolute inset-y-0 left-0 hidden h-full w-28 -translate-x-3 object-cover opacity-0 transition duration-300 ease-out group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100 motion-reduce:transition-none md:block"
						decoding="async"
						loading="lazy"
						src={thumbUrl(row.imageUrl, 240)}
					/>
				)}
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
				className={`${bodyCell} text-muted-foreground hidden pr-4 lg:table-cell`}
			>
				{row.process ?? ""}
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
			<td className={`${bodyCell} w-6 text-right md:w-8`}>
				<a
					aria-label={`Open ${row.productName} at ${row.roasterName}`}
					className="inline-flex size-6 items-center justify-center"
					href={row.lotUrl}
					rel="noreferrer"
					target="_blank"
				>
					<span className="size-2.5 rounded-full border border-current transition-colors group-hover:bg-current" />
				</a>
			</td>
		</tr>
	);
};

/**
 * The hairline drop table on its own: N°, lot, roaster and city (unless the
 * page is that roaster's), origin, process, event, date, price, shop link.
 * Hovering a row slides the lot's photo in from the left over its number.
 * The lot name opens the Nouveau lot page; the circle at the row's end
 * opens the roaster's own shop.
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
}) => (
	<table className={`w-full border-collapse ${className}`}>
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
				<th className={`${headCell} hidden lg:table-cell`} scope="col">
					Process
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
					<span className="sr-only">Shop</span>
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
);

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
