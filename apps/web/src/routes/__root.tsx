import { Toaster } from "@nouveau/ui/components/sonner";
import {
	HeadContent,
	Outlet,
	createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import Header from "@/components/header";
import { SiteFooter } from "@/components/site-footer";
import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export type RouterAppContext = Record<string, never>;

const RootComponent = () => (
	<>
		<HeadContent />
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			disableTransitionOnChange
			storageKey="nouveau-theme"
		>
			<div className="grid min-h-svh grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
				<Header />
				<Outlet />
				<SiteFooter />
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
				title: "Nouveau — know the moment coffee drops",
			},
			{
				name: "description",
				content:
					"Nouveau watches specialty roasters' shops around the clock and tells you when a new lot lands, a sold-out one comes back, or a price drops.",
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
