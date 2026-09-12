import { ConvexError } from "convex/values";

const isRateLimit = (
	data: unknown
): data is { kind: "RateLimited"; retryAfter: number } =>
	typeof data === "object" &&
	data !== null &&
	"kind" in data &&
	data.kind === "RateLimited" &&
	"retryAfter" in data &&
	typeof data.retryAfter === "number";

/**
 * Convex redacts plain `Error` messages in production; only `ConvexError`
 * data reaches the browser. The rate limiter throws `{ kind: "RateLimited" }`.
 */
export const describeMutationError = (
	error: unknown,
	fallback: string
): string => {
	if (!(error instanceof ConvexError)) {
		return fallback;
	}
	if (typeof error.data === "string") {
		return error.data;
	}
	if (isRateLimit(error.data)) {
		const minutes = Math.max(1, Math.ceil(error.data.retryAfter / 60_000));
		return `You reached the hourly limit. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
	}
	return fallback;
};
