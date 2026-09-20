import { api } from "@nouveau/backend/convex/_generated/api";
import { Button } from "@nouveau/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LogForm } from "@/components/log-form";
import { SaveButton } from "@/components/save-button";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/lib/format";

/** One hydrated log, exactly as recentLogs and profile return it (spec §14). */
export type LogCardData = FunctionReturnType<
	typeof api.logs.recentLogs
>[number];

/**
 * One log row. The activity feed shows the taster (showUser); the profile
 * already belongs to them, so it passes showUser={false} and may pass isMine
 * to get inline edit and delete. Someone else's log offers Save on its lot
 * instead: a log you read is the main way a lot gets onto "Want to try".
 */
export const LogCard = ({
	log,
	isMine = false,
	showUser = true,
}: {
	log: LogCardData;
	isMine?: boolean;
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
		<article className="flex flex-col gap-1 border-b px-1 py-4 last:border-b-0">
			<div className="flex items-baseline justify-between gap-x-3">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2">
					{showUser && (
						<Link
							className="truncate font-medium hover:underline"
							params={{ user: log.user.handle ?? log.user.id }}
							to="/$user"
						>
							{log.user.name ?? "A taster"}
						</Link>
					)}
					<span className="text-muted-foreground text-sm">tried</span>
					<Link
						className="truncate font-medium hover:underline"
						params={{ lot: log.lot.handle, roaster: log.roaster.slug }}
						to="/roaster/$roaster/$lot"
					>
						{log.lot.name}
					</Link>
					<span className="text-muted-foreground truncate text-sm">
						from{" "}
						<Link
							className="hover:underline"
							params={{ roaster: log.roaster.slug }}
							to="/roaster/$roaster"
						>
							{log.roaster.name}
						</Link>
					</span>
				</div>
				<time
					className="text-muted-foreground shrink-0 text-xs tabular-nums"
					dateTime={new Date(log.loggedAt).toISOString()}
				>
					{relativeTime(log.loggedAt)}
				</time>
			</div>
			{log.rating !== null && <Stars rating={log.rating} />}
			{log.notes !== null && <p className="text-sm">{log.notes}</p>}
			{log.lot.roasterNotes !== null && !editing && (
				<p className="text-muted-foreground text-xs italic">
					<span className="font-medium not-italic">Roaster notes:</span>{" "}
					{log.lot.roasterNotes}
				</p>
			)}
			{!isMine && (
				<SaveButton className="mt-1 self-start" lotId={log.lot.id} size="sm" />
			)}
			{isMine && (
				<div className="flex gap-1">
					<Button
						aria-label="Edit log"
						onClick={() => {
							setEditing((value) => !value);
						}}
						size="sm"
						variant="ghost"
					>
						<Pencil aria-hidden className="size-3.5" />
						{editing ? "Close" : "Edit"}
					</Button>
					<Button
						aria-label="Delete log"
						disabled={deleting}
						onClick={() => {
							deleteLog();
						}}
						size="sm"
						variant="ghost"
					>
						<Trash2 aria-hidden className="size-3.5" />
						Delete
					</Button>
				</div>
			)}
			{editing && (
				<LogForm
					existing={{
						logId: log.logId,
						notes: log.notes,
						rating: log.rating,
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
