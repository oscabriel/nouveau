import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * The retired /feed address (ADR-0011): navigates on mount to /drops.
 */
const FeedRedirect = () => {
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({ replace: true, to: "/drops" });
	}, [navigate]);
	return null;
};

export const Route = createFileRoute("/feed")({
	component: FeedRedirect,
});
