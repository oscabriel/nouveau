import { api } from "@nouveau/backend/convex/_generated/api";
import {
	createFileRoute,
	Link,
	useNavigate,
	getRouteApi,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect } from "react";
import { toast } from "sonner";

import { LogCard } from "@/components/log-card";
import { MuteToggle } from "@/components/mute-toggle";
import { NextBagLink } from "@/components/next-bag-sheet";
import {
	MissingPage,
	Page,
	PageLoader,
	PageTitle,
	SectionHeading,
} from "@/components/page";
import { SavedCoffeeCard } from "@/components/saved-coffee-card";
import { StatusChip } from "@/components/status-chip";
import { describeMutationError } from "@/lib/errors";
import { plural } from "@/lib/format";
import { ledeClass, quietLinkClass } from "@/lib/ui";
import { useDocumentTitle } from "@/lib/use-document-title";

const route = getRouteApi("/$user");

type Watch = FunctionReturnType<typeof api.watches.listMyWatches>[number];
type ProfileOwner = Extract<
	NonNullable<FunctionReturnType<typeof api.logs.profile>>,
	{ kind: "owner" }
>;

/**
 * One watch row: the roaster's name, its crawl health, and the two toggles
 * the owner manages it with — mute and unwatch (ADR-0016).
 */
const WatchRow = ({ watch }: { watch: Watch }) => {
	const unwatch = useMutation(api.watches.unwatchRoaster);
	const stop = async () => {
		try {
			await unwatch({ roasterId: watch.roaster.id });
			toast.success(`Stopped watching ${watch.roaster.name}.`);
		} catch (error) {
			toast.error(describeMutationError(error, "Could not stop watching."));
		}
	};
	return (
		<article className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-4 last:border-b-0">
			<Link
				className="font-medium hover:underline"
				params={{ roaster: watch.roaster.slug }}
				to="/roaster/$roaster"
			>
				{watch.roaster.name}
			</Link>
			<StatusChip compact status={watch.status} />
			<div className="ml-auto flex items-center gap-x-5">
				<MuteToggle muted={watch.muted} roasterId={watch.roaster.id} />
				<button
					className={quietLinkClass}
					onClick={() => {
						void stop();
					}}
					type="button"
				>
					Unwatch
				</button>
			</div>
		</article>
	);
};

/**
 * The owner-only parts of the profile (ADR-0016): the grey attention
 * sentence, the watches with health and mute, and the try list. Never
 * renders for another viewer.
 */
const OwnerRecord = ({
	saved,
	watches,
}: {
	saved: ProfileOwner["saved"];
	watches: ProfileOwner["watches"];
}) => {
	const unhealthy = watches.filter(
		(watch) => watch.status.health !== "watching"
	);
	return (
		<>
			{unhealthy.length > 0 && (
				<p className="text-muted-foreground mt-6 max-w-prose text-sm">
					{unhealthy.length === 1
						? `${unhealthy[0]?.roaster.name ?? "One roaster"} needs attention.`
						: `${unhealthy.length} of your roasters need attention.`}{" "}
					See{" "}
					<Link className="underline" to="/settings/alerts">
						alert settings
					</Link>
					.
				</p>
			)}

			<section aria-labelledby="watching-heading" className="mt-16 md:mt-24">
				<SectionHeading count={watches.length} id="watching-heading">
					Watching
				</SectionHeading>
				{watches.length === 0 ? (
					<p className="text-muted-foreground mt-4 max-w-prose text-sm">
						No roasters watched yet.{" "}
						<Link className="underline" to="/roasters">
							Find one in the directory
						</Link>
						.
					</p>
				) : (
					<div className="mt-6">
						{watches.map((watch) => (
							<WatchRow key={watch.roaster.id} watch={watch} />
						))}
					</div>
				)}
			</section>

			<section aria-labelledby="try-heading" className="mt-16 md:mt-24">
				<SectionHeading count={saved.length} id="try-heading">
					Try list
				</SectionHeading>
				{saved.length === 0 ? (
					<p className="text-muted-foreground mt-4 max-w-prose text-sm">
						Nothing saved. A lot you are curious about but have not tried yet
						can wait here;{" "}
						<Link className="underline" to="/roasters">
							find one
						</Link>
						.
					</p>
				) : (
					<div className="mt-6">
						{saved.map((item) => (
							<SavedCoffeeCard item={item} key={item.savedId} />
						))}
					</div>
				)}
			</section>
		</>
	);
};

/** The profile's log list: the same rows for any viewer, editable when mine. */
const LogsSection = ({
	isMine,
	logs,
	truncated,
}: {
	isMine: boolean;
	logs: ProfileOwner["logs"];
	truncated: boolean;
}) => (
	<section aria-labelledby="logs-heading" className="mt-16 md:mt-24">
		<SectionHeading id="logs-heading">
			{truncated ? "Recent logs" : "Logs"}
		</SectionHeading>
		{logs.length === 0 ? (
			<p className="text-muted-foreground mt-4 max-w-prose text-sm">
				{isMine
					? "No logs yet. Open a lot you have tried and log it."
					: "No logs yet."}
			</p>
		) : (
			<div className="mt-6">
				{logs.map((log) => (
					<LogCard isMine={isMine} key={log.logId} log={log} showUser={false} />
				))}
			</div>
		)}
	</section>
);

const ProfileComponent = () => {
	const { user: address } = route.useParams();
	// The address is whatever the URL holds; the query resolves handles,
	// retired handles and legacy user ids alike (ADR-0011).
	const profile = useQuery(api.logs.profile, { address });
	const navigate = useNavigate();
	useDocumentTitle(profile?.user.name ?? (profile ? "A taster" : undefined));

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

	if (profile === undefined) {
		return <PageLoader />;
	}
	if (profile === null) {
		return (
			<MissingPage linkLabel="Back to recent logs" to="/activity">
				No taster at this address.
			</MissingPage>
		);
	}

	const isMine = profile.kind === "owner";
	const { user, logs, logsTruncated } = profile;

	return (
		<Page>
			{/* No count beside the name: the page shows one person, and the
			    grey line under it already says how many logs. */}
			<PageTitle title={user.name ?? "A taster"}>
				{isMine && <NextBagLink />}
			</PageTitle>
			<p className={ledeClass}>
				{user.handle !== undefined && `@${user.handle} · `}
				{logsTruncated
					? `${logs.length}+ recent logs`
					: plural(logs.length, "log")}
				{isMine && ` · ${plural(profile.watches.length, "roaster")} watched`}
			</p>

			{profile.kind === "owner" && (
				<OwnerRecord saved={profile.saved} watches={profile.watches} />
			)}

			<LogsSection isMine={isMine} logs={logs} truncated={logsTruncated} />
		</Page>
	);
};

export const Route = createFileRoute("/$user")({
	component: ProfileComponent,
	head: () => ({ meta: [{ title: "Taster | Nouveau" }] }),
});
