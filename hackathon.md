# Hackathon log

- **Project:** nouveau
- **Event:** Convex All Gas Hackathon
- **What it does:** Drop alerts for home coffee brewers: watches specialty roasters, detects new releases, and notifies matched users by email and a live feed.
- **Live app:** https://artful-chameleon-402.convex.site
- **Repo:** https://github.com/oscabriel/nouveau
- **Frontend:** Convex static hosting
- **Convex deployment:** https://artful-chameleon-402.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, queries, mutations, realtime queries
- **Auth:** none
- **AI models:** none
- **Started:** 2026-08-29T18:06:09Z
- **Last updated:** 2026-08-29T20:21:00Z

## Log

### 2026-08-29 - 4be892a

Scaffolded with Better-T-Stack: a Turborepo monorepo (bun workspaces, catalog deps) with a TanStack Router + Tailwind web app (`apps/web/`), shared `ui`/`env`/`config` packages, and a Convex backend (`packages/backend/convex/`), linted by ultracite. Template demo so far: a `todos` table with a list query and create/toggle/delete mutations wired to the frontend with realtime `useQuery`/`useMutation`, plus a health-check query. Convex features: schema, queries, mutations, realtime queries (`packages/backend/convex/schema.ts`, `packages/backend/convex/todos.ts`, `apps/web/src/routes/todos.tsx`).

### 2026-08-29 - working tree

Set up the agent environment. Copied in the project `AGENTS.md` and `.agents/` tooling (Convex guidelines docs, GitHub issue-tracker docs, and the `convex-hackathon-skill` build-log skill). Installed the `pi-mcp-adapter` package and configured the Convex MCP server (`~/.config/mcp/mcp.json`, `npx convex mcp start`); active after the next pi restart. Convex AI files in `packages/backend` and global Convex skills were installed and then removed in favor of the project-local `.agents/` docs and skills. No Convex deployment or hosting component yet; frontend target is Convex static hosting.

### 2026-08-29 - d554214

Toolchain pass: upgraded TypeScript to 7.0.2 (the native compiler), ultracite to 7.10.7 with oxfmt 0.65, and refreshed all workspace deps. Adopted the new function-style lint rules across app code (arrow-function components, hoisted route definitions, no nested ternaries) and updated the oxc configs to exclude shadcn UI components from linting. No product behavior change (`package.json`, `oxlint.config.ts`, `oxfmt.config.ts`).

### 2026-08-29 - a37561b

Deployed to production on Convex static hosting. Registered the `@convex-dev/static-hosting` component (owns `/`, app HTTP endpoints reserved under `/api`), added a root `convex.json` so the Convex CLI and MCP server work from the repo root, and pinned the deploy script to the prod deployment. First build is live at https://artful-chameleon-402.convex.site with the backend at https://artful-chameleon-402.convex.cloud; the health-check query verified against prod. Components: @convex-dev/static-hosting (`packages/backend/convex/convex.config.ts`).
