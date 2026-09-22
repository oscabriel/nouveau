import { createEnv } from "@t3-oss/env-core";
import * as z from "zod/mini";

// zod/mini, not zod: the classic API is one 350 KB module that lands in
// the web app's main chunk for a single URL check. Mini tree-shakes to the
// two functions used here.
const convexUrlSchema = (exampleHost: string) =>
	z.url().check(
		z.refine((url) => new URL(url).hostname !== exampleHost, {
			message: `Replace the ${exampleHost} placeholder before running the app`,
		})
	);

export const env = createEnv({
	client: {
		VITE_CONVEX_URL: convexUrlSchema("example.convex.cloud"),
	},
	clientPrefix: "VITE_",
	emptyStringAsUndefined: true,
	runtimeEnv: (import.meta as unknown as { env: Record<string, string> }).env,
});
