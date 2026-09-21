/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { api, internal } from "./_generated/api";
import { deriveBaseHandle, isValidHandle } from "./handles";
import schema from "./schema";
import { asUser } from "./test.helpers";

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

	test("ensureMyHandle backfills a legacy row with the same derivation", async () => {
		const { t } = await setup();
		const legacyId = await t.run((ctx) =>
			ctx.db.insert("users", {
				name: "Grace Hopper",
				providerAccountId: "google-legacy",
			})
		);
		const handle = await asUser(t, legacyId).mutation(
			api.users.ensureMyHandle,
			{}
		);
		expect(handle).toBe("grace-hopper");
		const user = await t.run((ctx) => ctx.db.get("users", legacyId));
		expect(user?.handle).toBe("grace-hopper");
	});

	test("ensureMyHandle leaves rows that already carry a handle", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		const handle = await asUser(t, userId).mutation(
			api.users.ensureMyHandle,
			{}
		);
		expect(handle).toBe(null);
		const user = await t.run((ctx) => ctx.db.get("users", userId));
		expect(user?.handle).toBe("ada-lovelace");
	});

	test("ensureMyHandle does nothing signed out", async () => {
		const { t } = await setup();
		const handle = await t.mutation(api.users.ensureMyHandle, {});
		expect(handle).toBe(null);
	});
});

describe("updateMe (ADR-0011, ADR-0016)", () => {
	test("changes the name alone", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		await asUser(t, userId).mutation(api.users.updateMe, {
			name: "Ada K. Lovelace",
		});
		const user = await t.run((ctx) => ctx.db.get("users", userId));
		expect(user?.name).toBe("Ada K. Lovelace");
		expect(user?.handle).toBe("ada-lovelace");
	});

	test("a handle change keeps the old handle as a redirect", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		await asUser(t, userId).mutation(api.users.updateMe, {
			handle: "ada-2",
		});
		const user = await t.run((ctx) => ctx.db.get("users", userId));
		expect(user?.handle).toBe("ada-2");
		const redirect = await t.run(
			async (ctx) =>
				await ctx.db
					.query("handleRedirects")
					.withIndex("by_handle", (q) => q.eq("handle", "ada-lovelace"))
					.unique()
		);
		expect(redirect?.userId).toBe(userId);
	});

	test("reclaiming a retired handle removes its redirect row", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		await asUser(t, userId).mutation(api.users.updateMe, {
			handle: "ada-2",
		});
		await asUser(t, userId).mutation(api.users.updateMe, {
			handle: "ada-lovelace",
		});
		const rows = await t.run(
			async (ctx) => await ctx.db.query("handleRedirects").collect()
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.handle).toBe("ada-2");
	});

	test("a taken handle is rejected", async () => {
		const { t } = await setup();
		const first = await createUser(t, "Ada Lovelace", "google-ada-1");
		const second = await createUser(t, "Ada Lovelace", "google-ada-2");
		await expect(
			asUser(t, second).mutation(api.users.updateMe, {
				handle: "ada-lovelace",
			})
		).rejects.toThrow("That handle is taken");
		const user = await t.run((ctx) => ctx.db.get("users", first));
		expect(user?.handle).toBe("ada-lovelace");
	});

	test("a reserved handle is rejected", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		await expect(
			asUser(t, userId).mutation(api.users.updateMe, { handle: "settings" })
		).rejects.toThrow("reserved");
	});

	test("a malformed handle is rejected", async () => {
		const { t } = await setup();
		const userId = await createUser(t, "Ada Lovelace", "google-ada");
		await expect(
			asUser(t, userId).mutation(api.users.updateMe, { handle: "Ada!" })
		).rejects.toThrow("Handles are");
	});

	test("a legacy row takes its first handle with no redirect row", async () => {
		const { t } = await setup();
		const userId = await t.run((ctx) =>
			ctx.db.insert("users", {
				name: "Grace Hopper",
				providerAccountId: "google-legacy",
			})
		);
		await asUser(t, userId).mutation(api.users.updateMe, {
			handle: "grace",
		});
		const user = await t.run((ctx) => ctx.db.get("users", userId));
		expect(user?.handle).toBe("grace");
		const rows = await t.run(
			async (ctx) => await ctx.db.query("handleRedirects").collect()
		);
		expect(rows).toHaveLength(0);
	});

	test("nothing signed out", async () => {
		const { t } = await setup();
		await expect(
			t.mutation(api.users.updateMe, { name: "Nobody" })
		).rejects.toThrow("Sign in required");
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
