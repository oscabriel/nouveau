import { api } from "@nouveau/backend/convex/_generated/api";
import {
	createFileRoute,
	Link,
	useNavigate,
	useParams,
} from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect } from "react";

import Loader from "@/components/loader";

/**
 * The retired /lots/$lotId address (ADR-0011): a real route that resolves
 * the row id to its (roaster slug, handle) pair and navigates on mount.
 * Unknown ids say so instead of redirecting.
 */
const LotRedirect = () => {
	const { lotId } = useParams({ from: "/lots/$lotId" });
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
		return <Loader />;
	}
	if (address === null) {
		return (
			<p className="text-muted-foreground px-5 py-24 text-center text-[15px] md:px-10">
				No lot at this address.{" "}
				<Link className="text-foreground underline" to="/roasters">
					Browse the roasters
				</Link>
				.
			</p>
		);
	}
	return null;
};

export const Route = createFileRoute("/lots/$lotId")({
	component: LotRedirect,
});
