import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { WeightUnit } from "@nouveau/backend/convex/weightUnit";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { toast } from "sonner";

import { DotToggle } from "@/components/dot-toggle";
import Loader from "@/components/loader";
import { SignInPrompt } from "@/components/sign-in-cta";
import { describeMutationError } from "@/lib/errors";
import {
	hairlineInputClass,
	primaryButtonClass,
	quietLinkClass,
} from "@/lib/ui";

type Me = NonNullable<FunctionReturnType<typeof api.users.getCurrentUser>>;

/** The two display units as the form names them. */
const WEIGHT_UNIT_OPTIONS: { label: string; value: WeightUnit }[] = [
	{ label: "Grams", value: "metric" },
	{ label: "Ounces", value: "imperial" },
];

/**
 * The account form: the name the header shows and the handle the profile is
 * addressed at (ADR-0016). Saving is one call; the backend validates the
 * handle and keeps the previous one as a redirect.
 */
const AccountForm = ({ me }: { me: Me }) => {
	const [name, setName] = useState(me.name ?? "");
	const [handle, setHandle] = useState(me.handle ?? "");
	const [weightUnit, setWeightUnit] = useState<WeightUnit>(me.weightUnit);
	const [saving, setSaving] = useState(false);
	const update = useMutation(api.users.updateMe);
	const { signOut } = useAuthActions();

	const save = async () => {
		setSaving(true);
		try {
			await update({ handle, name, weightUnit });
			toast.success("Saved.");
		} catch (error) {
			toast.error(describeMutationError(error, "Could not save."));
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
						className={`${hairlineInputClass} mt-2 w-full text-sm md:text-[15px]`}
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
							className={`${hairlineInputClass} w-full text-sm md:text-[15px]`}
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
				<fieldset>
					<legend className="label-caps text-foreground">Weights</legend>
					{/* Display only: every bag is stored in grams (weight.ts). */}
					<div className="mt-2 flex items-center gap-x-5">
						{WEIGHT_UNIT_OPTIONS.map((option) => (
							<DotToggle
								key={option.value}
								onClick={() => {
									setWeightUnit(option.value);
								}}
								pressed={weightUnit === option.value}
							>
								{option.label}
							</DotToggle>
						))}
					</div>
				</fieldset>
				<div className="flex items-center gap-4">
					<button
						className={primaryButtonClass}
						disabled={saving}
						type="submit"
					>
						Save
					</button>
				</div>
			</form>

			<div className="mt-16 md:mt-24">
				<button
					className={quietLinkClass}
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
 * The account tab: name, handle, weight unit, sign out (ADR-0016). The
 * handle lives in `nouveau.coffee/$handle`; changing it keeps the old one
 * resolving (ADR-0011). The title and tabs come from the /settings layout.
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
			<SignInPrompt className="mt-10">
				Sign in to edit your name, handle and units.
			</SignInPrompt>
		);
	}
	if (me === undefined) {
		return <Loader />;
	}

	return <AccountForm me={me} />;
};

export const Route = createFileRoute("/settings/account")({
	component: AccountComponent,
});
