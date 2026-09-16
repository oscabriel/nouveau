import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { api } from "@nouveau/backend/convex/_generated/api";

/**
 * Primary Google sign-in: a square black block with a tracked caps label,
 * the one filled control in the system. OAuth flow errors render beside it.
 */
export const SignInCta = () => {
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
		<div className="flex flex-wrap items-center gap-4">
			<button
				className="label-caps bg-foreground text-background inline-flex min-h-11 items-center px-5 transition-opacity hover:opacity-80"
				onClick={startSignIn}
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
