import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { BellOff, BellRing } from "lucide-react";
import { useState } from "react";

/** Watch/unwatch toggle with a local pending state while the mutation runs. */
export const WatchButton = ({ roasterId }: { roasterId: Id<"roasters"> }) => {
	const watched = useQuery(api.watches.myWatchedRoasterIds);
	const [busy, setBusy] = useState(false);
	const watch = useMutation(api.watches.watchRoaster);
	const unwatch = useMutation(api.watches.unwatchRoaster);

	if (watched === undefined) {
		return null;
	}
	const isWatching = watched.some((id) => id === roasterId);
	const toggle = async () => {
		setBusy(true);
		try {
			await (isWatching ? unwatch({ roasterId }) : watch({ roasterId }));
		} catch {
			// The watched-ids query keeps its current value on failure.
		}
		setBusy(false);
	};

	if (isWatching) {
		return (
			<button
				className="hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
				disabled={busy}
				onClick={toggle}
				type="button"
			>
				<BellRing aria-hidden className="size-4 text-emerald-500" />
				Watching
			</button>
		);
	}
	return (
		<button
			className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
			disabled={busy}
			onClick={toggle}
			type="button"
		>
			<BellOff aria-hidden className="size-4" />
			Watch
		</button>
	);
};
