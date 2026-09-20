import {
	createFileRoute,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * The retired /roasters/$slug address (ADR-0011): a real route that
 * navigates on mount to the object's new name, so links in sent alert
 * emails, saved logs and judges' notes keep resolving.
 */
const RoasterRedirect = () => {
	const { slug } = useParams({ from: "/roasters/$slug" });
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({
			params: { roaster: slug },
			replace: true,
			to: "/roaster/$roaster",
		});
	}, [navigate, slug]);
	return null;
};

export const Route = createFileRoute("/roasters/$slug")({
	component: RoasterRedirect,
});
