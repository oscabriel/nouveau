import { api } from "@nouveau/backend/convex/_generated/api";
import {
	createFileRoute,
	useNavigate,
	getRouteApi,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import { MissingPage, PageLoader } from "@/components/page";

const route = getRouteApi("/lots/$lotId");

/**
 * The retired /lots/$lotId address (ADR-0011): a real route that resolves
 * the row id to its (roaster slug, handle) pair and navigates on mount.
 * Unknown ids say so instead of redirecting.
 */
const LotRedirect = () => {
	const { lotId } = route.useParams();
	const address = useQuery(api.lots.addressById, { lotId });
	const navigate = useNavigate();
	useEffect(() => {
		if (address === undefined || address === null) {
			return;
		}
		void navigate({
			params: { lot: address.handle, roaster: address.roasterSlug },
			replace: true,
			to: "/roaster/$roaster/$lot",
		});
	}, [address, navigate]);
	if (address === undefined) {
		return <PageLoader />;
	}
	if (address === null) {
		return (
			<MissingPage linkLabel="Browse the roasters" to="/roasters">
				No lot at this address.
			</MissingPage>
		);
	}
	return null;
};

export const Route = createFileRoute("/lots/$lotId")({
	component: LotRedirect,
});
