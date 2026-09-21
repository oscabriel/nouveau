import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { describeMutationError } from "@/lib/errors";

/**
 * Save / Saved for one lot (the try list, ADR-0016) in the WATCH / WATCHING
 * vocabulary: a faded dot and grey when not saved, a filled dot and ink when
 * saved, `aria-pressed` carrying the state. Renders nothing signed out:
 * saving is private and there is no signed-out state to show. `fromRunId`
 * records the Find-my-next-bag run a save came from.
 */
export const SaveButton = ({
	className = "",
	fromRunId,
	lotId,
}: {
	className?: string;
	fromRunId?: Id<"recommendationRuns">;
	lotId: Id<"products">;
}) => {
	const { isAuthenticated } = useConvexAuth();
	const saved = useQuery(
		api.savedCoffees.mySavedProductIds,
		isAuthenticated ? {} : "skip"
	);
	const [busy, setBusy] = useState(false);
	const save = useMutation(api.savedCoffees.save);
	const unsave = useMutation(api.savedCoffees.unsave);

	if (!isAuthenticated || saved === undefined) {
		return null;
	}
	const isSaved = saved.some((id) => id === lotId);
	const toggle = async () => {
		setBusy(true);
		try {
			if (isSaved) {
				await unsave({ productId: lotId });
			} else {
				await save({ fromRunId, productId: lotId });
				if (saved.length === 0) {
					toast.success("Saved. Only you can see it; no email, no watch.");
				}
			}
		} catch (error) {
			toast.error(describeMutationError(error, "Could not save this lot."));
		}
		setBusy(false);
	};

	return (
		<button
			aria-pressed={isSaved}
			className={`label-caps inline-flex min-h-11 items-center gap-2 whitespace-nowrap transition-colors disabled:cursor-default ${
				isSaved
					? "text-foreground"
					: "text-muted-foreground hover:text-foreground"
			} ${className}`}
			disabled={busy}
			onClick={toggle}
			title={isSaved ? "Remove from your try list" : undefined}
			type="button"
		>
			<span
				aria-hidden
				className={`inline-block size-2 rounded-full bg-current transition-opacity ${
					isSaved ? "opacity-100" : "opacity-30"
				} ${busy ? "motion-safe:animate-pulse" : ""}`}
			/>
			{isSaved ? "Saved" : "Save"}
		</button>
	);
};
