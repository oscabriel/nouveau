import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import type { CrawlStatus } from "@nouveau/backend/convex/health";
import { useMutation } from "convex/react";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { relativeTime } from "@/lib/format";

type Note =
	| { kind: "checked" }
	| { kind: "limited"; until: number }
	| { kind: "failed" };

const countdown = (ms: number): string => {
	const total = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(total / 60);
	const seconds = total % 60;
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const noteLine = (
	note: Note,
	status: CrawlStatus,
	now: number
): string | null => {
	if (status.checking) {
		return null;
	}
	switch (note.kind) {
		case "checked": {
			// Read live so a later crawl (ours or the scheduler's) ages it.
			return status.lastSuccessAt === null
				? null
				: `Checked ${relativeTime(status.lastSuccessAt)}`;
		}
		case "limited": {
			return note.until > now
				? `Try again in ${countdown(note.until - now)}`
				: null;
		}
		case "failed": {
			return "Couldn't start a check";
		}
		default: {
			return note satisfies never;
		}
	}
};

/**
 * Check now (#34): ask the crawler to look at this roaster's shop outside its
 * cadence. The chip beside it flips to "Checking now" for every open page
 * the moment a crawl starts, since crawl status is a live subscription; this
 * button only carries the answers the chip cannot: fresh, limited, failed.
 * Signed-in only; the parent decides that.
 */
export const CheckNowButton = ({
	roasterId,
	status,
}: {
	roasterId: Id<"roasters">;
	status: CrawlStatus;
}) => {
	const requestCheck = useMutation(api.checkNow.requestCheck);
	const [busy, setBusy] = useState(false);
	const [note, setNote] = useState<Note | null>(null);
	const [now, setNow] = useState(Date.now);

	// A limited note counts down by the second; a checked note ages by the
	// minute. One timer at the faster rate covers both while a note shows.
	useEffect(() => {
		if (note === null) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [note]);

	const check = async () => {
		setBusy(true);
		try {
			const result = await requestCheck({ roasterId });
			switch (result.status) {
				case "fresh": {
					setNote({ kind: "checked" });
					break;
				}
				case "limited": {
					setNote({ kind: "limited", until: Date.now() + result.retryAfter });
					break;
				}
				default: {
					setNote(null);
				}
			}
		} catch {
			setNote({ kind: "failed" });
		}
		setBusy(false);
		setNow(Date.now());
	};

	const line = note === null ? null : noteLine(note, status, now);
	const disabled = busy || status.checking;
	return (
		<span className="inline-flex items-center gap-2">
			<button
				className="hover:bg-accent inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors disabled:cursor-default disabled:opacity-50"
				disabled={disabled}
				onClick={check}
				type="button"
			>
				<RefreshCw
					aria-hidden
					className={`size-3 ${status.checking ? "motion-safe:animate-spin" : ""}`}
				/>
				{status.checking ? "Checking" : "Check now"}
			</button>
			{line !== null && (
				<span
					aria-live="polite"
					className="text-muted-foreground text-xs tabular-nums"
				>
					{line}
				</span>
			)}
		</span>
	);
};
