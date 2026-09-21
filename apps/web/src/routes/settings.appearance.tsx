import { useConvexAuth } from "@convex-dev/auth/react";
import { createFileRoute } from "@tanstack/react-router";

import Loader from "@/components/loader";
import { PageTitle } from "@/components/page-title";
import { SignInCta } from "@/components/sign-in-cta";
import { ThemeSwitch } from "@/components/theme-switch";

/**
 * The appearance settings: the single LIGHT / DARK switch (ADR-0013), one of
 * its two mounts. Signed out, the visitor gets the system theme with no
 * control, so the page says so and offers sign-in.
 */
const AppearanceComponent = () => {
	const { isAuthenticated, isLoading } = useConvexAuth();
	let control: React.ReactNode;
	if (isLoading) {
		control = <Loader />;
	} else if (isAuthenticated) {
		control = <ThemeSwitch />;
	} else {
		control = <SignInCta />;
	}
	return (
		<main>
			<div className="px-5 pt-10 md:px-10 md:pt-14">
				<PageTitle title="Appearance" />
				<p className="text-muted-foreground mt-4 max-w-prose text-sm md:text-[15px]">
					Nouveau follows the theme of your operating system. The switch inverts
					it; when the OS changes, the page changes with it. The choice stays on
					this browser.
				</p>
				<div className="mt-6">{control}</div>
			</div>
		</main>
	);
};

export const Route = createFileRoute("/settings/appearance")({
	component: AppearanceComponent,
});
