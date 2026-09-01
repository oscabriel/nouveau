import { setupCore } from "@convex-dev/auth/core/setup";
import { setupGoogle } from "@convex-dev/auth/providers/oauth/google";

import { components, internal } from "./_generated/api";
import { env } from "./_generated/server";

const core = setupCore({ component: components.auth });
export const { isAuthenticated, refreshSession, signOut } = core;

// SITE_URL (deployment env var) carries the browsed origin — e.g. the Caddy
// dev domain — so no personal domain is hardcoded in tracked code.
const allowedRedirectOrigins = env.SITE_URL
	? ["http://localhost:3004", env.SITE_URL]
	: ["http://localhost:3004"];

export const { completeSignInGoogle, startSignInGoogle } = setupGoogle(core, {
	allowedRedirectOrigins,
	component: components.oauthGoogle,
}).attachUserCallbacks({ createUser: internal.users.createUser });
