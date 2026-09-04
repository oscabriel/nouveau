import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import { Input } from "@nouveau/ui/components/input";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";

import Loader from "@/components/loader";
import { LogForm } from "@/components/log-form";

/**
 * The roaster's lot catalog (screen inventory §11), the place a log starts:
 * find the lot you tried, hit Log, rate it, keep a note. Paginated over the
 * full catalog (Sey runs ~887 lots); search filters the loaded page.
 */
export const Lots = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const { isAuthenticated } = useConvexAuth();
	const lots = usePaginatedQuery(
		api.roasters.listLots,
		{ roasterId },
		{ initialNumItems: 20 }
	);
	const [openLotId, setOpenLotId] = useState<Id<"products"> | null>(null);
	const [search, setSearch] = useState("");

	if (lots.status === "LoadingFirstPage") {
		return <Loader />;
	}

	const visible = lots.results.filter((lot) =>
		lot.name.toLowerCase().includes(search.toLowerCase())
	);

	return (
		<section>
			<div className="mb-2 flex items-baseline justify-between gap-4">
				<h2 className="font-semibold">Lots</h2>
				<Input
					aria-label="Filter lots"
					className="h-8 w-48 text-sm"
					onChange={(event) => {
						setSearch(event.target.value);
					}}
					placeholder="Filter lots"
					value={search}
				/>
			</div>
			<ul className="divide-y">
				{visible.map((lot) => (
					<li className="py-2" key={lot.id}>
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
							{isAuthenticated && openLotId !== lot.id && (
								<Button
									onClick={() => {
										setOpenLotId(lot.id);
									}}
									size="sm"
									variant="outline"
								>
									Log
								</Button>
							)}
						</div>
						{isAuthenticated && openLotId === lot.id && (
							<LogForm
								lotId={lot.id}
								onDone={() => {
									setOpenLotId(null);
								}}
							/>
						)}
					</li>
				))}
			</ul>
			{visible.length === 0 && (
				<p className="text-muted-foreground py-4 text-sm">
					No lots match on this page.
				</p>
			)}
			{lots.status === "CanLoadMore" && (
				<Button
					className="mt-3"
					onClick={() => {
						lots.loadMore(20);
					}}
					size="sm"
					variant="ghost"
				>
					Load more
				</Button>
			)}
		</section>
	);
};
