import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import type { ReactNode } from "react";

import Loader from "@/components/loader";
import { ledeClass } from "@/lib/ui";

/** The side padding and top gap on their own, for `bleed` pages. */
export const pagePadding = "px-5 pt-10 md:px-10 md:pt-14";

/**
 * The inner-page shell every route but the landing and the workbench uses:
 * a `main` with the page's side padding and the top gap under the header.
 * `bleed` hands the padding to the children instead, for pages whose tabs
 * or filter rows run edge to edge (Drops).
 */
export const Page = ({
	bleed = false,
	children,
}: {
	bleed?: boolean;
	children: ReactNode;
}) => (
	<main>
		{bleed ? children : <div className={pagePadding}>{children}</div>}
	</main>
);

/** A page still waiting on its first query: the spinner, centered. */
export const PageLoader = () => (
	<main className="py-24">
		<Loader />
	</main>
);

/**
 * The line a page shows when its address names nothing: what is missing
 * and one link onward. Shared by the lot, roaster and profile pages and
 * the root's not-found view, so every dead end reads the same.
 */
export const MissingPage = ({
	children,
	linkLabel,
	to,
}: {
	/** "No lot at this address." */
	children: ReactNode;
	linkLabel: string;
	to: LinkProps["to"];
}) => (
	<main>
		<p className="text-muted-foreground px-5 py-24 text-center text-[15px] md:px-10">
			{children}{" "}
			<Link className="text-foreground underline" to={to}>
				{linkLabel}
			</Link>
			.
		</p>
	</main>
);

/** The centered grey line under an empty table or list. */
export const EmptyLine = ({ children }: { children: ReactNode }) => (
	<p className="text-muted-foreground py-16 text-center text-[15px]">
		{children}
	</p>
);

/**
 * Inner-page title row: the name at wordmark scale (mixed case; only the
 * wordmark itself is caps), an optional count in tabular figures like the
 * landing tabs carry, and the page's caps controls on the right baseline.
 * `lede` is the grey sentence under it, when the page has one.
 */
export const PageTitle = ({
	children,
	count,
	lede,
	title,
}: {
	/** Caps links or toggles that belong to the whole page. */
	children?: ReactNode;
	count?: number;
	lede?: ReactNode;
	title: string;
}) => (
	<>
		<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
			<h1 className="font-serif text-[2rem] leading-none font-normal md:text-[2.75rem]">
				{title}
				{count !== undefined && (
					<span className="text-muted-foreground tnum ml-2 font-sans text-sm font-normal">
						({count})
					</span>
				)}
			</h1>
			{children !== undefined && (
				<div className="flex items-center gap-4 md:gap-5">{children}</div>
			)}
		</div>
		{lede !== undefined && <p className={`${ledeClass} max-w-prose`}>{lede}</p>}
	</>
);

/**
 * A section heading inside a page: serif-free, table-scale, with the count
 * in tabular figures beside it when the caller has one. Every inner page's
 * sections (Drop history, Lots, Logs, Watching, Try list, Sizes) use it, so
 * the vertical rhythm between them is the one `mt-16 md:mt-24`.
 */
export const SectionHeading = ({
	children,
	count,
	id,
}: {
	children: ReactNode;
	count?: number;
	id: string;
}) => (
	<h2 className="text-xl md:text-2xl" id={id}>
		{children}
		{count !== undefined && (
			<span className="text-muted-foreground tnum ml-2 text-xs">({count})</span>
		)}
	</h2>
);
