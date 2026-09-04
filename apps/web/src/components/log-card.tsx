import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { Button } from "@nouveau/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { LogForm } from "@/components/log-form";
import { Stars } from "@/components/stars";
import { relativeTime } from "@/lib/format";

/** One hydrated log, as returned by recentLogs and profile (spec §14). */
export interface LogCardData {
	loggedAt: number;
	logId: Id<"logs">;
	lot: { handle: string; id: Id<"products">; name: string };
	notes: string | null;
	rating: number | null;
	roaster: { name: string; slug: string };
	user: {
		id: Id<"users">;
		imageUrl?: string;
		name?: string;
	};
}

/**
 * One log row. The activity feed shows the taster (showUser); the profile
 * already belongs to them, so it passes showUser={false} and may pass isMine
 * to get inline edit and delete.
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
	const remove = useMutation(api.logs.deleteLog);

	const deleteLog = async () => {
		try {
			await remove({ logId: log.logId });
			toast.success("Log deleted.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Something went wrong."
			);
		}
	};

	return (
		<article className="flex flex-col gap-1 border-b px-1 py-4 last:border-b-0">
			<div className="flex items-baseline justify-between gap-x-3">
				<div className="flex min-w-0 flex-wrap items-center gap-x-2">
					{showUser && (
						<Link
							className="truncate font-medium hover:underline"
							params={{ userId: log.user.id }}
							to="/profile/$userId"
						>
							{log.user.name ?? "A taster"}
						</Link>
					)}
					<span className="text-muted-foreground text-sm">tried</span>
					<Link
						className="truncate font-medium hover:underline"
						params={{ slug: log.roaster.slug }}
						to="/roasters/$slug"
					>
						{log.lot.name}
					</Link>
					<span className="text-muted-foreground truncate text-sm">
						from {log.roaster.name}
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
				/>
			)}
		</article>
	);
};
