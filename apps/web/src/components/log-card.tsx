import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";

import { LogForm } from "@/components/log-form";
import { SaveButton } from "@/components/save-button";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/lib/format";
import { navLinkClass } from "@/lib/ui";

/** One hydrated log, exactly as recentLogs and profile return it (spec §14). */
export type LogCardData = FunctionReturnType<
	typeof api.logs.recentLogs
>[number];

/**
 * One log row under a hairline: who tried what from whom and when on one
 * line, the stars, the review, then the taster's picks beside the roaster's
 * descriptors. The activity feed shows the taster (showUser); the profile
 * already belongs to them, so it passes showUser={false}; the lot page
 * already names the lot, so it passes showLot={false}. Both false is never
 * mounted (the line would be empty). Every mount passes isMine for the
 * viewer's own rows, which get EDIT and DELETE as caps actions. Someone
 * else's log offers the Save toggle on its lot instead: a log you read is
 * the main way a lot gets onto the try list.
 */
export const LogCard = ({
	log,
	isMine = false,
	showLot = true,
	showUser = true,
}: {
	log: LogCardData;
	isMine?: boolean;
	/** The lot page already names the lot; it passes false. */
	showLot?: boolean;
	showUser?: boolean;
}) => {
	const [editing, setEditing] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const remove = useMutation(api.logs.deleteLog);

	const deleteLog = async () => {
		setDeleting(true);
		try {
			await remove({ logId: log.logId });
			toast.success("Log deleted.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Something went wrong."
			);
			setDeleting(false);
		}
	};

	return (
		<article className="flex flex-col gap-2 border-b py-5">
			<div className="flex items-baseline justify-between gap-x-6">
				<p className="min-w-0 text-sm leading-snug md:text-[15px]">
					{showUser && (
						<>
							<Link
								className="text-foreground hover:underline"
								params={{ user: log.user.handle ?? log.user.id }}
								to="/$user"
							>
								{log.user.name ?? "A taster"}
							</Link>
							{showLot && (
								<span className="text-muted-foreground"> tried </span>
							)}
						</>
					)}
					{showLot && (
						<>
							<Link
								className="text-foreground font-semibold hover:underline"
								params={{ lot: log.lot.handle, roaster: log.roaster.slug }}
								to="/roaster/$roaster/$lot"
							>
								{log.lot.name}
							</Link>
							<span className="text-muted-foreground">
								{" from "}
								<Link
									className="hover:underline"
									params={{ roaster: log.roaster.slug }}
									to="/roaster/$roaster"
								>
									{log.roaster.name}
								</Link>
							</span>
						</>
					)}
				</p>
				<time
					className="text-muted-foreground tnum shrink-0 text-xs"
					dateTime={new Date(log.loggedAt).toISOString()}
				>
					{relativeTime(log.loggedAt)}
				</time>
			</div>
			{log.rating !== null && <Stars rating={log.rating} />}
			{log.notes !== null && (
				<p className="max-w-prose text-sm leading-snug md:text-[15px]">
					{log.notes}
				</p>
			)}
			{!editing &&
				(log.tastingNotes !== null || log.lot.roasterNotes !== null) && (
					<dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
						{log.tastingNotes !== null && (
							<>
								<dt className="label-caps text-foreground pt-0.5">
									Tasting notes
								</dt>
								<dd>{log.tastingNotes.join(" · ")}</dd>
							</>
						)}
						{log.lot.roasterNotes !== null && (
							<>
								<dt className="label-caps text-foreground pt-0.5">
									Roaster notes
								</dt>
								<dd>{log.lot.roasterNotes}</dd>
							</>
						)}
					</dl>
				)}
			{!isMine && <SaveButton className="self-start" lotId={log.lot.id} />}
			{isMine && (
				<div className="flex items-center gap-5">
					<button
						aria-expanded={editing}
						className={navLinkClass}
						onClick={() => {
							setEditing((value) => !value);
						}}
						type="button"
					>
						{editing ? "Close" : "Edit"}
					</button>
					<button
						className={`${navLinkClass} text-muted-foreground hover:text-foreground disabled:no-underline`}
						disabled={deleting}
						onClick={() => {
							void deleteLog();
						}}
						type="button"
					>
						Delete
					</button>
				</div>
			)}
			{editing && (
				<LogForm
					existing={{
						logId: log.logId,
						notes: log.notes,
						rating: log.rating,
						tastingNotes: log.tastingNotes,
					}}
					lotId={log.lot.id}
					onDone={() => {
						setEditing(false);
					}}
					roasterNotes={log.lot.roasterNotes}
				/>
			)}
		</article>
	);
};
