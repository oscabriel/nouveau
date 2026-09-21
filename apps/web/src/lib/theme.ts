/**
 * The theme preference is a relation, not a colour (ADR-0013): system
 * (default) or inverted. The applied colour follows from the operating
 * system's setting and the relation together; next-themes keeps the system
 * side native. Stored in localStorage per browser, because "inverted" only
 * means something relative to this device's OS and this device's page.
 */

export type ThemePreference = "system" | "inverted";

/** The same slot the old absolute light/dark toggle used. */
const STORAGE_KEY = "vite-ui-theme";

const isPreference = (value: string | null): value is ThemePreference =>
	value === "system" || value === "inverted";

/**
 * Reads the stored relation. A leftover absolute "light"/"dark" from the old
 * toggle is worthless after the change (ADR-0013) and is discarded on read.
 */
export const readThemePreference = (): ThemePreference => {
	const stored = localStorage.getItem(STORAGE_KEY);
	if (isPreference(stored)) {
		return stored;
	}
	if (stored !== null) {
		localStorage.removeItem(STORAGE_KEY);
	}
	return "system";
};

export const writeThemePreference = (preference: ThemePreference): void => {
	localStorage.setItem(STORAGE_KEY, preference);
};

/** The OS-side theme, from matchMedia, readable before next-themes has resolved. */
export const systemTheme = (): "light" | "dark" =>
	matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
