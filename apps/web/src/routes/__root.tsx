import { Toaster } from "@nouveau/ui/components/sonner";
import {
	HeadContent,
	Outlet,
	createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import Header from "@/components/header";
import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export type RouterAppContext = Record<string, never>;

const RootComponent = () => (
	<>
		<HeadContent />
		<ThemeProvider
			attribute="class"
			defaultTheme="dark"
			disableTransitionOnChange
			storageKey="vite-ui-theme"
		>
			<div className="grid h-svh grid-rows-[auto_1fr]">
				<Header />
				<Outlet />
			</div>
			<Toaster richColors />
		</ThemeProvider>
		<TanStackRouterDevtools position="bottom-left" />
	</>
);

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: "nouveau",
			},
			{
				name: "description",
				content: "nouveau is a web application",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
			},
		],
	}),
});
