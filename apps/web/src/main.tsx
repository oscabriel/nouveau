import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import ReactDOM from "react-dom/client";

import { env } from "@/lib/env";

import { Loader } from "./components/loader";
import { routeTree } from "./routeTree.gen";

const convex = new ConvexReactClient(env.VITE_CONVEX_URL);

const router = createRouter({
	Wrap: ({ children }: { children: React.ReactNode }) => (
		<ConvexAuthProvider client={convex} api={api.auth}>
			{children}
		</ConvexAuthProvider>
	),
	context: {},
	defaultPendingComponent: () => <Loader />,
	defaultPreload: "intent",
	routeTree,
	scrollRestoration: true,
});

/**
 * Load every route's code once the first page is idle. Route chunks are
 * hashed per build and the static host serves only the current build, so a
 * tab opened before a deploy fails its next lazy import and the router
 * reloads the page (the "random reloads"). With all chunks in the tab, a
 * later deploy costs nothing until the visitor refreshes on their own. The
 * whole set is under 250 KB and shares the main chunk's dependencies.
 */
const warmRouteChunks = async () => {
	// allSettled: a chunk that fails to warm loads again on navigation.
	await Promise.allSettled(
		Object.values(router.routesById).map((route) =>
			router.loadRouteChunk(route)
		)
	);
};
if (typeof window.requestIdleCallback === "function") {
	window.requestIdleCallback(
		() => {
			void warmRouteChunks();
		},
		{ timeout: 5000 }
	);
} else {
	window.setTimeout(() => {
		void warmRouteChunks();
	}, 2000);
}

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.querySelector("#app");

if (!rootElement) {
	throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(<RouterProvider router={router} />);
}
