import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { PageTitle } from "@/components/page-title";
import { SignInCta } from "@/components/sign-in-cta";

type Me = NonNullable<FunctionReturnType<typeof api.users.getCurrentUser>>;

/**
 * The account form: the name the header shows and the handle the profile is
 * addressed at (ADR-0016). Saving is one call; the backend validates the
 * handle and keeps the previous one as a redirect.
 */
const AccountForm = ({ me }: { me: Me }) => {
	const [name, setName] = useState(me.name ?? "");
	const [handle, setHandle] = useState(me.handle ?? "");
	const [saving, setSaving] = useState(false);
	const update = useMutation(api.users.updateMe);
	const { signOut } = useAuthActions();

	const save = async () => {
		setSaving(true);
		try {
			await update({ handle, name });
			toast.success("Saved.");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Something went wrong."
			);
		}
		setSaving(false);
	};

	const signOutAndToast = async () => {
		try {
			await signOut();
			toast.success("Signed out.");
		} catch {
			toast.error("Sign out failed. Please try again.");
		}
	};

	return (
		<div className="mt-10 max-w-xl">
			<form
				className="flex flex-col gap-6"
				onSubmit={(event) => {
					event.preventDefault();
					void save();
				}}
			>
				<div>
					<label className="label-caps text-foreground" htmlFor="account-name">
						Name
					</label>
					<input
						autoComplete="name"
						className="focus-visible:border-foreground mt-2 h-11 w-full border-b bg-transparent text-sm outline-none md:text-[15px]"
						id="account-name"
						onChange={(event) => {
							setName(event.target.value);
						}}
						type="text"
						value={name}
					/>
				</div>
				<div>
					<label
						className="label-caps text-foreground"
						htmlFor="account-handle"
					>
						Handle
					</label>
					<div className="mt-2 flex items-center gap-1">
						{/* The host the page is served from, so a preview or local build shows its own address. */}
						<span className="text-muted-foreground text-sm md:text-[15px]">
							{window.location.host}/
						</span>
						<input
							autoCapitalize="off"
							autoComplete="off"
							autoCorrect="off"
							className="focus-visible:border-foreground h-11 w-full border-b bg-transparent text-sm outline-none md:text-[15px]"
							id="account-handle"
							onChange={(event) => {
								setHandle(event.target.value);
							}}
							spellCheck={false}
							type="text"
							value={handle}
						/>
					</div>
					<p className="text-muted-foreground mt-2 max-w-prose text-sm">
						Lowercase letters, digits and dashes. Links to your previous address
						follow you here.
					</p>
				</div>
				<div className="flex items-center gap-4">
					<button
						className="label-caps bg-foreground text-background inline-flex min-h-11 items-center px-5 transition-opacity hover:opacity-80"
						disabled={saving}
						type="submit"
					>
						Save
					</button>
				</div>
			</form>

			<div className="mt-16 md:mt-24">
				<button
					className="label-caps text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center hover:underline"
					onClick={() => {
						void signOutAndToast();
					}}
					type="button"
				>
					Sign out
				</button>
			</div>
		</div>
	);
};

/**
 * The account settings: name, handle, sign out (ADR-0016). The handle lives
 * in `nouveau.coffee/$handle`; changing it keeps the old one resolving
 * (ADR-0011).
 */
const AccountComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	const me = useQuery(api.users.getCurrentUser, isAuthenticated ? {} : "skip");

	if (isLoading) {
		return <Loader />;
	}
	// Signed out the query is skipped and `me` stays undefined, so the auth
	// check has to come before the loading check or the spinner never ends.
	if (!isAuthenticated || me === null) {
		return (
			<main>
				<div className="px-5 pt-10 md:px-10 md:pt-14">
					<PageTitle title="Account" />
					<p className="text-muted-foreground mt-4 max-w-prose text-sm">
						Sign in to edit your name and handle.
					</p>
					<div className="mt-6">
						<SignInCta />
					</div>
				</div>
			</main>
		);
	}
	if (me === undefined) {
		return <Loader />;
	}

	return (
		<main>
			<div className="px-5 pt-10 md:px-10 md:pt-14">
				<PageTitle title="Account" />
				<AccountForm me={me} />
			</div>
		</main>
	);
};

export const Route = createFileRoute("/settings/account")({
	component: AccountComponent,
});
