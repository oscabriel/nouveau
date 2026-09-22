import type { ReactNode } from "react";

/**
 * The dot toggle: a caps word with an 8px dot before it. On is ink with
 * the dot filled; off is grey with the dot faded, going ink on hover.
 * `aria-pressed` carries the state; `busy` disables the button and pulses
 * the dot while a mutation runs. One control, five mounts: WATCH /
 * WATCHING, SAVE / SAVED, RATE IT, INCLUDE MY LOGS and each side of the
 * LIGHT / DARK pair, and LATEST / SHUFFLE on the landing.
 */
export const DotToggle = ({
	busy = false,
	children,
	className = "",
	id,
	onClick,
	pressed,
	title,
}: {
	busy?: boolean;
	children: ReactNode;
	className?: string;
	id?: string;
	onClick: () => void;
	pressed: boolean;
	title?: string;
}) => (
	<button
		aria-pressed={pressed}
		className={`label-caps inline-flex min-h-11 items-center gap-2 whitespace-nowrap transition-colors disabled:cursor-default ${
			pressed
				? "text-foreground"
				: "text-muted-foreground hover:text-foreground"
		} ${className}`}
		disabled={busy}
		id={id}
		onClick={onClick}
		title={title}
		type="button"
	>
		<span
			aria-hidden
			className={`inline-block size-2 rounded-full bg-current transition-opacity ${
				pressed ? "opacity-100" : "opacity-30"
			} ${busy ? "motion-safe:animate-pulse" : ""}`}
		/>
		{children}
	</button>
);
