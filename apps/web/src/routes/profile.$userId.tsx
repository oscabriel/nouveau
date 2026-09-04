import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import Loader from "@/components/loader";
import { LogCard } from "@/components/log-card";
import type { LogCardData } from "@/components/log-card";

const ProfileComponent = () => {
	const { userId } = useParams({ from: "/profile/$userId" });
	const profile = useQuery(api.logs.profile, {
		userId: userId as Id<"users">,
	});
	const me = useQuery(api.users.getCurrentUser);

	if (profile === undefined || me === undefined) {
		return <Loader />;
	}
	if (profile === null) {
		return (
			<div className="container mx-auto max-w-3xl px-4 py-8">
				<p className="text-muted-foreground py-8 text-sm">
					No taster at this address.{" "}
					<Link className="underline" to="/activity">
						Back to recent logs
					</Link>
					.
				</p>
			</div>
		);
	}

	const isMine = me !== null && me.id === profile.user.id;

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex items-center gap-3">
				{profile.user.imageUrl !== undefined && (
					<img
						alt=""
						className="size-10 rounded-full"
						src={profile.user.imageUrl}
					/>
				)}
				<div>
					<h1 className="text-2xl font-semibold">
						{profile.user.name ?? "A taster"}
					</h1>
					<p className="text-muted-foreground text-sm">
						{profile.logs.length} {profile.logs.length === 1 ? "log" : "logs"} ·{" "}
						{profile.roasters.length}{" "}
						{profile.roasters.length === 1 ? "roaster" : "roasters"} watched
					</p>
				</div>
			</header>

			{profile.roasters.length > 0 && (
				<section className="mb-6">
					<h2 className="mb-2 font-semibold">Watching</h2>
					<div className="flex flex-wrap gap-2">
						{profile.roasters.map((roaster) => (
							<span
								className="rounded-full border px-3 py-1 text-sm"
								key={roaster.id}
							>
								<Link
									className="hover:underline"
									params={{ slug: roaster.slug }}
									to="/roasters/$slug"
								>
									{roaster.name}
								</Link>
							</span>
						))}
					</div>
				</section>
			)}

			<section>
				<h2 className="mb-2 font-semibold">Logs</h2>
				{profile.logs.length === 0 ? (
					<p className="text-muted-foreground py-8 text-sm">
						{isMine
							? "No logs yet. Find a lot you have tried on a roaster page and log it."
							: "No logs yet."}
					</p>
				) : (
					<div className="divide-y">
						{profile.logs.map((log) => (
							<LogCard
								isMine={isMine}
								key={log.logId}
								log={log as LogCardData}
								showUser={false}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	);
};

export const Route = createFileRoute("/profile/$userId")({
	component: ProfileComponent,
});
