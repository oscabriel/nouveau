import {
	createFileRoute,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * The retired /profile/$userId address (ADR-0011): navigates on mount to
 * /$user, passing the raw address. `logs.profile` resolves legacy user ids
 * the same way it resolves retired handles, and the profile adopts the
 * canonical handle into the URL from there.
 */
const ProfileRedirect = () => {
	const { userId } = useParams({ from: "/profile/$userId" });
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({
			params: { user: userId },
			replace: true,
			to: "/$user",
		});
	}, [navigate, userId]);
	return null;
};

export const Route = createFileRoute("/profile/$userId")({
	component: ProfileRedirect,
});
