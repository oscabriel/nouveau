# Hackathon log

- **Project:** nouveau
- **Event:** Convex All Gas Hackathon
- **What it does:** Drop alerts for home coffee brewers: watches specialty roasters, detects new releases, and notifies matched users by email and a live feed.
- **Live app:** https://artful-chameleon-402.convex.site
- **Repo:** https://github.com/oscabriel/nouveau
- **Frontend:** Convex static hosting
- **Convex deployment:** https://artful-chameleon-402.convex.cloud
- **Components:** @convex-dev/aggregate, @convex-dev/auth (core + Google OAuth), @convex-dev/rate-limiter, @convex-dev/static-hosting, @firecrawl/firecrawl-convex
- **Convex features:** schema, indexes, queries, mutations, actions, crons, scheduled functions, file storage, realtime queries
- **Auth:** Convex Auth
- **AI models:** none
- **Started:** 2026-08-29T18:06:09Z
- **Last updated:** 2026-09-01T21:49:58Z

## Log

### 2026-08-29 - 4be892a

Scaffolded with Better-T-Stack: a Turborepo monorepo (bun workspaces, catalog deps) with a TanStack Router + Tailwind web app (`apps/web/`), shared `ui`/`env`/`config` packages, and a Convex backend (`packages/backend/convex/`), linted by ultracite. Template demo so far: a `todos` table with a list query and create/toggle/delete mutations wired to the frontend with realtime `useQuery`/`useMutation`, plus a health-check query. Convex features: schema, queries, mutations, realtime queries (`packages/backend/convex/schema.ts`, `packages/backend/convex/todos.ts`, `apps/web/src/routes/todos.tsx`).

### 2026-08-29 - working tree

Set up the agent environment. Copied in the project `AGENTS.md` and `.agents/` tooling (Convex guidelines docs, GitHub issue-tracker docs, and the `convex-hackathon-skill` build-log skill). Installed the `pi-mcp-adapter` package and configured the Convex MCP server (`~/.config/mcp/mcp.json`, `npx convex mcp start`); active after the next pi restart. Convex AI files in `packages/backend` and global Convex skills were installed and then removed in favor of the project-local `.agents/` docs and skills. No Convex deployment or hosting component yet; frontend target is Convex static hosting.

### 2026-08-29 - d554214

Toolchain pass: upgraded TypeScript to 7.0.2 (the native compiler), ultracite to 7.10.7 with oxfmt 0.65, and refreshed all workspace deps. Adopted the new function-style lint rules across app code (arrow-function components, hoisted route definitions, no nested ternaries) and updated the oxc configs to exclude shadcn UI components from linting. No product behavior change (`package.json`, `oxlint.config.ts`, `oxfmt.config.ts`).

### 2026-08-29 - a37561b

Deployed to production on Convex static hosting. Registered the `@convex-dev/static-hosting` component (owns `/`, app HTTP endpoints reserved under `/api`), added a root `convex.json` so the Convex CLI and MCP server work from the repo root, and pinned the deploy script to the prod deployment. First build is live at https://artful-chameleon-402.convex.site with the backend at https://artful-chameleon-402.convex.cloud; the health-check query verified against prod. Components: @convex-dev/static-hosting (`packages/backend/convex/convex.config.ts`).

### 2026-08-31 - working tree

Wayfinding pass complete: locked the full product shape through the wayfinder map (GitHub Issues #1–#9) — auth (Google OAuth on @convex-dev/auth 0.0.95), seed list (20 verified US Shopify roasters), sponsor component pins (firecrawl 0.1.1, agentmail 0.1.0), the launch data model (10 tables, baseline-crawl and 3-strike archive rules, email-ledger notifications), coverage flows (user submissions with quotas, local scenes), and the notification/feed UX (global + personalized live feeds, locked alert email template, per-user AgentMail inboxes, watch-status chips, drop-rhythm prediction card). Wrote the synthesized locked build spec (`docs/build-spec.md`, uncommitted) plus `CONTEXT.md` glossary and ADR-0001 (Shopify /products.json as primary extraction). Set sponsor env keys (Firecrawl, OpenAI, AgentMail) on the dev deployment. No product code yet; implementation starts with schema + seed data.

### 2026-08-31 - working tree (schema + auth + seed)

Implemented the launch schema in `packages/backend/convex/schema.ts`: all ten locked tables (roasters, crawlSources, products, productVariants, dropEvents, watches, notifications, localScenes, rawCaptures, users) with the locked indexes and the authTables spread from @convex-dev/auth. Wired launch auth: Google OAuth only (`convex/auth.ts`, `convex/auth.config.ts`, HTTP routes at `convex/http.ts`), pinned @convex-dev/auth 0.0.95 + @auth/core 0.41.1; set JWT_PRIVATE_KEY/JWKS/SITE_URL on the dev deployment. Mounted @convex-dev/aggregate and @convex-dev/rate-limiter components. Seeded all 20 verified US roasters + crawlSources rows on dev via `convex/seed.ts` (idempotent internal mutation; roasters enter `pending`, flip to `active` on baseline crawl). Removed the scaffold todos module (backend + web route). Auth env keys AUTH_GOOGLE_ID/SECRET pending (user holds the Google OAuth apps). Components: @convex-dev/aggregate, @convex-dev/rate-limiter; Convex features: schema, scheduled mutations (planned), file storage (planned).

### 2026-09-01 - working tree (Convex Auth v2 + verified Google sign-in)

Migrated auth to Convex Auth v2 (@convex-dev/auth 2.0.0-alpha.1). The auth core and oauthGoogle components are mounted in `convex.config.ts` (JWKS at `/auth/.well-known/jwks.json`, Google callback at `/oauth/google/callback`), the app owns its `users` table outright (`convex/users.ts`, createUser deduped by providerAccountId), `auth.config.ts` uses a customJwt provider, and the v1 authTables spread is gone from the schema. Added Google sign-in/sign-out to the web header (`ConvexAuthProvider` with `api={api.auth}`). Verified the full sign-in round trip on the dev deployment — consent, callback, session, first users row — browsing through a stable HTTPS dev domain on a local Caddy reverse proxy, with the allowed redirect origin supplied by a SITE_URL deployment env var rather than hardcoded (`convex/auth.ts`, `apps/web/vite.config.ts`). Retired the v1 JWT_PRIVATE_KEY/JWKS deployment vars and closed issue #8 (sponsor + auth env keys all set). Components: @convex-dev/auth core + Google OAuth join aggregate, rate-limiter, and static-hosting.

### 2026-09-01 - working tree (extraction pipeline live on dev)

Built and verified the crawl/extraction pipeline (build order step 2). The Firecrawl component is mounted in `convex.config.ts`; a 5-minute cron tick claims due crawl sources and schedules crawler actions (`convex/crons.ts`, `convex/crawlSources.ts`). products_json sources fetch Shopify `/products.json` directly with Firecrawl scrape as bot-protection fallback, now walking paginated feeds past Shopify's 250-item page cap. Pagination alone took Sey Coffee from 250 truncated products to its full 887 (`convex/crawler.ts`, `convex/extraction.ts`). html-mode sources run a durable Firecrawl crawl with structured extraction, committed by an internal-mutation completion callback. Each crawl commits in one transaction: raw body capture to file storage, catalog upserts, drop-event diffing (baseline crawl fires none), the 3-strike archive, source health, and reschedule. Crons also sweep stale sources hourly and prune raw captures daily on a 3-day retention. Verified on the dev deployment: all 20 roasters active, and the first genuine drop event (a Sey variant selling out between crawls) recorded end to end. Convex features: actions, crons, scheduled functions, file storage. Component: @firecrawl/firecrawl-convex.
