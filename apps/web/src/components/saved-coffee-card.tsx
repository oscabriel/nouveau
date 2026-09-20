import type { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight } from "lucide-react";

import { SaveButton } from "@/components/save-button";
import { relativeTime } from "@/lib/format";

export type SavedCoffee = FunctionReturnType<
	typeof api.savedCoffees.recentMine
>["items"][number];

/** Null when stock is unknown (no rollup yet): the card says nothing. */
const stockLabel = (item: SavedCoffee): string | null => {
	if (item.lot.status === "archived") {
		return "No longer listed";
	}
	if (item.available === null) {
		return null;
	}
	return item.available ? "In stock at last check" : "Sold out at last check";
};

/** One saved lot: name, roaster, stock, and the Saved toggle to drop it. */
export const SavedCoffeeCard = ({ item }: { item: SavedCoffee }) => (
	<article className="flex items-center gap-3 py-3">
		{item.lot.imageUrl !== null && (
			<img
				alt=""
				className="size-12 shrink-0 rounded-md border object-cover"
				src={item.lot.imageUrl}
			/>
		)}
		<div className="min-w-0 flex-1">
			<div className="flex flex-wrap items-baseline gap-x-2">
				<Link
					className="truncate font-medium hover:underline"
					params={{ lot: item.lot.handle, roaster: item.roaster.slug }}
					to="/roaster/$roaster/$lot"
				>
					{item.lot.name}
				</Link>
				<span className="text-muted-foreground text-sm">
					at{" "}
					<Link
						className="hover:underline"
						params={{ roaster: item.roaster.slug }}
						to="/roaster/$roaster"
					>
						{item.roaster.name}
					</Link>
				</span>
			</div>
			<p className="text-muted-foreground text-xs">
				{[stockLabel(item), "saved "]
					.filter((part) => part !== null)
					.join(" · ")}
				<time dateTime={new Date(item.savedAt).toISOString()}>
					{relativeTime(item.savedAt)}
				</time>
				{item.fromRunId !== null && " · from Find my next bag"}
			</p>
		</div>
		<a
			aria-label={`See ${item.lot.name} at ${item.roaster.name}`}
			className="text-muted-foreground hover:text-foreground shrink-0"
			href={item.lot.url}
			rel="noopener noreferrer"
			target="_blank"
		>
			<ArrowUpRight aria-hidden className="size-4" />
		</a>
		<SaveButton lotId={item.lot.id} size="sm" />
	</article>
);
