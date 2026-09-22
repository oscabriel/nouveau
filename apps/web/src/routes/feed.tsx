import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The retired /feed address (ADR-0011): redirects to /drops before anything
 * renders.
 */
export const Route = createFileRoute("/feed")({
	beforeLoad: () => {
		throw redirect({ replace: true, to: "/drops" });
	},
});
