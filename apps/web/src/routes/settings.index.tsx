import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * /settings has no page of its own yet; it lands on the one child that
 * exists, /settings/alerts (ADR-0011). /settings/appearance and
 * /settings/account arrive with their batches.
 */
const SettingsRedirect = () => {
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({ replace: true, to: "/settings/alerts" });
	}, [navigate]);
	return null;
};

export const Route = createFileRoute("/settings/")({
	component: SettingsRedirect,
});
