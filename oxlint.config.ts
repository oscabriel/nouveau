import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import tanstack from "ultracite/oxlint/tanstack";

export default defineConfig({
	extends: [core, react, tanstack],
	ignorePatterns: [
		...(core.ignorePatterns ?? []),
		"**/.agents/skills/**",
		"packages/ui/src/components/**",
	],
	overrides: [
		{
			files: ["apps/web/src/routes/**/$*.tsx"],
			rules: {
				"unicorn/filename-case": ["error", { case: "camelCase" }],
			},
		},
		{
			files: ["packages/backend/convex/**"],
			rules: {
				"unicorn/filename-case": ["error", { case: "camelCase" }],
			},
		},
	],
});
