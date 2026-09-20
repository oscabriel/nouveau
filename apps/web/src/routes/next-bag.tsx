import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";

import Loader from "@/components/loader";
import { RecommendationForm } from "@/components/recommendation-form";
import { RecommendationResults } from "@/components/recommendation-results";
import { SignInCta } from "@/components/sign-in-cta";

const NextBag = () => {
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 30_000);
		return () => window.clearInterval(timer);
	}, []);
	const latest = useQuery(api.recommendations.latest, { now });
	const busy = latest?.status === "queued" || latest?.status === "running";
	return (
		<>
			<RecommendationForm busy={busy} />
			{latest === undefined ? (
				<Loader />
			) : (
				<RecommendationResults run={latest} />
			)}
		</>
	);
};

const NextBagContent = ({ authenticated }: { authenticated: boolean }) =>
	authenticated ? (
		<NextBag />
	) : (
		<div className="space-y-3">
			<p>
				Sign in to request a private shortlist. You do not need a coffee history
				to start.
			</p>
			<SignInCta />
		</div>
	);

const NextBagPage = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	return (
		<main className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-8">
				<h1 className="text-2xl font-semibold tracking-tight">
					Find my next bag
				</h1>
				<p className="text-muted-foreground mt-2 max-w-prose">
					One sentence is enough. The agent searches the catalog, reads pages,
					checks price and stock, and hands back a ranked shortlist — and you
					watch it work.
				</p>
				<Link
					className="mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
					to="/roasters"
				>
					Browse without AI
				</Link>
			</header>
			{isLoading ? (
				<Loader />
			) : (
				<NextBagContent authenticated={isAuthenticated} />
			)}
		</main>
	);
};

export const Route = createFileRoute("/next-bag")({ component: NextBagPage });
