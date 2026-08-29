import { env } from "@nouveau/env/web";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { ConvexReactClient, ConvexProvider } from "convex/react";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { routeTree } from "./routeTree.gen";

const convex = new ConvexReactClient(env.VITE_CONVEX_URL);

const router = createRouter({
	Wrap: ({ children }: { children: React.ReactNode }) => (
		<ConvexProvider client={convex}>{children}</ConvexProvider>
	),
	context: {},
	defaultPendingComponent: () => <Loader />,
	defaultPreload: "intent",
	routeTree,
	scrollRestoration: true,
});

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
