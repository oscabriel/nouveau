import { Toaster } from "@nouveau/ui/components/sonner";
import {
	HeadContent,
	Outlet,
	createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { Header } from "@/components/header";
import { NextBagSheet } from "@/components/next-bag-sheet";
import { MissingPage } from "@/components/page";
import { SiteFooter } from "@/components/site-footer";
import { SiteTools } from "@/components/site-tools";
import { ThemeProvider } from "@/components/theme-provider";
import { validateNextBagSearch } from "@/lib/next-bag-search";

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
			<NextBagSheet />
			<Toaster richColors />
		</ThemeProvider>
		<SiteTools />
		<TanStackRouterDevtools position="bottom-left" />
	</>
);

/**
 * Unknown addresses (anything deeper than one segment; `/$user` catches the
 * rest) read like every other dead end on the site. Rendered inside the
 * root layout, so the header and footer stay.
 */
const NotFound = () => (
	<MissingPage linkLabel="Back to the index" to="/">
		Nothing at this address.
	</MissingPage>
);

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	notFoundComponent: NotFound,
	validateSearch: validateNextBagSearch,
	head: () => ({
		meta: [
			{
				title: "Nouveau | Don't miss your next cup.",
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
