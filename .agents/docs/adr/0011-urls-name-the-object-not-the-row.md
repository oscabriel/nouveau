---
status: accepted
---

# URLs name the object, not the row

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Amends ADR-0003 (`/lots/$lotId` keyed by the `products` row id, "pretty handles deferred") and the addressing half of ADR-0002 (`/profile/$userId`).

## Context

Today's routes (`apps/web/src/routeTree.gen.ts`): `/`, `/roasters`, `/roasters/$slug`, `/roasters/submit`, `/lots/$lotId`, `/feed`, `/activity`, `/next-bag`, `/watches`, `/saved`, `/profile/$userId`, `/settings/alerts`. A roaster is addressed by `roasters.slug` (indexed, `getBySlug` uses `.unique()`). A lot is addressed by its `products` document id; `lots.get` takes a string and `normalizeId`s it. A user is addressed by their `users` document id; the `users` table has `name`, `imageUrl`, `email` and `providerAccountId`, no handle. `products.handle` exists on every lot (the Shopify handle, the WooCommerce slug, or the last path segment for product-page shops) but is not indexed and nothing routes on it.

Two hazards the survey found in the current scheme. First, `/roasters/submit` is a static child of `/roasters`, so a roaster whose domain label is `submit` can never be reached, and any future static child of `/roasters` steals another slug. Second, slugs are derived as the domain minus its TLD (`seed.ts` `slugOf`, `submissions.ts` `normalizeShopUrl`) and deduplicated on `domain` only, so `eastpole.coffee` and a later `eastpole.com` submission both get slug `eastpole` and `getBySlug` throws for both.

Alert emails bake URLs in: `notifications.ts` writes `/roasters/$slug` for the roaster page and `/watches` for muting.

## Decision

The public URL map becomes:

| Route | What it is | Key |
| --- | --- | --- |
| `/roasters` | the directory of every roaster the crawler reads | none |
| `/roasters/submit` | add a roaster by URL | none |
| `/roaster/$roaster` | one roaster's page and lot catalog | `roasters.slug` |
| `/roaster/$roaster/$lot` | one lot's page | `products.handle`, scoped to that roaster |
| `/drops` | the drop feed (was `/feed`) | none |
| `/activity` | the public activity feed of recent logs | none |
| `/next-bag` | Find my next bag | none |
| `/settings` and children (`/settings/alerts`, `/settings/appearance`, `/settings/account`) | the signed-in user's own settings (was `/profile`'s role for "me") | the session |
| `/$user` | a user's public profile; the same URL is the management view when the viewer is that user | a user handle |
| `/about` | the about page the footer links to | none |

Plural for a directory, singular for an object page. The lot lives under its roaster because a lot's handle is only unique inside one shop, and because the roaster is the first thing a coffee person says about a coffee.

`/watches` and `/saved` retire; their content moves into the owner's view of `/$user` (ADR-0016). `/lots/$lotId`, `/roasters/$slug`, `/feed` and `/profile/$userId` keep resolving as redirects to the new addresses, so links in sent alert emails, saved logs and judges' notes do not rot. `notifications.ts` writes the new paths; the mute link goes to `/settings/alerts`, which already lists every watch with its mute toggle.

Reserved names. Every static top-level route (`roasters`, `roaster`, `drops`, `activity`, `next-bag`, `settings`, `about`, and the retired `lots`, `feed`, `profile`, `watches`, `saved`) is reserved against user handles. Roaster slugs no longer share a namespace with static routes, but the reserved list still applies to them for cleanliness, and slug uniqueness is checked at submission rather than trusted.

## Considered alternatives

- **Keep row ids in URLs.** No data change and no collision risk, but a lot page that reads `/lots/j57bd3k...` says nothing on camera or in a shared link, and the owner wants the address to read like the object.
- **`/roasters/$roaster/$lot` (plural nesting).** Keeps one prefix, but every static child of `/roasters` stays a slug hazard, which is the bug this fixes.
- **`/$roaster/$lot` at the root.** Shortest, but it collides with `/$user`, and a user named after a roaster would shadow it.
- **A global lot handle.** Shopify handles repeat across shops constantly ("ethiopia-guji"), so a global key would need a suffix scheme that leaks back into the URL.

## Consequences

- `products` gains an index on roaster and handle, and `lots.get` takes `(roaster slug, handle)` instead of an id. Every `Link` that passes `lotId` (drop tables, tiles, the lot catalog, log cards, saved cards, recommendation results) passes the pair instead, which means the queries behind those surfaces return the handle and the roaster slug with each row.
- Users need a handle, derived from the Google display name at first sign-in with a numeric suffix on collision, editable in `/settings/account`, with the previous handle kept as a redirect; `logs.profile` looks up by handle.
- Submission enforces slug uniqueness and reserved names; the seed's and the submission's duplicated slug derivation collapse into one function.
- The redirects are client-side route definitions (Convex static hosting serves one SPA), so the old paths are real routes that navigate on mount. That is fine for humans and for email links; it is not a 301 for crawlers, which the app does not court.
- The design pass (handoff of 2026-09-20) had planned to leave route names alone. It now follows this map.

## Open questions

None on the user handle: the owner settled it, 2026-09-20. The handle is derived from the Google display name at first sign-in, with a numeric suffix on collision, and is editable in `/settings/account`; the previous handle is kept as a redirect (an `oldHandles` array on the user) so no shared `/$user` link rots.

**Duplicate lot handles get the year, not a number.** When a current and an archived lot in one shop share a `products.handle`, the archived lot's URL gets the year appended, as film titles do (`ethiopia-guji-2024`), rather than a random or numeric suffix. Detection rides the upsert path: the new roaster-plus-handle index makes the conflict a cheap indexed lookup at write time, so no submission-time scan of archived lots is needed. The year is the archived lot's **last-seen year**, matching how a coffee person dates a coffee and needing no new field.

**2026-09-20 (implementation, batch 1). Slug uniqueness at submission gets the first free numeric suffix; reserved slugs do too.** The ADR requires submission to enforce slug uniqueness and reserved names but names no resolution for a collision: a later `eastpole.com` cannot take `eastpole` from `eastpole.coffee`, yet rejecting the submission would punish a legitimate shop for a slug it does not control. The shared derivation (`slugs.ts`, used by the seed and the submission) therefore claims the first free suffix `eastpole-2`, `eastpole-3`, ... on the `by_slug` index, and a slug that lands on a reserved route name (`settings.com`) suffixes the same way. Roaster slugs are assigned once at submission and never rewritten.

## Amendments

**2026-09-20 (implementation, batch 1). The old-handle redirect is a table, not the `oldHandles` array.** The original decision stored old handles in an array on the user. The array is the record, but it cannot serve the lookup: indexing an array field in Convex writes one index entry per element, yet the query contract (`q.eq`) compares against the whole value, so `q.eq("oldHandles", "old-name")` matches nothing and a stale link has no indexed path. (Verified against the convex-test engine, 2026-09-20.) The redirect therefore lives in its own table, `handleRedirects` (`handle` indexed, `userId`), one row per retired handle, written when `/settings/account` saves a handle change and removed if the user reclaims that handle. One indexed read resolves a stale `/$user` link; the array field is not used and does not ship.

**2026-09-20 (design-pass review, S5). A retired handle is not reserved.** The amendment above left open whether a retired handle stays out of the pool for its old owner. The owner settled it: not at all. Anyone may take a retired handle, at first sign-in through `claimHandle` or in `/settings/account` through `updateMe`, and both paths delete the redirect row for the handle they hand out, since the current-handle lookup answers first and the row could never fire again. The redirect therefore lasts until someone else wants the handle, which the owner accepts as the trade for a handle pool that does not fill with names nobody uses.
