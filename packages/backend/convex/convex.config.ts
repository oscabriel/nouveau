import aggregate from "@convex-dev/aggregate/convex.config";
import auth from "@convex-dev/auth/core/convex.config";
import oauth from "@convex-dev/auth/providers/oauth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// Static hosting owns "/"; our own HTTP endpoints (convex/http.ts) live under
// "/api". The auth components mount their own routes outside that prefix: the
// core component serves JWKS at /auth/.well-known/jwks.json (matched by
// auth.config.ts) and Google's callback lands at /oauth/google/callback
// (matching the redirect URI registered with Google).
const app = defineApp({
	env: {
		AUTH_GOOGLE_CLIENT_ID: v.string(),
		AUTH_GOOGLE_CLIENT_SECRET: v.string(),
		AUTH_JWKS: v.string(),
		AUTH_PRIVATE_KEY: v.string(),
	},
	httpPrefix: "/api",
});
app.use(staticHosting, { httpPrefix: "/" });
app.use(aggregate);
app.use(rateLimiter);
app.use(auth, {
	env: {
		AUTH_JWKS: app.env.AUTH_JWKS,
		AUTH_PRIVATE_KEY: app.env.AUTH_PRIVATE_KEY,
	},
	httpPrefix: "/auth",
});
app.use(oauth, {
	env: {
		CLIENT_ID: app.env.AUTH_GOOGLE_CLIENT_ID,
		CLIENT_SECRET: app.env.AUTH_GOOGLE_CLIENT_SECRET,
	},
	httpPrefix: "/oauth/google",
	name: "oauthGoogle",
});

export default app;
