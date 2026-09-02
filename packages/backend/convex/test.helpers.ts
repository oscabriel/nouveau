// Shared convex-test fixtures. The extra dot in the filename keeps the Convex
// bundler from treating this as a deployable module.
import type { convexTest } from "convex-test";

import type { Id } from "./_generated/dataModel";

/** Run calls as a signed-in user; subject mirrors what Convex Auth issues. */
export const asUser = (
	t: ReturnType<typeof convexTest>,
	userId: Id<"users">
): ReturnType<typeof t.withIdentity> =>
	t.withIdentity({
		issuer: "https://auth.example.com",
		subject: userId,
		tokenIdentifier: `auth.example.com|${userId}`,
	});
