import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { useRouter } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { useEffect, useRef } from "react";

import { buildSiteTools } from "@/lib/site-tools";
import { modelContextOf, registerSiteTools } from "@/lib/webmcp";

/**
 * Registers Nouveau's site tools on `document.modelContext` for the life of
 * the app (mounted once from the root route). Renders nothing. A browser
 * without the API gets the ordinary site. Handlers read the router and the
 * sign-in state when called, so tools registered on one page answer for
 * whichever page the user is on by the time an agent calls them.
 */
export const SiteTools = () => {
	const convex = useConvex();
	const router = useRouter();
	const auth = useConvexAuth();
	const authRef = useRef(auth);
	useEffect(() => {
		authRef.current = auth;
	}, [auth]);

	useEffect(() => {
		const modelContext = modelContextOf(document);
		if (modelContext === null) {
			return;
		}
		const controller = new AbortController();
		const tools = buildSiteTools({
			auth: () => authRef.current,
			findLots: (args) => convex.query(api.catalogSearch.findAvailable, args),
			getLot: (address) => convex.query(api.lots.get, address),
			listSaved: (paginationOpts) =>
				convex.query(api.savedCoffees.listMine, { paginationOpts }),
			navigate: (href) => router.navigate({ href }),
			origin: window.location.origin,
			pathname: () => router.state.location.pathname,
			saveLot: (productId) =>
				convex.mutation(api.savedCoffees.save, { productId }),
			savedLotIds: () => convex.query(api.savedCoffees.mySavedProductIds, {}),
			unsaveLot: (productId) =>
				convex.mutation(api.savedCoffees.unsave, { productId }),
		});
		void registerSiteTools(modelContext, tools, controller.signal);
		return () => {
			controller.abort();
		};
	}, [convex, router]);

	return null;
};
