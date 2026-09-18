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
export const navLinkClass =
	"label-caps inline-flex min-h-11 items-center hover:underline";

/** The current route stays underlined so the nav doubles as a "you are here". */
const activeProps = { className: "underline" };

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

/**
 * Signed-in utilities: the private destinations and the account controls.
 * Grey so the primary nav stays the loudest row; each link goes ink on hover.
 */
const Utilities = () => {
	const { signOut } = useAuthActions();
	const user = useQuery(api.users.getCurrentUser);
	const endSession = async () => {
		try {
			await signOut();
		} catch {
			// A failed sign-out leaves the session as-is; the UI stays truthful.
		}
	};
	const utilityClass = `${navLinkClass} text-muted-foreground hover:text-foreground`;

	return (
		<nav
			aria-label="Your account"
			className="flex flex-wrap items-center gap-x-4 md:gap-x-5"
		>
			<Link activeProps={activeProps} className={utilityClass} to="/watches">
				Watches
			</Link>
			<Link activeProps={activeProps} className={utilityClass} to="/saved">
				Saved
			</Link>
			{user !== undefined && user !== null && (
				<Link
					activeProps={activeProps}
					className={`${utilityClass} max-w-40 truncate`}
					params={{ userId: user.id }}
					to="/profile/$userId"
				>
					{user.name ?? "Profile"}
				</Link>
			)}
			<button
				className={utilityClass}
				onClick={() => {
					endSession();
				}}
				type="button"
			>
				Sign out
			</button>
		</nav>
	);
};

/** Right side of the row: utilities from `md` when signed in, else Sign in. */
const AuthControls = ({
	isAuthenticated,
	isLoading,
}: {
	isAuthenticated: boolean;
	isLoading: boolean;
}) => {
	if (isLoading) {
		return null;
	}
	if (isAuthenticated) {
		return (
			<div className="hidden md:block">
				<Utilities />
			</div>
		);
	}
	return <SignInButton />;
};

/**
 * Site header: tracked caps labels, wordmark first, no bar and no rule. The
 * public destinations sit beside the wordmark. Signed in, the private ones
 * (Watches, Saved, profile, sign out) join the right side from `md`; below
 * that they take a second row so nothing wraps mid-list at 390px.
 */
const Header = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	// Lazily provisions the shared alert inbox on sign-in; the mutation is a
	// no-op when the inbox already exists. Lives here, not in Utilities, which
	// renders twice (one copy per breakpoint).
	const ensureAlertInbox = useMutation(api.notifications.ensureAlertInbox);
	useEffect(() => {
		if (isAuthenticated) {
			void ensureAlertInbox();
		}
	}, [ensureAlertInbox, isAuthenticated]);
	const links = [
		{ label: "Roasters", to: "/roasters" },
		{ label: "Activity", to: "/activity" },
		...(isAuthenticated ? [{ label: "Feed", to: "/feed" }] : []),
	];

	return (
		<header className="px-5 pt-3 md:px-10 md:pt-4">
			<div className="flex w-full flex-row items-center justify-between gap-4">
				<nav
					aria-label="Primary"
					className="flex flex-wrap items-center gap-x-4 md:gap-x-5"
				>
					<Link
						activeOptions={{ exact: true }}
						activeProps={activeProps}
						className={`${navLinkClass} font-semibold`}
						to="/"
					>
						Nouveau
					</Link>
					{links.map(({ to, label }) => (
						<Link
							activeProps={activeProps}
							className={navLinkClass}
							key={to}
							to={to}
						>
							{label}
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-4 md:gap-5">
					<AuthControls
						isAuthenticated={isAuthenticated}
						isLoading={isLoading}
					/>
					<ModeToggle />
				</div>
			</div>
			{isAuthenticated && (
				<div className="md:hidden">
					<Utilities />
				</div>
			)}
		</header>
	);
};

export default Header;
