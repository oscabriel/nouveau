import aggregate from "@convex-dev/aggregate/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import staticHosting from "@convex-dev/static-hosting/convex.config";
import { defineApp } from "convex/server";

// Static hosting owns "/"; our own HTTP endpoints (convex/http.ts) live under
// "/api" once we add them.
const app = defineApp({ httpPrefix: "/api" });
app.use(staticHosting, { httpPrefix: "/" });
app.use(aggregate);
app.use(rateLimiter);

export default app;
