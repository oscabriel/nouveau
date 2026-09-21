import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import * as React from "react";

import { readThemePreference, systemTheme } from "@/lib/theme";

/**
 * next-themes applies the class and owns the system side. The library's own
 * storage key is a pre-paint cache of the last applied colour, nothing more;
 * the stored preference is the relation, which ThemeSync reads and applies
 * on mount, and re-applies live when the OS theme changes.
 */
const ThemeSync = () => {
	const { setTheme } = useTheme();
	// Layout effect: the class must be correct before the SPA's first paint,
	// so a dark-OS visitor on the inverted relation never sees light flash.
	React.useLayoutEffect(() => {
		const preference = readThemePreference();
		if (preference === "system") {
			setTheme("system");
		} else {
			setTheme(systemTheme() === "dark" ? "light" : "dark");
		}
	}, [setTheme]);
	React.useEffect(() => {
		const onChange = () => {
			if (readThemePreference() === "inverted") {
				setTheme(systemTheme() === "dark" ? "light" : "dark");
			}
		};
		window
			.matchMedia("(prefers-color-scheme: dark)")
			.addEventListener("change", onChange);
		return () => {
			window
				.matchMedia("(prefers-color-scheme: dark)")
				.removeEventListener("change", onChange);
		};
	}, [setTheme]);
	return null;
};

export const ThemeProvider = ({
	children,
	...props
}: React.ComponentProps<typeof NextThemesProvider>) => (
	<NextThemesProvider {...props}>
		<ThemeSync />
		{children}
	</NextThemesProvider>
);

export { useTheme } from "next-themes";
