import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";

import Loader from "@/components/loader";
import { SignInCta } from "@/components/sign-in-cta";

const SignedOutAlertSettings = () => (
	<div className="container mx-auto max-w-3xl px-4 py-8">
		<h1 className="mb-2 text-2xl font-semibold">Alert settings</h1>
		<p className="text-muted-foreground mb-4 max-w-prose text-sm">
			Sign in to see where your alerts are delivered and which roasters are
			muted.
		</p>
		<SignInCta />
	</div>
);

const AlertSettingsComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
	const watches = useQuery(
		api.watches.listMyWatches,
		isAuthenticated ? {} : "skip"
	);
	const setMuted = useMutation(api.watches.setWatchMuted);

	const toggleMute = async (muted: boolean, roasterId: Id<"roasters">) => {
		try {
			await setMuted({ muted: !muted, roasterId });
		} catch {
			// The query refreshes; a failed toggle keeps state.
		}
	};

	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return <SignedOutAlertSettings />;
	}
	if (me === undefined || watches === undefined) {
		return <Loader />;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex items-baseline justify-between gap-4">
				<h1 className="text-2xl font-semibold">Alert settings</h1>
				<Link className="text-sm hover:underline" to="/watches">
					Your watches
				</Link>
			</header>
			<section className="mb-8">
				<h2 className="mb-2 text-lg font-medium">Alert inbox</h2>
				{me?.alertInboxAddress === undefined ? (
					<p className="text-muted-foreground max-w-prose text-sm">
						Your alert inbox is being set up. Alerts fire only after it exists;
						nothing is held in the meantime.
					</p>
				) : (
					<p className="max-w-prose text-sm">
						Alerts are delivered from your alert inbox:{" "}
						<span className="font-mono">{me.alertInboxAddress}</span>
					</p>
				)}
			</section>
			<section>
				<h2 className="mb-2 text-lg font-medium">Watches</h2>
				{watches.length === 0 ? (
					<p className="text-muted-foreground max-w-prose text-sm">
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
								className="flex items-center justify-between gap-x-4 px-1 py-3"
								key={watch.roaster.id}
							>
								<Link
									className="text-sm hover:underline"
									params={{ slug: watch.roaster.slug }}
									to="/roasters/$slug"
								>
									{watch.roaster.name}
								</Link>
								<div className="flex items-center gap-2">
									{watch.muted && (
										<span className="text-muted-foreground text-xs">muted</span>
									)}
									<button
										className="hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors"
										onClick={() => {
											toggleMute(watch.muted, watch.roaster.id);
										}}
										type="button"
									>
										{watch.muted ? "Unmute" : "Mute"}
									</button>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
};

export const Route = createFileRoute("/settings/alerts")({
	component: AlertSettingsComponent,
});
