import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

/**
 * Watch/unwatch as a caps toggle in the LATEST / SHUFFLE vocabulary: a filled
 * dot and ink when watching, a faded dot and grey when not. `aria-pressed`
 * carries the state; the label names it. Local pending state while the
 * mutation runs.
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
		<button
			aria-pressed={isWatching}
			className={`label-caps inline-flex min-h-11 items-center gap-2 whitespace-nowrap transition-colors disabled:cursor-default ${
				isWatching
					? "text-foreground"
					: "text-muted-foreground hover:text-foreground"
			}`}
			disabled={busy}
			onClick={toggle}
			title={isWatching ? "Stop watching this roaster" : undefined}
			type="button"
		>
			<span
				aria-hidden
				className={`inline-block size-2 rounded-full bg-current transition-opacity ${
					isWatching ? "opacity-100" : "opacity-30"
				} ${busy ? "motion-safe:animate-pulse" : ""}`}
			/>
			{isWatching ? "Watching" : "Watch"}
		</button>
	);
};
