import { useTheme } from "@/components/theme-provider";
import { systemTheme, writeThemePreference } from "@/lib/theme";

/**
 * The theme control's state and choice, shared by both mounts of the switch
 * (ADR-0013): the header's handle dropdown and /settings/appearance. One
 * stored state; the active side of the switch is whatever the page shows.
 *
 * A choice names a colour, and the stored value is the relation that yields
 * it: choosing the side the system is already on stores "system", choosing
 * the other side stores "inverted". When the OS later flips, the stored
 * relation keeps describing the visitor's intent.
 */
export const useThemeControls = () => {
	const { resolvedTheme, setTheme } = useTheme();
	const choose = (target: "light" | "dark") => {
		setTheme(target);
		writeThemePreference(target === systemTheme() ? "system" : "inverted");
	};
	return {
		choose,
		/** The side of the switch that is live: "light" | "dark", or undefined until mounted. */
		resolved: resolvedTheme,
	};
};

/**
 * The single switch, flipping between the words LIGHT and DARK in the
 * LATEST / SHUFFLE vocabulary: the active side is ink with a filled dot, the
 * other grey with the dot faded. Default side is the system's theme.
 */
export const ThemeSwitch = () => {
	const { resolved, choose } = useThemeControls();
	if (resolved === undefined) {
		// Hold the pair's height until next-themes has resolved the system.
		return <div aria-hidden className="min-h-11" />;
	}
	const sides = [
		{ label: "Light", target: "light" },
		{ label: "Dark", target: "dark" },
	] as const;
	return (
		<div className="flex items-center gap-x-5">
			{sides.map(({ label, target }) => {
				const active = resolved === target;
				return (
					<button
						aria-pressed={active}
						className={`label-caps inline-flex min-h-11 items-center gap-2 transition-colors ${
							active
								? "text-foreground"
								: "text-muted-foreground hover:text-foreground"
						}`}
						key={target}
						onClick={() => {
							choose(target);
						}}
						type="button"
					>
						<span
							aria-hidden
							className={`inline-block size-2 rounded-full bg-current transition-opacity ${
								active ? "opacity-100" : "opacity-30"
							}`}
						/>
						{label}
					</button>
				);
			})}
		</div>
	);
};
