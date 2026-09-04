import { api } from "@nouveau/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import Loader from "@/components/loader";
import { LogCard } from "@/components/log-card";

/** The global activity feed (build spec §14.3): recent logs, newest first. */
export const ActivityFeed = () => {
	const feed = useQuery(api.logs.recentLogs, {});
	if (feed === undefined) {
		return <Loader />;
	}
	if (feed.length === 0) {
		return (
			<p className="text-muted-foreground py-8 text-sm">
				No logs yet. Be the first to write one down.
			</p>
		);
	}
	return (
		<div className="divide-y">
			{feed.map((log) => (
				<LogCard key={log.logId} log={log} />
			))}
		</div>
	);
};
