import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetTitle,
} from "@nouveau/ui/components/sheet";
import type { ReactNode } from "react";

import { navLinkClass } from "@/lib/ui";

/**
 * The right-hand pane both sheets share (Find my next bag, Log this lot):
 * the caps title on the left, CLOSE on the right at the header's own
 * height, then whatever the caller puts under it. Modal; the backdrop and
 * Escape close it through `onOpenChange`.
 */
export const Pane = ({
	children,
	onOpenChange,
	open,
	title,
}: {
	children: ReactNode;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	title: string;
}) => (
	<Sheet modal onOpenChange={onOpenChange} open={open}>
		<SheetContent
			aria-describedby={undefined}
			className="px-5 pt-3 pb-16 md:px-8 md:pt-4"
		>
			<div className="flex items-center justify-between">
				<SheetTitle className="label-caps inline-flex min-h-11 items-center font-semibold">
					{title}
				</SheetTitle>
				<SheetClose className={navLinkClass}>Close</SheetClose>
			</div>
			{children}
		</SheetContent>
	</Sheet>
);
