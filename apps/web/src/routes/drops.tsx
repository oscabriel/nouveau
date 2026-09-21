import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";

import { DropTable } from "@/components/drop-index";
import Loader from "@/components/loader";
import { PageTitle } from "@/components/page-title";
import { DROP_TYPE_LABEL } from "@/lib/drops";
import type { DropRow, DropType } from "@/lib/drops";
import { bodyCell } from "@/lib/ui";

type GlobalRow = FunctionReturnType<typeof api.feed.globalFeed>[number];
type PersonalizedRow = FunctionReturnType<
	typeof api.feed.personalizedFeed
>[number];

const FEED_PAGE_LIMIT = 100;

type Filter = "all" | DropType | "your";

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

/** The delivery line's row, full width, under its event row. */
const DeliveryRow = ({ row }: { row: PersonalizedRow }) => (
	<tr>
		<td className="px-5 md:px-10" colSpan={10}>
			<p className={`${bodyCell} text-muted-foreground text-xs md:pt-0`}>
				{deliveryLine(row)}
			</p>
		</td>
	</tr>
);

/** underRow for DropTable on the Your roasters tab. */
const deliveryUnderRow = (row: DropRow) => (
	<DeliveryRow row={row as PersonalizedRow} />
);

/** The filter strip above both bodies; counts come from the global feed. */
const FilterTabs = ({
	feed,
	filter,
	onChange,
	showYour,
}: {
	feed: GlobalRow[];
	filter: Filter;
	onChange: (next: Filter) => void;
	showYour: boolean;
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
	if (showYour) {
		tabs.push({ label: "Your roasters", value: "your" });
	}
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
							{tab.value !== "your" && (
								<span className="tnum text-xs">({counts[tab.value]})</span>
							)}
						</button>
					);
				})}
			</div>
		</div>
	);
};

const GlobalDrops = ({
	feed,
	filter,
}: {
	feed: GlobalRow[];
	filter: Exclude<Filter, "your">;
}) => {
	const shown =
		filter === "all" ? feed : feed.filter((row) => row.type === filter);
	return (
		<div className="px-5 md:px-10">
			<DropTable
				onlyTypes={filter === "all" ? undefined : [filter]}
				rows={feed}
			/>
			{shown.length === 0 && (
				<p className="text-muted-foreground py-16 text-center text-[15px]">
					No drops yet. The crawlers are out there checking.
				</p>
			)}
		</div>
	);
};

const YourDrops = ({ mine }: { mine: PersonalizedRow[] }) => (
	<div className="px-5 md:px-10">
		<DropTable rows={mine} underRow={deliveryUnderRow} />
		{mine.length === 0 && (
			<p className="text-muted-foreground py-16 text-center text-[15px]">
				Nothing from your roasters yet. Find one to watch in the{" "}
				<Link className="underline" to="/roasters">
					roaster directory
				</Link>
				.
			</p>
		)}
	</div>
);

/**
 * The drop feed as a table (ADR-0015): one row per event, the landing's
 * filter tabs above, the event price with its strike on price drops and
 * the lot's minimum "from"-prefixed otherwise. Signed in, a Your roasters
 * tab carries the watched roasters' events with the delivery line under
 * each row (ADR-0016). The tab strip sits above both bodies, so the Your
 * roasters tab has a way back; signing out while on it falls back to All.
 */
const FeedComponent = () => {
	const { isAuthenticated } = useConvexAuth();
	const [chosen, setChosen] = useState<Filter>("all");
	const filter: Filter = chosen === "your" && !isAuthenticated ? "all" : chosen;
	const feed = useQuery(api.feed.globalFeed, { limit: FEED_PAGE_LIMIT });
	const mine = useQuery(
		api.feed.personalizedFeed,
		isAuthenticated ? { limit: FEED_PAGE_LIMIT } : "skip"
	);

	let body: React.ReactNode;
	if (feed === undefined) {
		body = <Loader />;
	} else if (filter === "your") {
		body = mine === undefined ? <Loader /> : <YourDrops mine={mine} />;
	} else {
		body = <GlobalDrops feed={feed} filter={filter} />;
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
					<FilterTabs
						feed={feed}
						filter={filter}
						onChange={setChosen}
						showYour={isAuthenticated}
					/>
				)}
				<div className={feed === undefined ? "" : "mt-16"}>{body}</div>
			</div>
		</main>
	);
};

export const Route = createFileRoute("/drops")({
	component: FeedComponent,
});
