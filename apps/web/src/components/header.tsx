import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nouveau/ui/components/dropdown-menu";
import { Link, useLocation } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";

import { THEME_SIDES, useThemeControls } from "@/components/theme-switch";
import { navLinkClass } from "@/lib/ui";

/** The current route stays underlined so the nav doubles as a "you are here". */
const activeProps = { className: "underline" };

/** Caps menu item, same shape as the header links it drops from. */
const menuItemClass = `${navLinkClass} justify-start px-2 text-foreground`;

/**
 * The label is the person, not the data: the first word of their Google
 * account name (ADR-0012 amendment). Fallbacks exist for rows that lack a
 * name; the users-document id never renders.
 */
const firstName = (name: string | undefined): string | undefined =>
	name?.trim().split(/\s+/u)[0];

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
 * The label's dropdown: profile first, the LIGHT / DARK theme pair
 * (ADR-0013), settings, and sign out at the bottom (ADR-0012, amended). The
 * label is a button, not a link: a link trigger navigated on the same click
 * that opened the menu, so theme and sign out were unreachable in place. The
 * profile item goes to `/$user` by handle-or-id path (ADR-0011); the label
 * is display only.
 */
const HandleMenu = ({ label, path }: { label: string; path: string }) => {
	const { resolved, choose } = useThemeControls();
	const { signOut } = useAuthActions();
	const onOwnProfile = useLocation({
		select: (location) => location.pathname === `/${path}`,
	});
	const themeItemClass = (active: boolean) =>
		`${menuItemClass} text-muted-foreground hover:text-foreground ${
			active ? "text-foreground" : ""
		}`;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className={`${navLinkClass} max-w-40 truncate ${
					onOwnProfile ? activeProps.className : ""
				}`}
			>
				{label}
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-40">
				<DropdownMenuItem
					className={menuItemClass}
					render={<Link params={{ user: path }} to="/$user" />}
				>
					Profile
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				{THEME_SIDES.map((side) => (
					<DropdownMenuItem
						className={themeItemClass(resolved === side.target)}
						key={side.target}
						onClick={() => {
							choose(side.target);
						}}
					>
						{side.label}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className={menuItemClass}
					render={<Link to="/settings" />}
				>
					Settings
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className={menuItemClass}
					onSelect={() => {
						void signOut();
					}}
				>
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/**
 * Site header: one row of caps labels, one nav, no bar and no rule. The left
 * side names what the site is about (Nouveau, Roasters, Drops), the right
 * names the people (Activity, then Log in or the person's first name). Below
 * `md` the right group wraps under the left instead of mounting twice. The
 * name carries the dropdown, so settings, theme and sign out are one click
 * deep.
 */
const Header = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");
	// Lazily provisions the shared alert inbox on sign-in; the mutation is a
	// no-op when the inbox already exists. Lives here because the nav renders
	// exactly once.
	const ensureAlertInbox = useMutation(api.notifications.ensureAlertInbox);
	const ensureHandle = useMutation(api.users.ensureMyHandle);
	useEffect(() => {
		if (isAuthenticated) {
			void ensureAlertInbox();
			// The handle backfill for rows that predate ADR-0011 (the id never
			// renders; the first name does), a no-op once a handle exists.
			void ensureHandle();
		}
	}, [ensureAlertInbox, ensureHandle, isAuthenticated]);

	// The link resolves by handle-or-id path, so a row whose handle has not
	// landed yet still reaches its profile through the legacy id (ADR-0011).
	const path = me?.handle ?? me?.id ?? undefined;
	const label = firstName(me?.name) ?? me?.handle ?? "Account";
	let authControl: React.ReactNode;
	if (isLoading) {
		authControl = null;
	} else if (isAuthenticated && path !== undefined) {
		authControl = <HandleMenu label={label} path={path} />;
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
				className="flex flex-col items-start gap-y-0 md:w-full md:flex-row md:items-center md:justify-between md:gap-x-5"
			>
				<div className="flex items-center gap-x-4 md:gap-x-5">
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
				<div className="flex items-center gap-x-4 md:gap-x-5">
					<Link
						activeProps={activeProps}
						className={navLinkClass}
						to="/activity"
					>
						Activity
					</Link>
					<Link activeProps={activeProps} className={navLinkClass} to="/about">
						Learn More
					</Link>
					{authControl}
				</div>
			</nav>
		</header>
	);
};

export default Header;
