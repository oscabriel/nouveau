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

/** Caps text link, 44px tall hit area, underline on hover. */
const navLinkClass =
	"label-caps inline-flex min-h-11 items-center hover:underline";

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
		<div className="flex items-center gap-4">
			{flowError !== null && (
				<span className="text-destructive text-sm" role="alert">
					{flowError.message ?? "Sign-in failed. Please try again."}
				</span>
			)}
			<button
				className={navLinkClass}
				onClick={() => {
					startSignIn();
				}}
				type="button"
			>
				Sign in
			</button>
		</div>
	);
};

const SignOutButton = () => {
	const { signOut } = useAuthActions();
	const user = useQuery(api.users.getCurrentUser);
	// Lazily provisions the shared alert inbox on sign-in; the mutation is a
	// no-op when the inbox already exists.
	const ensureAlertInbox = useMutation(api.notifications.ensureAlertInbox);
	useEffect(() => {
		void ensureAlertInbox();
	}, [ensureAlertInbox]);
	const endSession = async () => {
		try {
			await signOut();
		} catch {
			// A failed sign-out leaves the session as-is; the UI stays truthful.
		}
	};

	return (
		<div className="flex items-center gap-4 md:gap-5">
			{user !== undefined && user !== null && (
				<Link
					className={navLinkClass}
					params={{ userId: user.id }}
					to="/profile/$userId"
				>
					{user.name ?? "Profile"}
				</Link>
			)}
			<button
				className={navLinkClass}
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

/**
 * Site header: one row of tracked caps labels, wordmark first. No bar, no
 * rule under it; the page's own hero carries the weight below.
 */
const Header = () => {
	const { isAuthenticated } = useConvexAuth();
	const links = isAuthenticated
		? [
				{ label: "Feed", to: "/feed" },
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
		<header className="flex w-full flex-row items-center justify-between gap-4 px-5 pt-3 md:px-10 md:pt-4">
			<nav className="flex flex-wrap items-center gap-x-4 md:gap-x-5">
				<Link className={`${navLinkClass} font-semibold`} to="/">
					Nouveau
				</Link>
				{links.map(({ to, label }) => (
					<Link className={navLinkClass} key={to} to={to}>
						{label}
					</Link>
				))}
			</nav>
			<div className="flex items-center gap-4 md:gap-5">
				<AuthControls />
				<ModeToggle />
			</div>
		</header>
	);
};

export default Header;
