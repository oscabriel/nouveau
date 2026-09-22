import { Link } from "@tanstack/react-router";
import type { LinkProps } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { thumbUrl } from "@/lib/drops";
import { bodyCell, FLOATING_IMAGE_WIDTH } from "@/lib/ui";

/** The floating image rides this far from the pointer (or row edge). */
const CURSOR_GAP = 16;
/** How close the image may sit to the viewport's edges. */
const EDGE_MARGIN = 8;
/** The image is 3:2 (ADR-0015); the width is the shared token. */
const FLOATING_IMAGE_HEIGHT = Math.round((FLOATING_IMAGE_WIDTH * 2) / 3);

/**
 * A table's row-end mark: a short right arrow. Every mark in a row points
 * at Nouveau (ADR-0015), so the cell is a link and the destination is the
 * caller's choice: the lot page on the drop tables and the catalog.
 */
export const ArrowCell = ({
	label,
	...link
}: { label: string } & LinkProps) => (
	<td className={`${bodyCell} w-8 text-right md:w-10`}>
		<Link
			aria-label={label}
			className="inline-flex size-6 items-center justify-center"
			{...link}
		>
			<ArrowRight aria-hidden className="size-3.5" strokeWidth={1.5} />
		</Link>
	</td>
);

/** Above-right of the pointer, clamped inside the viewport (ADR-0015). */
const place = (x: number, y: number): { left: number; top: number } => {
	const width = FLOATING_IMAGE_WIDTH;
	const height = FLOATING_IMAGE_HEIGHT;
	// Right edge first: flip to the pointer's left rather than clamp over it.
	let left = x + CURSOR_GAP;
	if (left + width > window.innerWidth - EDGE_MARGIN) {
		left = Math.max(EDGE_MARGIN, x - CURSOR_GAP - width);
	}
	// Above the pointer; when there is no headroom, below it instead.
	let top = y - height - CURSOR_GAP;
	if (top < EDGE_MARGIN) {
		top = y + CURSOR_GAP;
	}
	top = Math.min(top, window.innerHeight - height - EDGE_MARGIN);
	return { left, top };
};

/**
 * The floating hover image (ADR-0015): one element per table, about 280
 * pixels wide at 3:2, above-right of the pointer and moving with it, never
 * inside a cell. Rows opt in with a `data-image-url` attribute on the
 * `<tr>`; tables whose rows carry no URL (the roasters directory) show
 * nothing. Fine pointers only; touch gets no hover image. Keyboard focus
 * shows the same image anchored to the row's leading edge, where a pointer
 * would rest.
 *
 * Mount as a sibling of the `<table>`, passing the table's ref. The image
 * is `position: fixed`, so no wrapper is needed.
 *
 * The position is written straight to the element as a `transform` on each
 * pointer move; React state holds only the source and whether the image
 * shows. A state update per move re-rendered on every pixel and moved the
 * box with `left`/`top`, which lays out; a translate stays on the
 * compositor.
 */
export const TableHoverImage = ({
	tableRef,
}: {
	tableRef: RefObject<HTMLTableElement | null>;
}) => {
	// The image keeps its last source and position while hidden, so a
	// row-to-row move only swaps the source and never flickers the box.
	const [src, setSrc] = useState<string | null>(null);
	const [shown, setShown] = useState(false);
	const imageRef = useRef<HTMLImageElement | null>(null);
	// The last position, for the first paint after the element mounts.
	const positionRef = useRef({ left: 0, top: 0 });
	// `matchMedia` in the initializer: this is a client-only SPA, and a fine
	// pointer is a property of the device, not of any render.
	const [finePointer, setFinePointer] = useState(
		() => window.matchMedia("(pointer: fine)").matches
	);

	useEffect(() => {
		const query = window.matchMedia("(pointer: fine)");
		const onChange = (event: MediaQueryListEvent) => {
			setFinePointer(event.matches);
			if (!event.matches) {
				setShown(false);
			}
		};
		query.addEventListener("change", onChange);
		return () => {
			query.removeEventListener("change", onChange);
		};
	}, []);

	useEffect(() => {
		const table = tableRef.current;
		if (!finePointer || table === null) {
			return;
		}
		// The hovered or focused row, when it carries an image URL.
		const rowAt = (target: EventTarget | null): HTMLElement | null =>
			target instanceof Element ? target.closest("tr[data-image-url]") : null;
		const show = (nextSrc: string, left: number, top: number) => {
			positionRef.current = { left, top };
			const image = imageRef.current;
			if (image !== null) {
				image.style.transform = `translate3d(${left}px, ${top}px, 0)`;
			}
			setSrc(nextSrc);
			setShown(true);
		};
		const onPointerMove = (event: PointerEvent) => {
			const row = rowAt(event.target);
			const rowSrc = row?.dataset.imageUrl ?? "";
			if (rowSrc === "") {
				setShown(false);
				return;
			}
			const { left, top } = place(event.clientX, event.clientY);
			show(rowSrc, left, top);
		};
		const onFocusIn = (event: FocusEvent) => {
			const row = rowAt(event.target);
			if (row === null) {
				return;
			}
			const rowSrc = row.dataset.imageUrl ?? "";
			if (rowSrc === "") {
				setShown(false);
				return;
			}
			const rect = row.getBoundingClientRect();
			const { left, top } = place(rect.left, rect.top + rect.height / 2);
			show(rowSrc, left, top);
		};
		const onFocusOut = (event: FocusEvent) => {
			// Focus moving within the same row keeps the image up.
			const from = rowAt(event.target);
			const to =
				event.relatedTarget instanceof Element
					? event.relatedTarget.closest("tr[data-image-url]")
					: null;
			if (from !== null && to === from) {
				return;
			}
			setShown(false);
		};
		const hide = () => {
			setShown(false);
		};
		table.addEventListener("pointermove", onPointerMove);
		table.addEventListener("pointerleave", hide);
		table.addEventListener("focusin", onFocusIn);
		table.addEventListener("focusout", onFocusOut);
		// A fixed image would stay put while the page scrolls under it.
		window.addEventListener("scroll", hide, { capture: true, passive: true });
		window.addEventListener("resize", hide);
		return () => {
			table.removeEventListener("pointermove", onPointerMove);
			table.removeEventListener("pointerleave", hide);
			table.removeEventListener("focusin", onFocusIn);
			table.removeEventListener("focusout", onFocusOut);
			window.removeEventListener("scroll", hide, { capture: true });
			window.removeEventListener("resize", hide);
		};
	}, [finePointer, tableRef]);

	if (src === null) {
		return null;
	}
	return (
		<img
			alt=""
			aria-hidden
			className={`border-border bg-background pointer-events-none fixed top-0 left-0 z-50 border transition-opacity duration-150 will-change-transform ${shown ? "opacity-100" : "opacity-0"} motion-reduce:transition-none`}
			height={FLOATING_IMAGE_HEIGHT}
			ref={(element) => {
				// The first paint takes the position the pointer already has;
				// later moves write the transform in the handler.
				imageRef.current = element;
				if (element !== null) {
					const { left, top } = positionRef.current;
					element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
				}
			}}
			src={thumbUrl(src, FLOATING_IMAGE_WIDTH)}
			width={FLOATING_IMAGE_WIDTH}
		/>
	);
};
