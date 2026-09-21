import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { DotToggle } from "@/components/dot-toggle";

/**
 * Watch/unwatch as the dot toggle: WATCH in grey, WATCHING in ink. Local
 * pending state while the mutation runs.
 */
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

	return (
		<DotToggle
			busy={busy}
			onClick={() => {
				void toggle();
			}}
			pressed={isWatching}
			title={isWatching ? "Stop watching this roaster" : undefined}
		>
			{isWatching ? "Watching" : "Watch"}
		</DotToggle>
	);
};
