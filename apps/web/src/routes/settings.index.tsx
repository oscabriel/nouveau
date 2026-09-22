import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * /settings lands on the first tab, Account (owner, 2026-09-21): the page
 * that edits the name, handle and weight unit. The tabs live in the
 * settings layout route.
 */
export const Route = createFileRoute("/settings/")({
	beforeLoad: () => {
		throw redirect({ replace: true, to: "/settings/account" });
	},
});
