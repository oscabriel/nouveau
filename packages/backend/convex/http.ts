import { httpRouter } from "convex/server";

// Our own HTTP endpoints live under /api (see convex.config.ts). The auth
// routes are not here anymore: the auth components register theirs directly
// (JWKS at /auth/.well-known/jwks.json, Google callback at
// /oauth/google/callback).
const http = httpRouter();

export default http;
