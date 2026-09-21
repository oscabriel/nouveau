import { DotToggle } from "@/components/dot-toggle";
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
/** The two sides of the switch, in the order every control lists them. */
export const THEME_SIDES = [
	{ label: "Light", target: "light" },
	{ label: "Dark", target: "dark" },
] as const;

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
 * The single switch, flipping between the words LIGHT and DARK, each side
 * a dot toggle: the active side is ink with a filled dot, the other grey
 * with the dot faded. Default side is the system's theme.
 */
export const ThemeSwitch = () => {
	const { resolved, choose } = useThemeControls();
	if (resolved === undefined) {
		// Hold the pair's height until next-themes has resolved the system.
		return <div aria-hidden className="min-h-11" />;
	}
	return (
		<div className="flex items-center gap-x-5">
			{THEME_SIDES.map(({ label, target }) => {
				const active = resolved === target;
				return (
					<DotToggle
						key={target}
						onClick={() => {
							choose(target);
						}}
						pressed={active}
					>
						{label}
					</DotToggle>
				);
			})}
		</div>
	);
};
