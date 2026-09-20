import { useSignInWithGoogle } from "@convex-dev/auth/providers/oauth/react";
import { useConvexAuth } from "@convex-dev/auth/react";
import { api } from "@nouveau/backend/convex/_generated/api";
import { Link } from "@tanstack/react-router";

import { navLinkClass } from "@/lib/ui";

const scrollToTop = () => {
	window.scrollTo({ behavior: "smooth", top: 0 });
};

/**
 * Site footer: the wordmark at building scale, cropped at the baseline and
 * scrolling right to left, then one row of caps links. The marquee is a
 * single continuous run; two copies translate by half so it never seams.
 */
export const SiteFooter = () => {
	const { isAuthenticated } = useConvexAuth();
	const { signInGoogle } = useSignInWithGoogle(api.auth);
	const startSignIn = async () => {
		try {
			await signInGoogle();
		} catch {
			// The header's sign-in surfaces flow errors; this one stays quiet.
		}
	};
	return (
		<footer className="mt-32 md:mt-40">
			<div
				aria-hidden
				className="relative h-[16.5vw] overflow-hidden select-none"
			>
				<div className="absolute top-0 left-0 flex whitespace-nowrap will-change-transform motion-safe:animate-[marquee_60s_linear_infinite]">
					<span className="pr-[0.3em] text-[22vw] leading-none font-semibold tracking-[-0.02em]">
						NOUVEAU.COFFEE
					</span>
					<span className="pr-[0.3em] text-[22vw] leading-none font-semibold tracking-[-0.02em]">
						NOUVEAU.COFFEE
					</span>
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 pt-4 pb-5 md:px-10">
				<nav className="flex gap-4 md:gap-5">
					<Link className={navLinkClass} to="/roasters">
						Roasters
					</Link>
					<Link className={navLinkClass} to="/activity">
						Activity
					</Link>
					<Link className={navLinkClass} to="/drops">
						Feed
					</Link>
				</nav>
				<button className={navLinkClass} onClick={scrollToTop} type="button">
					Back to the top
				</button>
				<nav className="flex gap-4 md:gap-5">
					{isAuthenticated ? (
						<Link className={navLinkClass} to="/settings/alerts">
							Watches
						</Link>
					) : (
						<button
							className={navLinkClass}
							onClick={() => {
								startSignIn();
							}}
							type="button"
						>
							Sign in
						</button>
					)}
					<a
						className={navLinkClass}
						href="https://github.com/oscabriel/nouveau"
						rel="noreferrer"
						target="_blank"
					>
						GitHub
					</a>
				</nav>
			</div>
		</footer>
	);
};
