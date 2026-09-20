import { api } from "@nouveau/backend/convex/_generated/api";
import {
	createFileRoute,
	Link,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import Loader from "@/components/loader";
import { LogCard } from "@/components/log-card";

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

const ProfileComponent = () => {
	const { user: address } = useParams({ from: "/$user" });
	// The address is whatever the URL holds; the query resolves handles,
	// retired handles and legacy user ids alike (ADR-0011).
	const profile = useQuery(api.logs.profile, { userId: address });
	const me = useQuery(api.users.getCurrentUser);
	const navigate = useNavigate();

	// Adopt the canonical address: a legacy id or a retired handle resolves
	// here, then the URL moves to the user's current handle. Absent on rows
	// predating the handle field.
	const canonical =
		profile === undefined || profile === null ? undefined : profile.user.handle;
	useEffect(() => {
		if (canonical === undefined || canonical === address) {
			return;
		}
		void navigate({
			params: { user: canonical },
			replace: true,
			to: "/$user",
		});
	}, [address, canonical, navigate]);

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
						{profile.logsTruncated
							? `${profile.logs.length}+ logs`
							: plural(profile.logs.length, "log")}
						{profile.kind === "owner" &&
							` · ${plural(profile.watches.length, "roaster")} watched`}
					</p>
				</div>
			</header>

			{profile.kind === "owner" && profile.watches.length > 0 && (
				<section className="mb-6">
					<h2 className="mb-2 font-semibold">Watching</h2>
					<div className="flex flex-wrap gap-2">
						{profile.watches.map((watch) => (
							<span
								className="rounded-full border px-3 py-1 text-sm"
								key={watch.roaster.id}
							>
								<Link
									className="hover:underline"
									params={{ roaster: watch.roaster.slug }}
									to="/roaster/$roaster"
								>
									{watch.roaster.name}
								</Link>
							</span>
						))}
					</div>
				</section>
			)}

			<section>
				<h2 className="mb-2 font-semibold">
					{profile.logsTruncated ? "Recent logs" : "Logs"}
				</h2>
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
								log={log}
								showUser={false}
							/>
						))}
					</div>
				)}
			</section>
		</div>
	);
};

export const Route = createFileRoute("/$user")({
	component: ProfileComponent,
});
