import { createFileRoute, Link, Outlet } from "@tanstack/react-router";

import { Page, PageTitle } from "@/components/page";
import { navLinkClass } from "@/lib/ui";

/** The settings tabs, in the order the row lists them. */
const TABS = [
	{ label: "Account", to: "/settings/account" },
	{ label: "Alerts", to: "/settings/alerts" },
	{ label: "Appearance", to: "/settings/appearance" },
] as const;

/**
 * The settings shell (owner, 2026-09-21): one title, a row of caps tabs
 * under it like the header's links, the current tab underlined, and the
 * chosen page below. Account edits the name, handle and weight unit; Alerts
 * shows the inbox and mutes; Appearance holds the theme switch's second
 * mount (ADR-0013).
 */
const SettingsLayout = () => (
	<Page>
		<PageTitle title="Settings" />
		<nav
			aria-label="Settings"
			className="mt-4 flex items-center gap-x-4 md:gap-x-5"
		>
			{TABS.map((tab) => (
				<Link
					activeProps={{ className: "underline" }}
					className={navLinkClass}
					key={tab.to}
					to={tab.to}
				>
					{tab.label}
				</Link>
			))}
		</nav>
		<Outlet />
	</Page>
);

export const Route = createFileRoute("/settings")({
	component: SettingsLayout,
	head: () => ({ meta: [{ title: "Settings | Nouveau" }] }),
});
