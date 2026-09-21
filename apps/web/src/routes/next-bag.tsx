import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Find my next bag is a pane, not a page (ADR-0017, amendment of
 * 2026-09-20). The old address still works: it opens the pane over the
 * landing.
 */
export const Route = createFileRoute("/next-bag")({
	beforeLoad: () => {
		throw redirect({ search: { bag: true }, to: "/" });
	},
});
