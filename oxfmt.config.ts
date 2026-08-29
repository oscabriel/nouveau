import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
	...ultracite,
	ignorePatterns: [
		...(ultracite.ignorePatterns ?? []),
		"**/.agents/skills/**",
		"packages/ui/src/components/**",
	],
	// Indent with tabs, rendered at width 2.
	tabWidth: 2,
	useTabs: true,
});
