import type { ReactNode } from "react";

/**
 * Inner-page title row: the name at wordmark scale (mixed case; only the
 * wordmark itself is caps), an optional count in tabular figures like the
 * landing tabs carry, and the page's caps controls on the right baseline.
 */
export const PageTitle = ({
	children,
	count,
	title,
}: {
	/** Caps links or toggles that belong to the whole page. */
	children?: ReactNode;
	count?: number;
	title: string;
}) => (
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
);
