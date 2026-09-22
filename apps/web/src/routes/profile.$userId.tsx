import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The retired /profile/$userId address (ADR-0011): redirects to /$user with
 * the raw address before anything renders. `logs.profile` resolves legacy
 * user ids the same way it resolves retired handles, and the profile
 * adopts the canonical handle into the URL from there.
 */
export const Route = createFileRoute("/profile/$userId")({
	beforeLoad: ({ params }) => {
		throw redirect({
			params: { user: params.userId },
			replace: true,
			to: "/$user",
		});
	},
});
