import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { TASTING_FAMILIES } from "@nouveau/backend/convex/tasting";
import type { TastingFamily } from "@nouveau/backend/convex/tasting";
import { createFileRoute, Link, useSearch } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { DotToggle } from "@/components/dot-toggle";
import { DropTable } from "@/components/drop-index";
import Loader from "@/components/loader";
import { PageTitle } from "@/components/page-title";
import { DROP_TYPE_LABEL } from "@/lib/drops";
import type { DropType } from "@/lib/drops";

type GlobalRow = FunctionReturnType<typeof api.feed.globalFeed>[number];
type PersonalizedRow = FunctionReturnType<
	typeof api.feed.personalizedFeed
>[number];

const FEED_PAGE_LIMIT = 100;

const isFamily = (value: unknown): value is TastingFamily =>
	typeof value === "string" &&
	(TASTING_FAMILIES as readonly string[]).includes(value);

type Filter = "all" | DropType;

const DELIVERY_LABEL = {
	delivered: "Alert delivered",
	failed: "Alert failed",
	pending: "Alert pending",
	sent: "Alert sent",
} as const;

/** The one grey delivery line under a row of the Your roasters tab. */
const deliveryLine = (row: PersonalizedRow): string =>
	row.deliveryStatus === null
		? "No alert sent for this drop"
		: DELIVERY_LABEL[row.deliveryStatus];

/**
 * The delivery line's row: under its event row, aligned with the lot name,
 * carrying the hairline the event row gave up so the pair reads as one entry.
 */
const DeliveryRow = ({
	columnCount,
	row,
}: {
	columnCount: number;
	row: PersonalizedRow;
}) => (
	<tr className="border-b">
		{/* pl matches the number column (w-10 md:w-28) so the line sits under the lot name. */}
		<td
			className="text-muted-foreground pb-5 pl-10 text-xs md:pl-28"
			colSpan={columnCount}
		>
			{deliveryLine(row)}
		</td>
	</tr>
);

/** underRow for DropTable on the Your roasters tab. */
const deliveryUnderRow = (row: PersonalizedRow, columnCount: number) => (
	<DeliveryRow columnCount={columnCount} row={row} />
);

/** The type tabs above the table; counts come from the global feed. */
const FilterTabs = ({
	feed,
	filter,
	onChange,
}: {
	feed: GlobalRow[];
	filter: Filter;
	onChange: (next: Filter) => void;
}) => {
	const counts = {
		all: feed.length,
		back_in_stock: 0,
		new: 0,
		price_drop: 0,
	};
	for (const row of feed) {
		counts[row.type] += 1;
	}
	const tabs: { label: string; value: Filter }[] = [
		{ label: "All", value: "all" },
		{ label: DROP_TYPE_LABEL.new, value: "new" },
		{ label: DROP_TYPE_LABEL.back_in_stock, value: "back_in_stock" },
		{ label: DROP_TYPE_LABEL.price_drop, value: "price_drop" },
	];
	return (
		<div className="flex overflow-x-auto">
			<div
				className="mx-auto flex shrink-0 gap-5 border-b md:gap-8"
				role="tablist"
			>
				{tabs.map((tab) => {
					const active = tab.value === filter;
					return (
						<button
							aria-selected={active}
							className={`-mb-px inline-flex min-h-11 shrink-0 items-baseline gap-1 border-b pb-3 text-lg transition-colors md:text-2xl ${
								active
									? "border-foreground text-foreground"
									: "text-muted-foreground hover:text-foreground border-transparent"
							}`}
							key={tab.value}
							onClick={() => {
								onChange(tab.value);
							}}
							role="tab"
							type="button"
						>
							{tab.label}
							<span className="tnum text-xs">({counts[tab.value]})</span>
						</button>
					);
				})}
			</div>
		</div>
	);
};

/** The column filters, all client-side over the loaded rows. */
interface ColumnFilters {
	city: string;
	family: TastingFamily | null;
	maxPriceDollars: string;
	origin: string;
	roaster: string;
}

const NO_FILTERS: ColumnFilters = {
	city: "",
	family: null,
	maxPriceDollars: "",
	origin: "",
	roaster: "",
};

/** The price a row is filtered on: the event's new price, else the lot's minimum. */
const rowPriceCents = (row: GlobalRow): number | null =>
	row.newPriceCents ?? row.minPriceCents;

const applyFilters = <Row extends GlobalRow>(
	rows: Row[],
	type: Filter,
	filters: ColumnFilters
): Row[] => {
	const maxCents = Math.round(Number(filters.maxPriceDollars) * 100);
	const priceCapped = !Number.isNaN(maxCents) && maxCents > 0;
	const originTerm = filters.origin.trim().toLowerCase();
	return rows.filter((row) => {
		if (type !== "all" && row.type !== type) {
			return false;
		}
		if (filters.roaster !== "" && row.roasterSlug !== filters.roaster) {
			return false;
		}
		if (
			filters.city !== "" &&
			`${row.roasterCity}, ${row.roasterState}` !== filters.city
		) {
			return false;
		}
		if (
			originTerm !== "" &&
			!(row.origin ?? "").toLowerCase().includes(originTerm)
		) {
			return false;
		}
		if (filters.family !== null && !row.families.includes(filters.family)) {
			return false;
		}
		if (priceCapped) {
			const cents = rowPriceCents(row);
			if (cents === null || cents > maxCents) {
				return false;
			}
		}
		return true;
	});
};

/** Distinct values of one column across the rows, sorted for a select. */
const distinct = <Row,>(rows: Row[], pick: (row: Row) => string): string[] =>
	[...new Set(rows.map(pick))].toSorted((a, b) => a.localeCompare(b));

const selectClass =
	"text-muted-foreground focus-visible:border-foreground h-11 max-w-44 border-b bg-transparent text-sm outline-none";
const inputClass =
	"placeholder:text-muted-foreground focus-visible:border-foreground h-11 border-b bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden";

/**
 * The filter row under the tabs: one hairline control per column (roaster,
 * city, origin, tasting-note family, price at most), the MY ROASTERS dot
 * toggle first when signed in, and CLEAR when anything is set. The roaster
 * and city choices are the ones present in the loaded rows.
 */
const DropFilterRow = ({
	filters,
	mine,
	onFilters,
	onMine,
	rows,
	showMine,
}: {
	filters: ColumnFilters;
	mine: boolean;
	onFilters: (next: ColumnFilters) => void;
	onMine: (next: boolean) => void;
	rows: GlobalRow[];
	showMine: boolean;
}) => {
	const roasters = distinct(rows, (row) => row.roasterSlug).map((slug) => ({
		name: rows.find((row) => row.roasterSlug === slug)?.roasterName ?? slug,
		slug,
	}));
	const cities = distinct(
		rows,
		(row) => `${row.roasterCity}, ${row.roasterState}`
	);
	const set = <Key extends keyof ColumnFilters>(
		key: Key,
		value: ColumnFilters[Key]
	) => {
		onFilters({ ...filters, [key]: value });
	};
	const anySet =
		filters.roaster !== "" ||
		filters.city !== "" ||
		filters.origin !== "" ||
		filters.family !== null ||
		filters.maxPriceDollars !== "";
	return (
		<div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-5 md:px-10">
			{showMine && (
				<DotToggle
					onClick={() => {
						onMine(!mine);
					}}
					pressed={mine}
				>
					My roasters
				</DotToggle>
			)}
			<select
				aria-label="Roaster"
				className={selectClass}
				onChange={(event) => {
					set("roaster", event.target.value);
				}}
				value={filters.roaster}
			>
				<option value="">Any roaster</option>
				{roasters.map((roaster) => (
					<option key={roaster.slug} value={roaster.slug}>
						{roaster.name}
					</option>
				))}
			</select>
			<select
				aria-label="City"
				className={selectClass}
				onChange={(event) => {
					set("city", event.target.value);
				}}
				value={filters.city}
			>
				<option value="">Any city</option>
				{cities.map((city) => (
					<option key={city} value={city}>
						{city}
					</option>
				))}
			</select>
			<input
				aria-label="Origin contains"
				autoComplete="off"
				className={`${inputClass} w-36`}
				onChange={(event) => {
					set("origin", event.target.value);
				}}
				placeholder="Origin"
				type="search"
				value={filters.origin}
			/>
			<select
				aria-label="Tasting-note family"
				className={selectClass}
				onChange={(event) => {
					const { value } = event.target;
					set("family", isFamily(value) ? value : null);
				}}
				value={filters.family ?? ""}
			>
				<option value="">Any notes</option>
				{TASTING_FAMILIES.map((family) => (
					<option key={family} value={family}>
						{family}
					</option>
				))}
			</select>
			<input
				aria-label="Price at most, dollars"
				autoComplete="off"
				className={`${inputClass} w-28`}
				min="0"
				onChange={(event) => {
					set("maxPriceDollars", event.target.value);
				}}
				placeholder="≤ $ price"
				step="any"
				type="number"
				value={filters.maxPriceDollars}
			/>
			{anySet && (
				<button
					className="label-caps text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center"
					onClick={() => {
						onFilters(NO_FILTERS);
					}}
					type="button"
				>
					Clear
				</button>
			)}
		</div>
	);
};

/** The empty line under an empty table, naming what was asked for. */
const emptyLine = (mine: boolean, filtered: boolean): React.ReactNode => {
	if (mine && !filtered) {
		return (
			<>
				Nothing from your roasters yet. Find one to watch in the{" "}
				<Link className="underline" to="/roasters">
					roaster directory
				</Link>
				.
			</>
		);
	}
	if (filtered) {
		return "No recent drop matches those filters.";
	}
	return "No drops yet. The crawlers are out there checking.";
};

/**
 * The drop feed as a table (ADR-0015): one row per event, the type tabs
 * above, then a filter row (batch 8, 2026-09-21): roaster, city, origin,
 * tasting-note family and a price cap, all client-side over the loaded
 * rows, plus MY ROASTERS signed in, which swaps the rows for the watched
 * roasters' events with the delivery line under each (ADR-0016; it was the
 * Your roasters tab). `?family=` seeds the family filter from a pill link.
 * The event price carries its strike on price drops and the lot's minimum
 * "from"-prefixed otherwise.
 */
const FeedComponent = () => {
	const { isAuthenticated } = useConvexAuth();
	const { family } = useSearch({ from: "/drops" });
	const [type, setType] = useState<Filter>("all");
	const [wantMine, setWantMine] = useState(false);
	const [filters, setFilters] = useState<ColumnFilters>({
		...NO_FILTERS,
		family: family ?? null,
	});
	const mine = wantMine && isAuthenticated;
	const feed = useQuery(api.feed.globalFeed, { limit: FEED_PAGE_LIMIT });
	const personal = useQuery(
		api.feed.personalizedFeed,
		isAuthenticated ? { limit: FEED_PAGE_LIMIT } : "skip"
	);
	const filtered =
		type !== "all" ||
		filters.roaster !== "" ||
		filters.city !== "" ||
		filters.origin !== "" ||
		filters.family !== null ||
		filters.maxPriceDollars !== "";

	let body: React.ReactNode;
	if (feed === undefined || (mine && personal === undefined)) {
		body = <Loader />;
	} else if (mine && personal !== undefined) {
		const shown = applyFilters(personal, type, filters);
		body = (
			<div className="px-5 md:px-10">
				<DropTable rows={shown} underRow={deliveryUnderRow} />
				{shown.length === 0 && (
					<p className="text-muted-foreground py-16 text-center text-[15px]">
						{emptyLine(true, filtered)}
					</p>
				)}
			</div>
		);
	} else {
		const shown = applyFilters(feed, type, filters);
		body = (
			<div className="px-5 md:px-10">
				<DropTable rows={shown} />
				{shown.length === 0 && (
					<p className="text-muted-foreground py-16 text-center text-[15px]">
						{emptyLine(false, filtered)}
					</p>
				)}
			</div>
		);
	}

	return (
		<main>
			<div className="px-5 pt-10 md:px-10 md:pt-14">
				<PageTitle title="Drops" />
				<p className="text-muted-foreground mt-4 max-w-prose text-sm md:text-[15px]">
					Every alert-worthy drop across every roaster Nouveau watches, as it
					happens.
				</p>
			</div>
			<div className="mt-12 md:mt-16">
				{feed !== undefined && (
					<>
						<FilterTabs feed={feed} filter={type} onChange={setType} />
						<div className="mt-8">
							<DropFilterRow
								filters={filters}
								mine={mine}
								onFilters={setFilters}
								onMine={setWantMine}
								rows={feed}
								showMine={isAuthenticated}
							/>
						</div>
					</>
				)}
				<div className={feed === undefined ? "" : "mt-10"}>{body}</div>
			</div>
		</main>
	);
};

/**
 * `?family=fruity` narrows the table to lots whose roaster notes fall in
 * that wheel family; a tasting-note pill anywhere links here. Anything
 * else in the param is dropped.
 */
export const Route = createFileRoute("/drops")({
	component: FeedComponent,
	validateSearch: (search: Record<string, unknown>) =>
		isFamily(search.family) ? { family: search.family } : {},
});
