import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nouveau/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { useThemeControls } from "@/components/theme-switch";
import { navLinkClass } from "@/lib/ui";

/** The current route stays underlined so the nav doubles as a "you are here". */
const activeProps = { className: "underline" };

/** Caps menu item, same shape as the header links it drops from. */
const menuItemClass = `${navLinkClass} justify-start px-2 text-foreground`;

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
		<>
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
				Log in
			</button>
		</>
	);
};

/**
 * The handle's dropdown: settings, and the LIGHT / DARK theme pair (ADR-0012,
 * ADR-0013). Sign out is not here; it lives in /settings/account.
 */
const HandleMenu = ({ handle, path }: { handle: string; path: string }) => {
	const { resolved, choose } = useThemeControls();
	const themeItemClass = (active: boolean) =>
		`${menuItemClass} text-muted-foreground hover:text-foreground ${
			active ? "text-foreground" : ""
		}`;
	const sides = [
		{ label: "Light", target: "light" },
		{ label: "Dark", target: "dark" },
	] as const;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className={`${navLinkClass} max-w-40 truncate`}
				render={
					<Link activeProps={activeProps} params={{ user: path }} to="/$user" />
				}
			>
				{handle}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-40">
				{sides.map(({ label, target }) => (
					<DropdownMenuItem
						className={themeItemClass(resolved === target)}
						key={target}
						onClick={() => {
							choose(target);
						}}
					>
						{label}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className={menuItemClass}
					render={<Link to="/settings" />}
				>
					Settings
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * Site header: one row of caps labels, one nav, no bar and no rule. The left
 * side names what the site is about (Nouveau, Roasters, Drops), the right
 * names the people (Activity, then Log in or the handle). Below `md` the
 * right group wraps under the left instead of mounting twice. The handle
 * carries the dropdown, so settings and theme are one click deep.
 */
const Header = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
	// Lazily provisions the shared alert inbox on sign-in; the mutation is a
	// no-op when the inbox already exists. Lives here because the nav renders
	// exactly once.
	const ensureAlertInbox = useMutation(api.notifications.ensureAlertInbox);
	useEffect(() => {
		if (isAuthenticated) {
			void ensureAlertInbox();
		}
	}, [ensureAlertInbox, isAuthenticated]);

	const handle = me?.handle ?? me?.id ?? undefined;
	let authControl: React.ReactNode;
	if (isLoading) {
		authControl = null;
	} else if (isAuthenticated && handle !== undefined) {
		authControl = <HandleMenu handle={handle} path={handle} />;
	} else if (isAuthenticated) {
		// Signed in but the user record has not arrived; render nothing yet.
		authControl = null;
	} else {
		authControl = <SignInButton />;
	}
	return (
		<header className="px-5 pt-3 md:px-10 md:pt-4">
			<nav
				aria-label="Primary"
				className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-0 md:gap-x-5"
			>
				<div className="flex flex-wrap items-center gap-x-4 md:gap-x-5">
					<Link
						activeOptions={{ exact: true }}
						activeProps={activeProps}
						className={`${navLinkClass} font-semibold`}
						to="/"
					>
						Nouveau
					</Link>
					<Link
						activeProps={activeProps}
						className={navLinkClass}
						to="/roasters"
					>
						Roasters
					</Link>
					<Link activeProps={activeProps} className={navLinkClass} to="/drops">
						Drops
					</Link>
				</div>
				<div className="flex flex-wrap items-center gap-x-4 md:gap-x-5">
					<Link
						activeProps={activeProps}
						className={navLinkClass}
						to="/activity"
					>
						Activity
					</Link>
					{authControl}
				</div>
			</nav>
		</header>
	);
};

export default Header;
