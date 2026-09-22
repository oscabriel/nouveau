import { useConvexAuth } from "@convex-dev/auth/react";
import { createFileRoute } from "@tanstack/react-router";

import Loader from "@/components/loader";
import { SignInPrompt } from "@/components/sign-in-cta";
import { ThemeSwitch } from "@/components/theme-switch";

/**
 * The appearance tab: the single LIGHT / DARK switch (ADR-0013), one of
 * its two mounts. The title and tabs come from the /settings layout. Signed out, the visitor gets the system theme with no
 * control, so the page says so and offers sign-in.
 */
const AppearanceComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	if (isLoading) {
		return <Loader />;
	}
	if (!isAuthenticated) {
		return (
			<SignInPrompt className="mt-10">
				Nouveau follows the theme of your operating system. Sign in to invert
				it.
			</SignInPrompt>
		);
	}
	return (
		<div className="mt-10 max-w-xl">
			<h2 className="label-caps text-foreground">Theme</h2>
			<p className="text-muted-foreground mt-3 max-w-prose text-sm md:text-[15px]">
				Nouveau follows the theme of your operating system. The switch inverts
				it; when the OS changes, the page changes with it. The choice stays on
				this browser.
			</p>
			<div className="mt-4">
				<ThemeSwitch />
			</div>
		</div>
	);
};

export const Route = createFileRoute("/settings/appearance")({
	component: AppearanceComponent,
});
