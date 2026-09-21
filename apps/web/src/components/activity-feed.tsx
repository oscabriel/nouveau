import { api } from "@nouveau/backend/convex/_generated/api";
import { useQuery } from "convex/react";

import Loader from "@/components/loader";
import { LogCard } from "@/components/log-card";
import { PageTitle } from "@/components/page-title";

/**
 * The global activity feed (build spec §14.3): recent logs, newest first,
 * under the Activity title with the count. Public. The viewer's own rows
 * get EDIT and DELETE instead of the Save toggle, as on the lot page.
 */
export const ActivityFeed = () => {
	const feed = useQuery(api.logs.recentLogs, {});
	const me = useQuery(api.users.getCurrentUser);
	return (
		<>
			<PageTitle
				count={
					feed === undefined || feed.length === 0 ? undefined : feed.length
				}
				title="Activity"
			/>
			<p className="text-muted-foreground mt-4 max-w-prose text-sm md:text-[15px]">
				What people are tasting, every lot logged across Nouveau, newest first.
			</p>
			<div className="mt-12 md:mt-16">
				{feed === undefined && <Loader />}
				{feed !== undefined && feed.length === 0 && (
					<p className="text-muted-foreground max-w-prose text-sm">
						No logs yet. Open a lot you have tried and log it.
					</p>
				)}
				{feed !== undefined && feed.length > 0 && (
					<div>
						{feed.map((log) => (
							<LogCard
								isMine={log.user.id === me?.id}
								key={log.logId}
								log={log}
							/>
						))}
					</div>
				)}
			</div>
		</>
	);
};
