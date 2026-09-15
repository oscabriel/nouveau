import { defineConfig } from "vitest/config";

// Pure-function tests only; vite.config.ts is skipped so the router plugin
// and Tailwind never run under vitest.
export default defineConfig({
	resolve: { tsconfigPaths: true },
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
