import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { describeMutationError } from "@/lib/errors";

/**
 * Save / Saved toggle for one lot ("Want to try", spec §6). Renders nothing
 * signed out: saving is private and there is no signed-out state to show.
 * `fromRunId` records the Find-my-next-bag run a save came from.
 */
export const SaveButton = ({
	className = "",
	fromRunId,
	lotId,
	size = "default",
}: {
	className?: string;
	fromRunId?: Id<"recommendationRuns">;
	lotId: Id<"products">;
	size?: "default" | "sm";
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

	const sizing =
		size === "sm" ? "px-2.5 py-1 text-xs" : "min-h-11 px-3 py-1.5 text-sm";
	if (isSaved) {
		return (
			<button
				aria-pressed
				className={`hover:bg-accent inline-flex items-center gap-1.5 rounded-md border transition-colors disabled:opacity-50 ${sizing} ${className}`}
				disabled={busy}
				onClick={toggle}
				type="button"
			>
				<BookmarkCheck aria-hidden className="size-4 text-emerald-500" />
				Saved
			</button>
		);
	}
	return (
		<button
			aria-pressed={false}
			className={`hover:bg-accent inline-flex items-center gap-1.5 rounded-md border transition-colors disabled:opacity-50 ${sizing} ${className}`}
			disabled={busy}
			onClick={toggle}
			type="button"
		>
			<Bookmark aria-hidden className="size-4" />
			Save
		</button>
	);
};
