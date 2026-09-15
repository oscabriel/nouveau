import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Button } from "@nouveau/ui/components/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { usePaginatedQuery } from "convex/react";

import Loader from "@/components/loader";
import { SavedCoffeeCard } from "@/components/saved-coffee-card";
import { SignInCta } from "@/components/sign-in-cta";

const PAGE_SIZE = 20;

const SignedOutSaved = () => (
	<div className="container mx-auto max-w-3xl px-4 py-8">
		<h1 className="mb-2 text-2xl font-semibold">Want to try</h1>
		<p className="text-muted-foreground mb-4 max-w-prose text-sm">
			Sign in to save lots you want to try. Saves are private to you.
		</p>
		<SignInCta />
	</div>
);

const SavedComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const pages = usePaginatedQuery(
		api.savedCoffees.listMine,
		isAuthenticated ? {} : "skip",
		{ initialNumItems: PAGE_SIZE }
	);

	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return <SignedOutSaved />;
	}
	if (pages.status === "LoadingFirstPage") {
		return <Loader />;
	}

	return (
		<div className="container mx-auto max-w-3xl px-4 py-8">
			<header className="mb-6 flex items-baseline justify-between gap-4">
				<h1 className="text-2xl font-semibold">Want to try</h1>
				<Link className="text-sm hover:underline" to="/next-bag">
					Find my next bag
				</Link>
			</header>
			<p className="text-muted-foreground mb-4 max-w-prose text-sm">
				Lots you saved. Only you can see this list; saving does not email you or
				watch the roaster.
			</p>
			{pages.results.length === 0 ? (
				<p className="text-muted-foreground py-8 text-sm">
					Nothing saved yet. Save a lot from a shortlist, a lot page, or
					someone&apos;s log.
				</p>
			) : (
				<div className="divide-y">
					{pages.results.map((item) => (
						<SavedCoffeeCard item={item} key={item.savedId} />
					))}
				</div>
			)}
			{pages.status === "CanLoadMore" && (
				<Button
					className="mt-3"
					onClick={() => {
						pages.loadMore(PAGE_SIZE);
					}}
					size="sm"
					variant="ghost"
				>
					Load more
				</Button>
			)}
		</div>
	);
};

export const Route = createFileRoute("/saved")({
	component: SavedComponent,
});
