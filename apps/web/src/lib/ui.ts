/**
 * Class constants shared across pages: one definition per repeated shape,
 * so a styling change lands everywhere at once.
 */

/** Caps text link, 44px tall hit area, underline on hover. */
export const navLinkClass =
	"label-caps inline-flex min-h-11 items-center hover:underline";

/** Table head and body cell classes, shared by every index table. */
export const headCell = "label-caps text-foreground pb-3 text-left font-medium";
/** Head cell of a right-aligned numeric column; the pr matches the body
 * cell's pr-4, so the header and its numbers share a right edge. */
export const headCellRight =
	"label-caps text-foreground pb-3 pr-4 text-right font-medium";
export const bodyCell = "py-5 align-top text-sm leading-snug md:text-[15px]";

/** The floating hover image's width in pixels (ADR-0015); height is 3:2. */
export const FLOATING_IMAGE_WIDTH = 280;
