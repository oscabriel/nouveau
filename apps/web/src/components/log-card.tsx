import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";

import { LogSheet } from "@/components/log-form";
import { SaveButton } from "@/components/save-button";
import { Stars } from "@/components/stars";
import { TastingPill } from "@/components/tasting-pill";
import { describeMutationError } from "@/lib/errors";
import { relativeTime } from "@/lib/format";
import { navLinkClass, quietLinkClass } from "@/lib/ui";

/** One hydrated log, exactly as recentLogs and profile return it (spec §14). */
export type LogCardData = FunctionReturnType<
	typeof api.logs.recentLogs
>[number];

/**
 * The taster's notes and the roaster's descriptors, both as colored pills
 * (ADR-0016; the roaster's row joined the pills 2026-09-21 so every lot
 * note on the site reads the same way). Nothing renders when the log has
 * neither.
 */
const LogNotes = ({
	roasterTags,
	tastingNotes,
}: {
	roasterTags: LogCardData["lot"]["roasterTags"];
	tastingNotes: LogCardData["tastingNotes"];
}) => {
	if (tastingNotes === null && roasterTags.length === 0) {
		return null;
	}
	return (
		<dl className="text-muted-foreground grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
			{tastingNotes !== null && (
				<>
					<dt className="label-caps text-foreground pt-0.5">Tasting notes</dt>
					<dd className="flex flex-wrap gap-1.5">
						{tastingNotes.map(({ family, note }) => (
							<TastingPill family={family} key={note} link>
								{note}
							</TastingPill>
						))}
					</dd>
				</>
			)}
			{roasterTags.length > 0 && (
				<>
					<dt className="label-caps text-foreground pt-0.5">Roaster notes</dt>
					<dd className="flex flex-wrap gap-1.5">
						{roasterTags.map(({ family, note }) => (
							<TastingPill family={family} key={note} link>
								{note}
							</TastingPill>
						))}
					</dd>
				</>
			)}
		</dl>
	);
};

/**
 * One log row under a hairline: who tried what from whom and when on one
 * line, the stars, the review, then the taster's notes as colored pills
 * beside the roaster's descriptors in plain text. The activity feed shows the taster (showUser); the profile
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
			toast.error(describeMutationError(error, "Could not delete the log."));
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
			<LogNotes
				roasterTags={log.lot.roasterTags}
				tastingNotes={log.tastingNotes}
			/>
			{!isMine && <SaveButton className="self-start" lotId={log.lot.id} />}
			{isMine && (
				<div className="flex items-center gap-5">
					<button
						className={navLinkClass}
						onClick={() => {
							setEditing(true);
						}}
						type="button"
					>
						Edit
					</button>
					<button
						className={quietLinkClass}
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
			{isMine && (
				<LogSheet
					existing={{
						logId: log.logId,
						notes: log.notes,
						rating: log.rating,
						tastingNotes:
							log.tastingNotes === null
								? null
								: log.tastingNotes.map(({ note }) => note),
					}}
					lotId={log.lot.id}
					lotName={log.lot.name}
					onOpenChange={setEditing}
					open={editing}
					roasterNotes={log.lot.roasterNotes}
				/>
			)}
		</article>
	);
};
