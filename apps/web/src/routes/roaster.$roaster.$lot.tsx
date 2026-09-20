import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Button } from "@nouveau/ui/components/button";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import Loader from "@/components/loader";
import { LogCard } from "@/components/log-card";
import { LogForm } from "@/components/log-form";
import { SaveButton } from "@/components/save-button";
import { SignInCta } from "@/components/sign-in-cta";
import { formatGrams, formatPrice } from "@/lib/format";
import { bodyCell, headCell } from "@/lib/ui";

export type LotPageData = FunctionReturnType<typeof api.lots.get>;
type LotData = NonNullable<LotPageData>["lot"];

// A page read the client is still waiting on (ADR-0005). Past this the chip
// goes quiet: the read failed or found nothing, and the lot is asked again
// after the server's retry window.
const READING_WINDOW_MS = 90_000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;

const FACT_CHIPS = [
	["origin", "Origin"],
	["region", "Region"],
	["process", "Process"],
	["variety", "Variety"],
	["elevation", "Elevation"],
	["producer", "Producer"],
	["roastLevel", "Roast"],
] as const;

const LotAttribute = ({ label, value }: { label: string; value: string }) => (
	<span className="rounded-full border px-3 py-1 text-sm">
		<span className="text-muted-foreground mr-1.5 text-xs">{label}</span>
		{value}
	</span>
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
}) => (
	<tr
		className={`group hover:bg-muted focus-within:bg-muted border-b transition-colors ${variant.available ? "" : "opacity-50"}`}
	>
		<td className={`${bodyCell} tnum whitespace-nowrap`}>
			{formatGrams(variant.grams) ?? "—"}
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
				<span className="label-caps opacity-70">Sold out</span>
			)}
		</td>
		<td className={`${bodyCell} w-6 text-right md:w-8`}>
			<a
				aria-label={`Open ${variant.name} at the roaster's shop`}
				className="inline-flex size-6 items-center justify-center"
				href={variant.url}
				rel="noreferrer"
				target="_blank"
			>
				<span className="size-2.5 rounded-full border border-current transition-colors group-hover:bg-current" />
			</a>
		</td>
	</tr>
);

/**
 * The size table: every purchasable option the roaster publishes, one row
 * per variant, same hairline table as the index. The grind option is its
 * own axis; the circle links to the exact size on the roaster's shop when
 * the source published a variant id.
 */
const SizeTable = ({
	variants,
}: {
	variants: NonNullable<LotData>["variants"];
}) => (
	<section aria-label="Sizes and prices" className="mt-8">
		<h2 className="label-caps mb-3 font-medium">Sizes</h2>
		<table className="w-full border-collapse">
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
						Shop
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

const LotDetail = ({
	lot,
	reading,
	roaster,
}: {
	lot: LotData;
	reading: boolean;
	roaster: { name: string; slug: string };
}) => (
	<>
		<header className="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0">
				<h1 className="text-2xl font-semibold">{lot.name}</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					at{" "}
					<Link
						className="font-medium hover:underline"
						params={{ roaster: roaster.slug }}
						to="/roaster/$roaster"
					>
						{roaster.name}
					</Link>
					{lot.status === "archived" && (
						<span className="ml-2">· archived lot</span>
					)}
				</p>
			</div>
			<a
				className="inline-flex items-center gap-0.5 text-sm hover:underline"
				href={lot.url}
				rel="noopener noreferrer"
				target="_blank"
			>
				See at {roaster.name}
				<ArrowUpRight aria-hidden className="size-3.5" />
			</a>
		</header>
		<div className="flex flex-wrap items-start gap-6">
			{lot.imageUrl !== null && (
				<img
					alt=""
					className="h-40 w-40 shrink-0 rounded-md border object-cover"
					src={lot.imageUrl}
				/>
			)}
			<div className="min-w-0 flex-1">
				{FACT_CHIPS.some(([key]) => lot.facts[key] !== null) && (
					<div className="mb-3 flex flex-wrap gap-2">
						{FACT_CHIPS.map(([key, label]) => {
							const value = lot.facts[key];
							return value === null ? null : (
								<LotAttribute key={key} label={label} value={value} />
							);
						})}
					</div>
				)}
				{lot.facts.notes.length > 0 && (
					<p className="text-muted-foreground mb-3 text-sm">
						<span className="text-foreground font-medium">Roaster notes:</span>{" "}
						{lot.facts.notes.join(" · ")}
					</p>
				)}
				{reading && (
					<p className="text-muted-foreground mb-3 text-xs">
						Reading the roaster&apos;s page for more…
					</p>
				)}
				{lot.description !== null && (
					<p className="text-sm">{lot.description}</p>
				)}
				{/* Unknown stock (available null, no rollup yet) shows nothing; known-sold-out states itself. */}
				{lot.status === "current" && lot.available === false && (
					<p className="label-caps mt-3 opacity-70">
						Currently sold out at the roaster
					</p>
				)}
			</div>
		</div>
		{lot.variants.length > 0 && <SizeTable variants={lot.variants} />}
	</>
);

const LotComponent = () => {
	const { roaster: roasterSlug, lot: handle } = useParams({
		from: "/roaster/$roaster/$lot",
	});
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

	if (page === undefined || me === undefined) {
		return <Loader />;
	}
	if (page === null) {
		return (
			<div className="container mx-auto max-w-3xl px-4 py-8">
				<p className="text-muted-foreground py-8 text-sm">
					No lot at this address.{" "}
					<Link className="underline" to="/roasters">
						Browse the roasters
					</Link>
					.
				</p>
			</div>
		);
	}

	const { lot, roaster } = page;
	const isMine = (logId: string) =>
		page.logs.some((log) => log.logId === logId && log.user.id === me?.id);

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<LotDetail lot={lot} reading={reading} roaster={roaster} />
			<section className="mt-8">
				<div className="mb-2 flex items-center justify-between gap-3">
					<h2 className="font-semibold">
						{page.logsTruncated ? "Recent logs" : "Logs"}
					</h2>
					{isAuthenticated ? (
						<div className="flex items-center gap-2">
							<SaveButton lotId={lot.id} size="sm" />
							<Button
								onClick={() => {
									setLogging((value) => !value);
								}}
								size="sm"
								variant={logging ? "ghost" : "outline"}
							>
								{logging ? "Close" : "Log this lot"}
							</Button>
						</div>
					) : (
						<SignInCta />
					)}
				</div>
				{logging && isAuthenticated && (
					<LogForm
						lotId={lot.id}
						onDone={() => {
							setLogging(false);
						}}
						roasterNotes={
							lot.facts.notes.length === 0 ? null : lot.facts.notes.join(", ")
						}
					/>
				)}
				{page.logs.length === 0 ? (
					<p className="text-muted-foreground py-6 text-sm">
						{isAuthenticated
							? "Nobody has logged this lot yet — be the first."
							: "No logs yet."}
					</p>
				) : (
					<div className="divide-y">
						{page.logs.map((log) => (
							<LogCard isMine={isMine(log.logId)} key={log.logId} log={log} />
						))}
					</div>
				)}
			</section>
		</div>
	);
};

export const Route = createFileRoute("/roaster/$roaster/$lot")({
	component: LotComponent,
});
