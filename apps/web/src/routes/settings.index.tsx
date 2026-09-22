import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * /settings lands on the first tab, Account (owner, 2026-09-21): the page
 * that edits the name, handle and weight unit. The tabs live in the
 * settings layout route.
 */
const SettingsRedirect = () => {
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({ replace: true, to: "/settings/account" });
	}, [navigate]);
	return null;
};

export const Route = createFileRoute("/settings/")({
	component: SettingsRedirect,
});
