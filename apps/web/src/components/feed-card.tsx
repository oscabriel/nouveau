import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";

import {
	displayPriceCents,
	displayVariantName,
	formatPrice,
	relativeTime,
} from "@/lib/format";

export type DeliveryStatus = "pending" | "sent" | "delivered" | "failed";

export interface FeedCardData {
	detectedAt: number;
	lotUrl: string;
	newPriceCents: number | null;
	oldPriceCents: number | null;
	productName: string;
	roasterName: string;
	roasterSlug: string;
	type: "back_in_stock" | "new" | "price_drop";
	variantName: string | null;
	deliveryStatus?: DeliveryStatus | null;
}

const TYPE_LABEL = {
	back_in_stock: "Back in stock",
	new: "New",
	price_drop: "Price drop",
} as const;

const TYPE_TONE = {
	back_in_stock: "text-foreground",
	new: "text-foreground",
	price_drop: "text-emerald-600 dark:text-emerald-400",
} as const;

/** The locked footer progression (build spec §8.1): pending → sent → delivered ✓ */
const DELIVERY_STEPS: readonly Exclude<DeliveryStatus, "failed">[] = [
	"pending",
	"sent",
	"delivered",
];

const DeliveryFooter = ({ status }: { status: DeliveryStatus }) => {
	if (status === "failed") {
		return (
			<p className="text-muted-foreground/70 text-xs">
				Email failed — we&apos;ll retry with the next drop.
			</p>
		);
	}
	const reached = DELIVERY_STEPS.indexOf(status);
	return (
		<p className="text-muted-foreground/70 flex flex-wrap items-center gap-x-1 text-xs">
			<span>Emailed you ·</span>
			{DELIVERY_STEPS.map((step, index) => (
				<span key={step} className="inline-flex items-center gap-x-1">
					{index > 0 && <span aria-hidden>→</span>}
					<span
						className={
							index <= reached ? "text-muted-foreground font-medium" : undefined
						}
					>
						{step}
						{step === "delivered" && reached === index ? " ✓" : ""}
					</span>
				</span>
			))}
		</p>
	);
};

/**
 * One drop-event row. Global-feed cards stay clean; personalized cards add
 * the delivery footer from the notifications ledger (build spec §8.1).
 * `showRoaster` is off on the roaster's own page, where the name is the H1.
 */
export const FeedCard = ({
	card,
	showRoaster = true,
}: {
	card: FeedCardData;
	showRoaster?: boolean;
}) => {
	const variantName = displayVariantName(card.variantName);
	const newPrice = displayPriceCents(card.newPriceCents);
	const oldPrice = displayPriceCents(card.oldPriceCents);
	return (
		<article className="flex flex-col gap-1 border-b px-1 py-4 last:border-b-0">
			<div className="flex items-baseline justify-between gap-x-3">
				<div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
					<span className={`text-sm font-medium ${TYPE_TONE[card.type]}`}>
						{TYPE_LABEL[card.type]}
					</span>
					{showRoaster && (
						<>
							<span className="text-muted-foreground text-sm">at</span>
							<Link
								className="truncate font-medium hover:underline"
								params={{ slug: card.roasterSlug }}
								to="/roasters/$slug"
							>
								{card.roasterName}
							</Link>
						</>
					)}
				</div>
				<time
					className="text-muted-foreground shrink-0 text-xs tabular-nums"
					dateTime={new Date(card.detectedAt).toISOString()}
				>
					{relativeTime(card.detectedAt)}
				</time>
			</div>
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<h3 className="leading-snug font-semibold">{card.productName}</h3>
				<div className="flex items-baseline gap-3">
					{variantName !== null && (
						<span className="text-muted-foreground text-sm">{variantName}</span>
					)}
					{newPrice !== null && (
						<span
							className={`text-sm font-medium tabular-nums ${TYPE_TONE[card.type]}`}
						>
							{oldPrice !== null && (
								<span className="text-muted-foreground mr-1 line-through">
									{formatPrice(oldPrice)}
								</span>
							)}
							{formatPrice(newPrice)}
						</span>
					)}
					<a
						className="inline-flex items-center gap-0.5 text-sm hover:underline"
						href={card.lotUrl}
						rel="noreferrer"
						target="_blank"
					>
						See the lot
						<ArrowUpRight aria-hidden className="size-3.5" />
					</a>
				</div>
			</div>
			{card.deliveryStatus !== undefined && card.deliveryStatus !== null && (
				<DeliveryFooter status={card.deliveryStatus} />
			)}
		</article>
	);
};
