import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

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
				className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm"
				onClick={() => {
					startSignIn();
				}}
				type="button"
			>
				Sign in with Google
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
				{ label: "Home", to: "/" },
				{ label: "Live feed", to: "/feed" },
				{ label: "Roasters", to: "/roasters" },
				{ label: "Watches", to: "/watches" },
			]
		: [
				{ label: "Home", to: "/" },
				{ label: "Roasters", to: "/roasters" },
			];

	return (
		<div>
			<div className="flex flex-row items-center justify-between px-2 py-1">
				<nav className="flex gap-4 text-lg">
					{links.map(({ to, label }) => (
						<Link key={to} to={to}>
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
