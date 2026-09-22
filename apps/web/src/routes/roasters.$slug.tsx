import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The retired /roasters/$slug address (ADR-0011): redirects to the object's
 * new name before anything renders, so links in sent alert emails, saved
 * logs and judges' notes keep resolving.
 */
export const Route = createFileRoute("/roasters/$slug")({
	beforeLoad: ({ params }) => {
		throw redirect({
			params: { roaster: params.slug },
			replace: true,
			to: "/roaster/$roaster",
		});
	},
});
