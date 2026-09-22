import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { Id } from "@nouveau/backend/convex/_generated/dataModel";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";

import { DotToggle } from "@/components/dot-toggle";
import Loader from "@/components/loader";
import { SignInCta } from "@/components/sign-in-cta";

const SignedOutAlertSettings = () => (
	<div className="mt-10">
		<p className="text-muted-foreground max-w-prose text-sm">
			Sign in to see where your alerts are delivered and which roasters are
			muted.
		</p>
		<div className="mt-6">
			<SignInCta />
		</div>
	</div>
);

/**
 * The alerts tab: where alerts go and which watches are muted. The title
 * and tabs come from the /settings layout; the sections are caps-labeled
 * like every inner page, and Mute is the same DotToggle the profile's
 * watch rows use.
 */
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
		<div className="mt-10 max-w-xl">
			<section>
				<h2 className="label-caps text-foreground">Alert inbox</h2>
				{me?.alertInboxAddress === undefined ? (
					<p className="text-muted-foreground mt-3 max-w-prose text-sm md:text-[15px]">
						Alerts are still being set up. They fire only once the alert inbox
						exists; nothing is held in the meantime.
					</p>
				) : (
					<p className="text-muted-foreground mt-3 max-w-prose text-sm md:text-[15px]">
						Alerts are delivered from the Nouveau alert inbox{" "}
						<span className="text-foreground font-mono">
							{me.alertInboxAddress}
						</span>{" "}
						to your sign-in email.
					</p>
				)}
			</section>
			<section className="mt-10">
				<h2 className="label-caps text-foreground">Watches</h2>
				{watches.length === 0 ? (
					<p className="text-muted-foreground mt-3 max-w-prose text-sm md:text-[15px]">
						You&apos;re not watching any roasters yet.{" "}
						<Link className="text-foreground underline" to="/roasters">
							Browse the roasters
						</Link>{" "}
						to start.
					</p>
				) : (
					<ul className="mt-3">
						{watches.map((watch) => (
							<li
								className="flex items-center justify-between gap-x-4 border-b py-2 last:border-b-0"
								key={watch.roaster.id}
							>
								<Link
									className="text-sm hover:underline md:text-[15px]"
									params={{ roaster: watch.roaster.slug }}
									to="/roaster/$roaster"
								>
									{watch.roaster.name}
								</Link>
								<DotToggle
									onClick={() => {
										void toggleMute(watch.muted, watch.roaster.id);
									}}
									pressed={watch.muted}
								>
									{watch.muted ? "Muted" : "Mute"}
								</DotToggle>
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
