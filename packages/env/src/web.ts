import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const convexUrlSchema = (exampleHost: string) =>
	z.url().refine((url) => new URL(url).hostname !== exampleHost, {
		message: `Replace the ${exampleHost} placeholder before running the app`,
	});

export const env = createEnv({
	client: {
		VITE_CONVEX_URL: convexUrlSchema("example.convex.cloud"),
	},
	clientPrefix: "VITE_",
	emptyStringAsUndefined: true,
	runtimeEnv: (import.meta as unknown as { env: Record<string, string> }).env,
});
