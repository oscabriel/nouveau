import { setupCore } from "@convex-dev/auth/core/setup";
import { setupGoogle } from "@convex-dev/auth/providers/oauth/google";

import { components, internal } from "./_generated/api";

const core = setupCore({ component: components.auth });
export const { isAuthenticated, refreshSession, signOut } = core;

export const { completeSignInGoogle, startSignInGoogle } = setupGoogle(core, {
	allowedRedirectOrigins: ["http://localhost:3001"],
	component: components.oauthGoogle,
}).attachUserCallbacks({ createUser: internal.users.createUser });
