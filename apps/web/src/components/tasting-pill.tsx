import type { TastingFamily } from "@nouveau/backend/convex/tasting";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * One class per wheel family, defined in globals.css with a light and a
 * dark value each; null (a word the wheel does not know) gets the plain
 * hairline pill.
 */
const familyClass: Record<TastingFamily, string> = {
	floral: "pill-floral",
	fruity: "pill-fruity",
	"green/vegetative": "pill-green",
	"nutty/cocoa": "pill-nutty",
	other: "pill-other",
	roasted: "pill-roasted",
	"sour/fermented": "pill-sour",
	spices: "pill-spices",
	sweet: "pill-sweet",
};

export const pillClass = (family: TastingFamily | null): string =>
	`text-foreground inline-flex h-7 items-center border px-2.5 text-[13px] leading-none whitespace-nowrap ${
		family === null ? "border-border" : familyClass[family]
	}`;

/**
 * A tasting note as a colored pill (batch 8, 2026-09-21): soft ground and
 * border in the family's hue, ink text. Since 2026-09-21 the roaster's
 * descriptors in tables and cards use it too, so every lot note on the site
 * reads the same way. With `link`, the pill goes to /drops filtered to
 * the family, so one word on a log leads to every recent lot in its
 * family. A word with no family is a plain hairline pill and never links.
 */
export const TastingPill = ({
	children,
	family,
	link = false,
}: {
	children: ReactNode;
	family: TastingFamily | null;
	link?: boolean;
}) => {
	if (link && family !== null) {
		return (
			<Link
				className={`${pillClass(family)} hover:underline`}
				search={{ family }}
				to="/drops"
			>
				{children}
			</Link>
		);
	}
	return <span className={pillClass(family)}>{children}</span>;
};
