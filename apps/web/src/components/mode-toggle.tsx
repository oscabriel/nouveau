import { useTheme } from "@/components/theme-provider";

/**
 * Theme switch as a caps text control, like every other header link. The
 * label names the theme you would switch to. Until next-themes has resolved
 * the current theme (the first client render) it holds its width and says
 * nothing.
 */
export const ModeToggle = () => {
	const { resolvedTheme, setTheme } = useTheme();
	if (resolvedTheme === undefined) {
		return <span aria-hidden className="inline-block min-h-11 w-9" />;
	}
	const dark = resolvedTheme === "dark";
	return (
		<button
			aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
			className="label-caps inline-flex min-h-11 items-center hover:underline"
			onClick={() => setTheme(dark ? "light" : "dark")}
			type="button"
		>
			{dark ? "Light" : "Dark"}
		</button>
	);
};
