import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { SignInCta } from "@/components/sign-in-cta";
import { describeMutationError } from "@/lib/errors";
import { navLinkClass } from "@/lib/ui";

import type { Run } from "./stat-strip";

const selectClass =
	"text-foreground focus-visible:border-foreground h-8 min-w-0 flex-1 border-b bg-transparent text-[13px] outline-none";

/**
 * The run controls: a hairline select over the active roasters, START as
 * a caps action, and STOP beside it while the viewer's own run is going. START
 * during a run supersedes it (the backend stops the old one), so a roaster
 * never has to finish before the next. Signed out, the sign-in block stands
 * in for the whole row; anyone may still watch.
 */
export const RoasterPicker = ({
	onStarted,
	run,
}: {
	onStarted: (runId: Id<"pipelineRuns">) => void;
	run: Run | null;
}) => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const roasters = useQuery(
		api.roasters.listActive,
		isAuthenticated ? {} : "skip"
	);
	const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
	const start = useMutation(api.nerdStuff.start);
	const stop = useMutation(api.nerdStuff.stop);
	const [roasterId, setRoasterId] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	if (isLoading) {
		return null;
	}
	if (!isAuthenticated) {
		return (
			<div className="flex flex-col gap-2">
				<SignInCta />
				<span className="text-muted-foreground text-xs">
					Sign in to start a run. Watching needs no account.
				</span>
			</div>
		);
	}

	const going =
		run !== null && (run.status === "running" || run.status === "queued");
	const mine = going && me !== undefined && me !== null && run.userId === me.id;

	// The option values are the ids listActive returned, so the pick is
	// looked up there rather than cast.
	const picked = roasters?.find((roaster) => roaster.id === roasterId);

	const onStart = async () => {
		if (picked === undefined) {
			setFailure("Pick a roaster.");
			return;
		}
		setBusy(true);
		setFailure(null);
		try {
			const id = await start({ roasterId: picked.id });
			onStarted(id);
		} catch (error) {
			setFailure(describeMutationError(error, "Could not start the run."));
		}
		setBusy(false);
	};

	const onStop = async () => {
		if (run === null) {
			return;
		}
		setBusy(true);
		try {
			await stop({ runId: run._id });
		} catch (error) {
			setFailure(describeMutationError(error, "Could not stop the run."));
		}
		setBusy(false);
	};

	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
			<select
				aria-label="Roaster"
				className={selectClass}
				onChange={(event) => {
					setRoasterId(event.target.value);
				}}
				value={roasterId}
			>
				<option value="">Pick a roaster</option>
				{roasters?.map((roaster) => (
					<option key={roaster.id} value={roaster.id}>
						{roaster.name}
					</option>
				))}
			</select>
			<button
				className={`${navLinkClass} disabled:text-muted-foreground disabled:no-underline`}
				disabled={busy}
				onClick={onStart}
				title={going ? "Stops the run going and starts this one." : undefined}
				type="button"
			>
				Start
			</button>
			{mine && (
				<button
					className={`${navLinkClass} disabled:text-muted-foreground disabled:no-underline`}
					disabled={busy}
					onClick={onStop}
					type="button"
				>
					Stop
				</button>
			)}
			{failure !== null && (
				<span className="text-muted-foreground w-full text-xs" role="alert">
					{failure}
				</span>
			)}
		</div>
	);
};
