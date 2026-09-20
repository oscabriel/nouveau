/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { deriveBaseHandle, isValidHandle } from "./handles";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const setup = () => {
	const t = convexTest(schema, modules);
	return { t };
};

const createUser = (
	t: ReturnType<typeof convexTest>,
	name: string,
	providerAccountId: string
) =>
	t.mutation(internal.users.createUser, {
		profile: {
			email: `${providerAccountId}@example.com`,
			emailVerified: true,
			id: providerAccountId,
			name,
			picture: undefined,
		},
		provider: "google" as const,
		providerAccountId,
	});

describe("user handles", () => {
	test("deriveBaseHandle slugifies the display name", () => {
		expect(deriveBaseHandle("Ada Lovelace")).toBe("ada-lovelace");
		expect(deriveBaseHandle("  René  Décartes ")).toBe("rene-decartes");
		expect(deriveBaseHandle("!!!")).toBe("taster");
		expect(deriveBaseHandle()).toBe("taster");
	});

	test("isValidHandle rejects reserved-shaped junk", () => {
		expect(isValidHandle("ada-lovelace")).toBe(true);
		expect(isValidHandle("-nope")).toBe(false);
		expect(isValidHandle("no--pe")).toBe(false);
		expect(isValidHandle("a".repeat(41))).toBe(false);
	});

	test("createUser derives the handle from the Google display name", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		const user = await t.run((ctx) => ctx.db.get("users", userId));
		expect(user?.handle).toBe("ada-lovelace");
	});

	test("handle collision gets a numeric suffix", async () => {
		const { t } = await setup();
		await createUser(t, "Ada Lovelace", "google-ada-1");
		const second = await createUser(t, "Ada Lovelace", "google-ada-2");
		const user = await t.run((ctx) => ctx.db.get("users", second));
		expect(user?.handle).toBe("ada-lovelace-2");
	});

	test("a reserved display name falls back to taster", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Settings", "google-settings");
		const user = await t.run((ctx) => ctx.db.get("users", userId));
		expect(user?.handle).toBe("taster");
	});

	test("a user created before handles existed backfills at sign-in", async () => {
		const { t } = await setup();
		const legacyId = await t.run((ctx) =>
			ctx.db.insert("users", {
				name: "Grace Hopper",
				providerAccountId: "google-legacy",
			})
		);
		const returned = await t.mutation(internal.users.createUser, {
			profile: {
				email: "legacy@example.com",
				emailVerified: true,
				id: "google-legacy",
				name: "Grace Hopper",
				picture: undefined,
			},
			provider: "google" as const,
			providerAccountId: "google-legacy",
		});
		expect(returned).toBe(legacyId);
		const user = await t.run((ctx) => ctx.db.get("users", legacyId));
		expect(user?.handle).toBe("grace-hopper");
	});
});

describe("profile lookup (logs.profile)", () => {
	const setupUser = async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		return { t, userId };
	};

	test("resolves by current handle", async () => {
		const { t, userId } = await setupUser();
		const profile = await t.query(api.logs.profile, {
			userId: "ada-lovelace",
		});
		expect(profile?.user.id).toBe(userId);
		expect(profile?.user.handle).toBe("ada-lovelace");
	});

	test("resolves a retired handle through handleRedirects", async () => {
		const { t, userId } = await setupUser();
		// The handle change itself lands with /settings/account (batch 5);
		// here the redirect row and the new handle stand in for it.
		await t.run(async (ctx) => {
			await ctx.db.patch("users", userId, { handle: "ada-2" });
			await ctx.db.insert("handleRedirects", {
				handle: "ada-lovelace",
				userId,
			});
		});
		const profile = await t.query(api.logs.profile, {
			userId: "ada-lovelace",
		});
		expect(profile?.user.id).toBe(userId);
		expect(profile?.user.handle).toBe("ada-2");
	});

	test("resolves a legacy users-document id", async () => {
		const { t, userId } = await setupUser();
		const profile = await t.query(api.logs.profile, { userId });
		expect(profile?.user.id).toBe(userId);
	});

	test("an unknown address resolves to null", async () => {
		const { t } = await setupUser();
		const profile = await t.query(api.logs.profile, {
			userId: "nobody-here",
		});
		expect(profile).toBeNull();
	});
});
