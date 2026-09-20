import { setupCore } from "@convex-dev/auth/core/setup";
import { setupGoogle } from "@convex-dev/auth/providers/oauth/google";

import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";

const core = setupCore({ component: components.auth });
export const { isAuthenticated, refreshSession, signOut } = core;

// SITE_URL (deployment env var) carries the browsed origin — e.g. the Caddy
// dev domain — so no personal domain is hardcoded in tracked code. The
// convex.site entry is prod's pre-custom-domain URL, kept so sign-in still
// works there; Google never sees it (the OAuth redirect_uri stays pinned to
// the custom domain) and sessions don't carry across the two origins.
const allowedRedirectOrigins = [
	"http://localhost:3004",
	"https://artful-chameleon-402.convex.site",
	...(env.SITE_URL ? [env.SITE_URL] : []),
];

export const { completeSignInGoogle, startSignInGoogle } = setupGoogle(core, {
	allowedRedirectOrigins,
	component: components.oauthGoogle,
}).attachUserCallbacks({ createUser: internal.users.createUser });
