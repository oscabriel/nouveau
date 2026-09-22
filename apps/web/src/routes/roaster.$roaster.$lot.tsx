import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link, getRouteApi } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { LogCard } from "@/components/log-card";
import { LogSheet } from "@/components/log-form";
import {
	MissingPage,
	Page,
	PageLoader,
	PageTitle,
	SectionHeading,
} from "@/components/page";
import { SaveButton } from "@/components/save-button";
import { SignInCta } from "@/components/sign-in-cta";
import { formatPrice } from "@/lib/format";
import { bodyCell, headCell, ledeClass, navLinkClass } from "@/lib/ui";
import { useFormatWeight } from "@/lib/weight";

const route = getRouteApi("/roaster/$roaster/$lot");

export type LotPageData = FunctionReturnType<typeof api.lots.get>;
type LotData = NonNullable<LotPageData>["lot"];

// A page read the client is still waiting on (ADR-0005). Past this the chip
// goes quiet: the read failed or found nothing, and the lot is asked again
// after the server's retry window.
const READING_WINDOW_MS = 90_000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

const FACTS = [
	["origin", "Origin"],
	["region", "Region"],
	["process", "Process"],
	["variety", "Variety"],
	["elevation", "Elevation"],
	["producer", "Producer"],
	["roastLevel", "Roast"],
] as const;

/**
 * The lot's facts as a two-column list in table type: caps label, value,
 * a hairline under each row. Only the facts the roaster published appear.
 */
const FactList = ({ facts }: { facts: LotData["facts"] }) => (
	<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6">
		{FACTS.map(([key, label]) => {
			const value = facts[key];
			return value === null ? null : (
				<div className="contents" key={key}>
					<dt className="label-caps text-foreground border-b py-3 pt-3.5">
						{label}
					</dt>
					<dd className="border-b py-3 text-sm leading-snug md:text-[15px]">
						{value}
					</dd>
				</div>
			);
		})}
	</dl>
);

/** Whether this look should ask the roaster's page for the lot's facts. */
const wantsPageFacts = (lot: LotData, now: number): boolean =>
	lot.status === "current" &&
	lot.thin &&
	!lot.pageFactsKnown &&
	(lot.pageFactsAt === null || now - lot.pageFactsAt > RETRY_WINDOW_MS);

const isReading = (lot: LotData, now: number): boolean =>
	lot.thin &&
	!lot.pageFactsKnown &&
	lot.pageFactsAt !== null &&
	now - lot.pageFactsAt < READING_WINDOW_MS;

/** One row of the size table: size, grind, price, stock, shop link. */
const VariantRow = ({
	variant,
}: {
	variant: NonNullable<LotData>["variants"][number];
}) => {
	const formatWeight = useFormatWeight();
	return (
		<tr
			className={`hover:bg-muted focus-within:bg-muted border-b transition-colors ${variant.available ? "" : "text-muted-foreground"}`}
		>
			<td className={`${bodyCell} tnum whitespace-nowrap`}>
				{formatWeight(variant.grams) ?? "—"}
			</td>
			<td
				className={`${bodyCell} text-muted-foreground hidden pr-4 sm:table-cell`}
			>
				{variant.grind ?? ""}
			</td>
			<td className={`${bodyCell} tnum whitespace-nowrap`}>
				{formatPrice(variant.priceCents)}
			</td>
			<td className={`${bodyCell} whitespace-nowrap`}>
				{variant.available ? (
					<span className="label-caps text-muted-foreground">In stock</span>
				) : (
					<span className="label-caps">Sold out</span>
				)}
			</td>
			<td className={`${bodyCell} w-8 text-right md:w-10`}>
				<a
					aria-label={`Buy ${variant.name} at the roaster's shop`}
					className="inline-flex size-6 items-center justify-center"
					href={variant.url}
					rel="noopener noreferrer"
					target="_blank"
				>
					<ArrowUpRight aria-hidden className="size-3.5" strokeWidth={1.5} />
				</a>
			</td>
		</tr>
	);
};

/**
 * The size table: every purchasable option the roaster publishes, one row
 * per variant, same hairline table as the index. The grind option is its
 * own axis. Rows end in the up-right arrow (ADR-0015 uses the right arrow
 * for links into Nouveau; up-right leaves the site) to the exact size on
 * the roaster's shop when the source published a variant id.
 */
const SizeTable = ({
	variants,
}: {
	variants: NonNullable<LotData>["variants"];
}) => (
	<section aria-labelledby="sizes-heading" className="mt-16 md:mt-24">
		<SectionHeading id="sizes-heading">Sizes</SectionHeading>
		<table className="mt-6 w-full border-collapse">
			<thead>
				<tr className="border-b">
					<th className={headCell} scope="col">
						Size
					</th>
					<th className={`${headCell} hidden sm:table-cell`} scope="col">
						Grind
					</th>
					<th className={headCell} scope="col">
						Price
					</th>
					<th className={headCell} scope="col">
						Stock
					</th>
					<th className={`${headCell} text-right`} scope="col">
						<span className="sr-only">Buy</span>
					</th>
				</tr>
			</thead>
			<tbody>
				{variants.map((variant) => (
					<VariantRow key={variant.id} variant={variant} />
				))}
			</tbody>
		</table>
	</section>
);

/**
 * The record above the tables: the title row with the page's controls, the
 * roaster line, then the photo beside the fact list, the roaster's own
 * descriptors and copy under it.
 */
const LotDetail = ({
	controls,
	lot,
	reading,
	roaster,
}: {
	controls: ReactNode;
	lot: LotData;
	reading: boolean;
	roaster: { name: string; slug: string };
}) => {
	const hasFacts = FACTS.some(([key]) => lot.facts[key] !== null);
	return (
		<>
			<PageTitle title={lot.name}>{controls}</PageTitle>
			<p className={ledeClass}>
				<Link
					className="hover:underline"
					params={{ roaster: roaster.slug }}
					to="/roaster/$roaster"
				>
					{roaster.name}
				</Link>
				{lot.status === "archived" && (
					<>
						<span aria-hidden className="mx-2">
							·
						</span>
						<span className="label-caps">Archived</span>
					</>
				)}
				{lot.status === "current" && lot.available === false && (
					<>
						<span aria-hidden className="mx-2">
							·
						</span>
						<span className="label-caps">Sold out</span>
					</>
				)}
			</p>
			<div className="mt-12 grid gap-8 md:mt-16 md:grid-cols-3 md:gap-6">
				{lot.imageUrl !== null && (
					<img
						alt=""
						className="bg-muted aspect-[3/2] w-full object-cover"
						src={lot.imageUrl}
					/>
				)}
				<div
					className={lot.imageUrl === null ? "md:col-span-3" : "md:col-span-2"}
				>
					{hasFacts && <FactList facts={lot.facts} />}
					{lot.facts.notes.length > 0 && (
						<div className={hasFacts ? "mt-8" : ""}>
							<p className="label-caps text-foreground">Roaster notes</p>
							<p className="text-muted-foreground mt-2 text-sm leading-snug md:text-[15px]">
								{lot.facts.notes.join(" · ")}
							</p>
						</div>
					)}
					{reading && (
						<p className="text-muted-foreground mt-6 inline-flex items-center gap-2 text-sm">
							<span
								aria-hidden
								className="inline-block size-2 rounded-full bg-current motion-safe:animate-pulse"
							/>
							Reading the roaster&apos;s page for more
						</p>
					)}
					{lot.description !== null && (
						<p className="mt-8 max-w-prose text-sm leading-snug md:text-[15px]">
							{lot.description}
						</p>
					)}
				</div>
			</div>
			{lot.variants.length > 0 && <SizeTable variants={lot.variants} />}
		</>
	);
};

const LotComponent = () => {
	const { roaster: roasterSlug, lot: handle } = route.useParams();
	// The pair is whatever the URL holds; the query resolves bad ones to null.
	const page = useQuery(api.lots.get, { lot: handle, roaster: roasterSlug });
	const me = useQuery(api.users.getCurrentUser);
	const { isAuthenticated } = useConvexAuth();
	const [logging, setLogging] = useState(false);
	const requestPageFacts = useMutation(api.pageFacts.request);
	// The clock the page-read state is judged against; ticks only while a
	// read is pending so the "reading" line can go quiet on its own.
	const [now, setNow] = useState(Date.now);
	const reading = page ? isReading(page.lot, now) : false;
	useEffect(() => {
		if (!reading) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 5000);
		return () => window.clearInterval(timer);
	}, [reading]);
	// One ask per lot per visit; the server dedupes across viewers anyway.
	const asked = useRef<string | null>(null);
	const lotToAsk = page && wantsPageFacts(page.lot, now) ? page.lot.id : null;
	useEffect(() => {
		if (lotToAsk === null || asked.current === lotToAsk) {
			return;
		}
		asked.current = lotToAsk;
		const ask = async () => {
			try {
				await requestPageFacts({ lotId: lotToAsk });
			} catch {
				// The page shows what the feed has; nothing else to do here.
			}
		};
		void ask();
	}, [lotToAsk, requestPageFacts]);

	// The viewer query decides only EDIT and DELETE on log rows; the page
	// does not wait for it.
	if (page === undefined) {
		return <PageLoader />;
	}
	if (page === null) {
		return (
			<MissingPage linkLabel="Browse the roasters" to="/roasters">
				No lot at this address.
			</MissingPage>
		);
	}

	const { lot, roaster } = page;

	const controls = (
		<>
			{isAuthenticated && <SaveButton lotId={lot.id} />}
			{isAuthenticated && (
				<button
					className={navLinkClass}
					onClick={() => {
						setLogging(true);
					}}
					type="button"
				>
					Log this lot
				</button>
			)}
			<a
				className={`${navLinkClass} gap-0.5`}
				href={lot.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				Buy
				<ArrowUpRight aria-hidden className="size-3.5" />
			</a>
		</>
	);

	return (
		<Page>
			{isAuthenticated && (
				<LogSheet
					lotId={lot.id}
					lotName={lot.name}
					onOpenChange={setLogging}
					open={logging}
					roasterNotes={
						lot.facts.notes.length === 0 ? null : lot.facts.notes.join(" · ")
					}
				/>
			)}
			<LotDetail
				controls={controls}
				lot={lot}
				reading={reading}
				roaster={roaster}
			/>
			<section aria-labelledby="logs-heading" className="mt-16 md:mt-24">
				<SectionHeading
					count={page.logs.length > 0 ? page.logs.length : undefined}
					id="logs-heading"
				>
					{page.logsTruncated ? "Recent logs" : "Logs"}
				</SectionHeading>
				{page.logs.length === 0 && (
					<p className="text-muted-foreground mt-4 max-w-prose text-sm">
						{isAuthenticated
							? "Nobody has logged this lot yet. You could be the first."
							: "No logs yet."}
					</p>
				)}
				{page.logs.length > 0 && (
					<div className="mt-6">
						{page.logs.map((log) => (
							<LogCard
								isMine={log.user.id === me?.id}
								key={log.logId}
								log={log}
								showLot={false}
							/>
						))}
					</div>
				)}
				{!isAuthenticated && (
					<div className="mt-8">
						<SignInCta />
					</div>
				)}
			</section>
		</Page>
	);
};

export const Route = createFileRoute("/roaster/$roaster/$lot")({
	component: LotComponent,
});
