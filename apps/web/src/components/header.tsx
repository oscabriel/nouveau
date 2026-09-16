import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { ModeToggle } from "./mode-toggle";

const SignInButton = () => {
	const { signInGoogle } = useSignInWithGoogle(api.auth);
	const { flowError } = useOauth();
	const startSignIn = async () => {
		try {
			await signInGoogle();
		} catch {
			// The failure is surfaced later through flowError.
		}
	};
	return (
		<div className="flex items-center gap-2">
			<button
				className="bg-primary text-primary-foreground inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-opacity hover:opacity-90 sm:px-3.5"
				onClick={() => {
					startSignIn();
				}}
				type="button"
			>
				<span className="sm:hidden">Sign in</span>
				<span className="hidden sm:inline">Sign in with Google</span>
			</button>
			{flowError !== null && (
				<span className="text-destructive text-sm" role="alert">
					{flowError.message ?? "Sign-in failed. Please try again."}
				</span>
			)}
		</div>
	);
};

const SignOutButton = () => {
	const { signOut } = useAuthActions();
	const user = useQuery(api.users.getCurrentUser);
	// Backfills the per-user alert inbox (§8.3) for sign-ins that predate it;
	// the mutation is a no-op when the inbox already exists.
	const ensureInbox = useMutation(api.notifications.ensureInbox);
	useEffect(() => {
		void ensureInbox();
	}, [ensureInbox]);
	const endSession = async () => {
		try {
			await signOut();
		} catch {
			// A failed sign-out leaves the session as-is; the UI stays truthful.
		}
	};

	return (
		<div className="flex items-center gap-2">
			<span className="text-muted-foreground text-sm">
				{user?.name ?? "Signed in"}
			</span>
			{user !== undefined && user !== null && (
				<Link
					className="text-sm hover:underline"
					params={{ userId: user.id }}
					to="/profile/$userId"
				>
					Profile
				</Link>
			)}
			<button
				className="rounded-md border px-3 py-1.5 text-sm"
				onClick={() => {
					endSession();
				}}
				type="button"
			>
				Sign out
			</button>
		</div>
	);
};

const AuthControls = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();

	if (isLoading) {
		return null;
	}
	return isAuthenticated ? <SignOutButton /> : <SignInButton />;
};

const Header = () => {
	const { isAuthenticated } = useConvexAuth();
	const links = isAuthenticated
		? [
				{ label: "Live feed", to: "/feed" },
				{ label: "Activity", to: "/activity" },
				{ label: "Roasters", to: "/roasters" },
				{ label: "Watches", to: "/watches" },
				{ label: "Saved", to: "/saved" },
			]
		: [
				{ label: "Roasters", to: "/roasters" },
				{ label: "Activity", to: "/activity" },
			];

	return (
		<div>
			<div className="mx-auto flex w-full max-w-6xl flex-row items-center justify-between px-4 py-2.5 md:px-6">
				<nav className="flex items-center gap-4 text-base md:gap-5">
					<Link className="font-semibold tracking-tight" to="/">
						Nouveau
					</Link>
					{links.map(({ to, label }) => (
						<Link
							className="text-muted-foreground hover:text-foreground text-sm hover:underline"
							key={to}
							to={to}
						>
							{label}
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-2">
					<AuthControls />
					<ModeToggle />
				</div>
			</div>
			<hr />
		</div>
	);
};

export default Header;
