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

import { useGoogleSignIn } from "@/components/sign-in-cta";
import { THEME_SIDES, useThemeControls } from "@/components/theme-switch";
import { navLinkClass } from "@/lib/ui";

/** The current route stays underlined so the nav doubles as a "you are here". */
const activeProps = { className: "underline" };

/**
 * Caps menu item, same shape as the header links it drops from. `flex w-full`
 * comes after `navLinkClass` on purpose: its `inline-flex` shrank the item to
 * the word, so the hover and click region stopped where the label did.
 */
const menuItemClass = `${navLinkClass} flex w-full justify-start px-2 text-foreground`;

/**
 * The label is the person, not the data: the first word of their Google
 * account name (ADR-0012 amendment). Fallbacks exist for rows that lack a
 * name; the users-document id never renders.
 */
const firstName = (name: string | undefined): string | undefined =>
	name?.trim().split(/\s+/u)[0];

const SignInButton = () => {
	const { error, start } = useGoogleSignIn();
	return (
		<>
			{error !== null && (
				<span className="text-destructive text-sm" role="alert">
					{error}
				</span>
			)}
			<button className={navLinkClass} onClick={start} type="button">
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
						aria-checked={resolved === side.target}
						className={themeItemClass(resolved === side.target)}
						key={side.target}
						role="menuitemradio"
						onClick={() => {
							choose(side.target);
						}}
					>
						{/* The dot means selected, as on every DotToggle. */}
						<span
							aria-hidden
							className={`inline-block size-2 rounded-full bg-current ${
								resolved === side.target ? "opacity-100" : "opacity-30"
							}`}
						/>
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
					onClick={() => {
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
 * names the people (Activity, About, then Log in or the person's first name).
 * Below `md` the two groups become two columns, left links stacked at the
 * left edge and right links stacked at the right edge (owner's mock,
 * 2026-09-21), still one nav mounted once. The
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
				className="flex w-full items-start justify-between gap-x-5 md:items-center"
			>
				<div className="flex flex-col items-start md:flex-row md:items-center md:gap-x-5">
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
				<div className="flex flex-col items-end md:flex-row md:items-center md:gap-x-5">
					<Link
						activeProps={activeProps}
						className={navLinkClass}
						to="/activity"
					>
						Activity
					</Link>
					<Link activeProps={activeProps} className={navLinkClass} to="/about">
						About
					</Link>
					{/* The person leads the column on mobile (owner's mock), trails the row from md. */}
					<div className="order-first flex items-center md:order-none">
						{authControl}
					</div>
				</div>
			</nav>
		</header>
	);
};

export default Header;
