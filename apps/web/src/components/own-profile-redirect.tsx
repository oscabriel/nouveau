import { api } from "@nouveau/backend/convex/_generated/api";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import Loader from "@/components/loader";

/**
 * The retired private routes (/watches, /saved) land on the owner's /$user
 * view, where that content now lives (ADR-0011, ADR-0016). Signed out,
 * home; there is nothing private to show.
 */
export const OwnProfileRedirect = () => {
	const me = useQuery(api.users.getCurrentUser);
	const navigate = useNavigate();
	useEffect(() => {
		if (me === undefined) {
			return;
		}
		if (me === null) {
			void navigate({ replace: true, to: "/" });
			return;
		}
		void navigate({
			params: { user: me.handle ?? me.id },
			replace: true,
			to: "/$user",
		});
	}, [me, navigate]);
	return <Loader />;
};
