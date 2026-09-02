import { AgentMail } from "@agentmail/convex";
import { httpRouter } from "convex/server";

import { components } from "./_generated/api";
import { httpAction } from "./_generated/server";

const agentmail = new AgentMail(components.agentmail);

// Our own HTTP endpoints live under /api (see convex.config.ts). The auth
// routes are not here anymore: the auth components register theirs directly
// (JWKS at /auth/.well-known/jwks.json, Google callback at
// /oauth/google/callback).
const http = httpRouter();

// Inbound AgentMail webhook: delivery lifecycle events for sent alerts (and,
// from v1.1, replies threading into the user's inbox). Serves 500s until
// AGENTMAIL_WEBHOOK_SECRET is set on the deployment; register
// <CONVEX_SITE_URL>/api/agentmail/webhook with AgentMail.
http.route({
	handler: httpAction((ctx, req) =>
		agentmail.handleWebhook(
			// The component's RunMutationCtx is structural ({ runMutation }); the
			// httpAction ctx satisfies it at runtime, but its data-model generic
			// doesn't line up with the component's.
			ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0],
			req
		)
	),
	method: "POST",
	path: "/agentmail/webhook",
});

export default http;
