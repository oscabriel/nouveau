import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
	// Stable HTTPS dev domain served by the local Caddy reverse proxy.
	// Lives only in the gitignored .env, never in tracked code.
	const caddyDevHost = loadEnv(mode, process.cwd(), "").CADDY_DEV_HOST;

	return {
		plugins: [
			tailwindcss(),
			tanstackRouter({
				autoCodeSplitting: true,
				target: "react",
			}),
			react(),
		],
		resolve: {
			tsconfigPaths: true,
		},
		server: {
			allowedHosts: caddyDevHost
				? ["localhost", "127.0.0.1", caddyDevHost]
				: undefined,
			hmr: caddyDevHost
				? { clientPort: 443, host: caddyDevHost, protocol: "wss" }
				: undefined,
			host: "127.0.0.1",
			port: 3004,
			strictPort: true,
		},
	};
});
