import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import type { ReactNode } from "react";

import { primaryButtonClass } from "@/lib/ui";

/**
 * The Google flow behind every sign-in control: start it, and read the
 * error the OAuth provider reports after the redirect. Rejections from
 * `signInGoogle` itself surface through `flowError`, so the start swallows
 * them.
 */
export const useGoogleSignIn = () => {
	const { signInGoogle } = useSignInWithGoogle(api.auth);
	const { flowError } = useOauth();
	const start = async () => {
		try {
			await signInGoogle();
		} catch {
			// The failure is surfaced later through flowError.
		}
	};
	return {
		error:
			flowError === null
				? null
				: (flowError.message ?? "Sign-in failed. Please try again."),
		start,
	};
};

/**
 * Primary Google sign-in: a square black block with a tracked caps label,
 * the one filled control in the system. OAuth flow errors render beside it.
 */
export const SignInCta = () => {
	const { error, start } = useGoogleSignIn();
	return (
		<div className="flex flex-wrap items-center gap-4">
			<button className={primaryButtonClass} onClick={start} type="button">
				Sign in with Google
			</button>
			{error !== null && (
				<span className="text-destructive text-sm" role="alert">
					{error}
				</span>
			)}
		</div>
	);
};

/**
 * A signed-out page's body: one grey sentence saying what signing in
 * unlocks, then the button. Settings tabs, Add a roaster, and the pane
 * all use it, so the signed-out state reads the same everywhere.
 */
export const SignInPrompt = ({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) => (
	<div className={className}>
		<p className="text-muted-foreground max-w-prose text-sm md:text-[15px]">
			{children}
		</p>
		<div className="mt-6">
			<SignInCta />
		</div>
	</div>
);
