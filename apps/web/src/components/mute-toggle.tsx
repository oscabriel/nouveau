import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { useState } from "react";

import { DotToggle } from "@/components/dot-toggle";

/**
 * MUTE / MUTED for one watch (ADR-0016), the same dot toggle on the
 * profile's watch rows and the alerts tab. A failed flip keeps the state
 * the live query reports; there is nothing to tell the user beyond that.
 */
export const MuteToggle = ({
	muted,
	roasterId,
}: {
	muted: boolean;
	roasterId: Id<"roasters">;
}) => {
	const setMuted = useMutation(api.watches.setWatchMuted);
	const [busy, setBusy] = useState(false);
	const toggle = async () => {
		setBusy(true);
		try {
			await setMuted({ muted: !muted, roasterId });
		} catch {
			// The query refreshes; a failed toggle keeps state.
		}
		setBusy(false);
	};
	return (
		<DotToggle
			busy={busy}
			onClick={() => {
				void toggle();
			}}
			pressed={muted}
		>
			{muted ? "Muted" : "Mute"}
		</DotToggle>
	);
};
