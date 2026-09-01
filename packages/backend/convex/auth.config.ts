import type { AuthConfig } from "convex/server";

const siteUrl = process.env.CONVEX_SITE_URL ?? "";

export default {
	providers: [
		{
			algorithm: "RS256",
			applicationID: "convex",
			issuer: siteUrl,
			jwks: `${siteUrl}/auth/.well-known/jwks.json`,
			type: "customJwt",
		},
	],
} satisfies AuthConfig;
