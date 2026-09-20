import { createFileRoute } from "@tanstack/react-router";

import { OwnProfileRedirect } from "@/components/own-profile-redirect";

/**
 * The retired /watches address (ADR-0011): the watches live on the owner's
 * /$user view now, with health and mute (ADR-0016).
 */
export const Route = createFileRoute("/watches")({
	component: OwnProfileRedirect,
});
