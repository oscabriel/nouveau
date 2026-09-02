import {
	useOauth,
	useSignInWithGoogle,
} from "@convex-dev/auth/providers/oauth/react";
import { api } from "@nouveau/backend/convex/_generated/api";

/** Primary Google sign-in button with the OAuth flow error beside it. */
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
		<div className="flex items-center gap-3">
			<button
				className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
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
