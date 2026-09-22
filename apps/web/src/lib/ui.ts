/**
 * Class constants shared across pages: one definition per repeated shape,
 * so a styling change lands everywhere at once.
 */

/** Caps text link, 44px tall hit area, underline on hover. */
export const navLinkClass =
	"label-caps inline-flex min-h-11 items-center hover:underline";

/**
 * The quiet caps action: grey, ink on hover, no underline. CLEAR, CANCEL,
 * DELETE, UNWATCH, SIGN OUT; anything that undoes or steps back.
 */
export const quietLinkClass =
	"label-caps text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center transition-colors";

/**
 * The one filled control in the system (ADR-0014): a square ink block with
 * a caps label. Sign in, Find my next bag, Save on the account form.
 */
export const primaryButtonClass =
	"label-caps bg-foreground text-background inline-flex min-h-11 items-center px-5 transition-opacity hover:opacity-80 disabled:opacity-50";

/**
 * A text field as one hairline under a line of type, no box. Carries no
 * type size: filter controls add `text-sm`, form fields and the search add
 * `text-[15px] md:text-base`. The browser's own search-clear button is
 * hidden; it belongs to no design system.
 */
export const hairlineInputClass =
	"placeholder:text-muted-foreground focus-visible:border-foreground h-11 border-b bg-transparent outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden";

/** A native select on the same hairline, grey until a value is chosen. */
export const hairlineSelectClass =
	"text-muted-foreground focus-visible:border-foreground h-11 max-w-40 border-b bg-transparent text-sm outline-none";

/** The grey line under a page title or a lot name. */
export const ledeClass = "text-muted-foreground mt-4 text-sm md:text-[15px]";

/** Table head and body cell classes, shared by every index table. */
export const headCell = "label-caps text-foreground pb-3 text-left font-medium";
/** Head cell of a right-aligned numeric column; the pr matches the body
 * cell's pr-4, so the header and its numbers share a right edge. */
export const headCellRight =
	"label-caps text-foreground pb-3 pr-4 text-right font-medium";
export const bodyCell = "py-5 align-top text-sm leading-snug md:text-[15px]";

/** The floating hover image's width in pixels (ADR-0015); height is 3:2. */
export const FLOATING_IMAGE_WIDTH = 280;
