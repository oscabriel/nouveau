import agentmail from "@agentmail/convex/convex.config";
import aggregate from "@convex-dev/aggregate/convex.config";
import auth from "@convex-dev/auth/core/convex.config";
import oauth from "@convex-dev/auth/providers/oauth/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import firecrawl from "@firecrawl/firecrawl-convex/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

// Static hosting owns "/"; our own HTTP endpoints (convex/http.ts) live under
// "/api". The auth components mount their own routes outside that prefix: the
// core component serves JWKS at /auth/.well-known/jwks.json (matched by
// auth.config.ts) and Google's callback lands at /oauth/google/callback
// (matching the redirect URI registered with Google).
const app = defineApp({
	env: {
		// AgentMail reads this component-side (its actions run in the
		// component's isolated env namespace, which never sees the app's
		// deployment env vars), so it must be wired through app.use below.
		AGENTMAIL_API_KEY: v.string(),
		AUTH_GOOGLE_CLIENT_ID: v.string(),
		AUTH_GOOGLE_CLIENT_SECRET: v.string(),
		AUTH_JWKS: v.string(),
		AUTH_PRIVATE_KEY: v.string(),
		FIRECRAWL_API_KEY: v.string(),
		// Webhook deliveries are signature-checked only when this is set.
		FIRECRAWL_WEBHOOK_SECRET: v.optional(v.string()),
		// Origin the OAuth flow may redirect back to (the browsed dev/prod URL).
		SITE_URL: v.optional(v.string()),
	},
	httpPrefix: "/api",
});
app.use(staticHosting, { httpPrefix: "/" });
// Email alerts (build order step 4). Credentials are read component-side,
// so AGENTMAIL_API_KEY is wired from the app's deployment env into the
// component's env namespace here; setting it on the deployment alone does
// nothing for the component.
app.use(agentmail, {
	env: {
		AGENTMAIL_API_KEY: app.env.AGENTMAIL_API_KEY,
	},
});
app.use(aggregate);
app.use(rateLimiter);
// Mounts the crawl webhook route at <site>/firecrawl/webhook.
app.use(firecrawl, {
	env: {
		FIRECRAWL_API_KEY: app.env.FIRECRAWL_API_KEY,
		FIRECRAWL_WEBHOOK_SECRET: app.env.FIRECRAWL_WEBHOOK_SECRET,
	},
	httpPrefix: "/firecrawl/",
});
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
