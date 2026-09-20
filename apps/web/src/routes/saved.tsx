import { createFileRoute } from "@tanstack/react-router";

import { OwnProfileRedirect } from "@/components/own-profile-redirect";

/**
 * The retired /saved address (ADR-0011): the try list lives on the owner's
 * /$user view now, with unsave (ADR-0016).
 */
export const Route = createFileRoute("/saved")({
	component: OwnProfileRedirect,
});
