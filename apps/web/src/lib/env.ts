import * as z from "zod/mini";

// zod/mini, not zod: the classic API is one 350 KB module that lands in
// the main chunk for a single URL check. Mini tree-shakes to what is used.
const PLACEHOLDER_HOST = "example.convex.cloud";

const schema = z.object({
	VITE_CONVEX_URL: z.url().check(
		z.refine((url) => new URL(url).hostname !== PLACEHOLDER_HOST, {
			message: `Replace the ${PLACEHOLDER_HOST} placeholder before running the app`,
		})
	),
});

/**
 * The one variable the web app reads, validated once at startup so a
 * missing or placeholder URL fails here with a message instead of as a
 * websocket error later. Vite inlines `import.meta.env.VITE_*` at build.
 */
export const env = schema.parse({
	VITE_CONVEX_URL: import.meta.env.VITE_CONVEX_URL || undefined,
});
