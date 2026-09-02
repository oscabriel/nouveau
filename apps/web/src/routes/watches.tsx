import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";

import Loader from "@/components/loader";
import { SignInCta } from "@/components/sign-in-cta";
import { StatusChip } from "@/components/status-chip";

const SignedOutWatches = () => (
	<div className="container mx-auto max-w-3xl px-4 py-8">
		<h1 className="mb-2 text-2xl font-semibold">Your watches</h1>
		<p className="text-muted-foreground mb-4 max-w-prose text-sm">
			Sign in to watch roasters. Each watch shows whether the shop is being
			checked, and mutes or unwatches from here.
		</p>
		<SignInCta />
	</div>
);

const WatchesComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const watches = useQuery(
		api.watches.listMyWatches,
		isAuthenticated ? {} : "skip"
	);
	const setMuted = useMutation(api.watches.setWatchMuted);
	const unwatch = useMutation(api.watches.unwatchRoaster);

	const toggleMute = async (muted: boolean, roasterId: Id<"roasters">) => {
		try {
			await setMuted({ muted: !muted, roasterId });
		} catch {
			// The query refreshes; a failed toggle keeps state.
		}
	};
	const removeWatch = async (roasterId: Id<"roasters">) => {
		try {
			await unwatch({ roasterId });
		} catch {
			// The query refreshes; a failed remove keeps state.
		}
	};

	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return <SignedOutWatches />;
	}
	if (watches === undefined) {
		return <Loader />;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex items-baseline justify-between gap-4">
				<h1 className="text-2xl font-semibold">Your watches</h1>
				<Link className="text-sm hover:underline" to="/roasters">
					Find roasters
				</Link>
			</header>
			{watches.length === 0 ? (
				<p className="text-muted-foreground py-8 text-sm">
					You&apos;re not watching any roasters yet.{" "}
					<Link className="underline" to="/roasters">
						Browse the roasters
					</Link>{" "}
					to start.
				</p>
			) : (
				<ul className="divide-y">
					{watches.map((watch) => (
						<li
							className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1 py-4"
							key={watch.roaster.id}
						>
							<div className="min-w-0">
								<div className="flex items-baseline gap-3">
									<Link
										className="font-medium hover:underline"
										params={{ slug: watch.roaster.slug }}
										to="/roasters/$slug"
									>
										{watch.roaster.name}
									</Link>
									{watch.muted && (
										<span className="text-muted-foreground text-xs">muted</span>
									)}
								</div>
								<div className="mt-1">
									<StatusChip status={watch.status} />
								</div>
							</div>
							<div className="flex items-center gap-2">
								<button
									className="hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors"
									onClick={() => {
										toggleMute(watch.muted, watch.roaster.id);
									}}
									type="button"
								>
									{watch.muted ? "Unmute" : "Mute"}
								</button>
								<button
									className="hover:bg-accent rounded-md border px-3 py-1.5 text-sm text-red-600 transition-colors dark:text-red-400"
									onClick={() => {
										removeWatch(watch.roaster.id);
									}}
									type="button"
								>
									Unwatch
								</button>
							</div>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};

export const Route = createFileRoute("/watches")({
	component: WatchesComponent,
});
