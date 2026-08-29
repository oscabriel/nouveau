# Hackathon log

- **Project:** nouveau
- **Event:** Convex All Gas Hackathon
- **What it does:** Drop alerts for home coffee brewers: watches specialty roasters, detects new releases, and notifies matched users by email and a live feed.
- **Live app:** not deployed
- **Repo:** https://github.com/oscabriel/nouveau
- **Frontend:** Convex static hosting
- **Convex deployment:** not deployed
- **Components:** none
- **Convex features:** schema, queries, mutations, realtime queries
- **Auth:** none
- **AI models:** none
- **Started:** 2026-08-29T18:06:09Z
- **Last updated:** 2026-08-29T18:42:00Z

## Log

### 2026-08-29 - 3fc82af

Scaffolded with Better-T-Stack: a Turborepo monorepo (bun workspaces, catalog deps) with a TanStack Router + Tailwind web app (`apps/web/`), shared `ui`/`env`/`config` packages, and a Convex backend (`packages/backend/convex/`), linted by ultracite. Template demo so far: a `todos` table with a list query and create/toggle/delete mutations wired to the frontend with realtime `useQuery`/`useMutation`, plus a health-check query. Convex features: schema, queries, mutations, realtime queries (`packages/backend/convex/schema.ts`, `packages/backend/convex/todos.ts`, `apps/web/src/routes/todos.tsx`).

### 2026-08-29 - working tree

Set up the agent environment. Copied in the project `AGENTS.md` and `.agents/` tooling (Convex guidelines docs, GitHub issue-tracker docs, and the `convex-hackathon-skill` build-log skill). Installed the `pi-mcp-adapter` package and configured the Convex MCP server (`~/.config/mcp/mcp.json`, `npx convex mcp start`); active after the next pi restart. Convex AI files in `packages/backend` and global Convex skills were installed and then removed in favor of the project-local `.agents/` docs and skills. No Convex deployment or hosting component yet; frontend target is Convex static hosting.
