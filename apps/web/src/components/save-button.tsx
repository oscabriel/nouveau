import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { DotToggle } from "@/components/dot-toggle";
import { describeMutationError } from "@/lib/errors";

/**
 * Save / Saved for one lot (the try list, ADR-0016) as the dot toggle:
 * SAVE in grey, SAVED in ink. Renders nothing signed out:
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
		<DotToggle
			busy={busy}
			className={className}
			onClick={() => {
				void toggle();
			}}
			pressed={isSaved}
			title={isSaved ? "Remove from your try list" : undefined}
		>
			{isSaved ? "Saved" : "Save"}
		</DotToggle>
	);
};
