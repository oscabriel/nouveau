# Nouveau handoff — extraction pipeline shipped and baseline-verified; next: commit, hackathon log, event-path verification

## Project

Nouveau (`~/Developer/projects/nouveau`), Convex All Gas Hackathon entry (deadline Sept 22, 2026, 12:00 PM PT). Drop-alert service for home coffee brewers. Locked build spec: `docs/build-spec.md` (§12 build order, §13 open-during-build fog). `CONTEXT.md` glossary is binding. ADR-0001 governs extraction (`docs/adr/0001-shopify-products-json-as-primary-extraction.md`). Build history: `hackathon.md`.

A copy of this handoff lives in the project at `.agents/handoffs/` and in `~/.agents/handoffs/nouveau/` (where `/pickup` looks).

## Where things stand

**Build order step 2 (extraction pipeline) is BUILT, DEPLOYED to dev, and baseline-verified. It is NOT committed** — the working tree holds the whole change (4 new files + schema/config/constants edits + `bun.lock`/`_generated`). `main` is still at `bbf7741`.

This session's work:

1. Wired `@firecrawl/firecrawl-convex@0.1.1` into `packages/backend/convex/convex.config.ts` (`httpPrefix: "/firecrawl/"`, typed env `FIRECRAWL_API_KEY` + optional `FIRECRAWL_WEBHOOK_SECRET`).
2. New files (all under `packages/backend/convex/`):
   - `extraction.ts` — pure `/products.json` parser, wholesale-SKU filter, HTML structured-extraction prompt/schema + page parser.
   - `crawlSources.ts` — `applyCrawlResult` (single-transaction commit: raw capture row, catalog upserts, drop-event diffing, 3-strike archive, `pending → active` flip, health + reschedule), `tick`, `sweepStale`, `getSource`.
   - `crawler.ts` — `crawlSource` action (products_json: plain fetch → Firecrawl scrape fallback; html: durable Firecrawl crawl with structured extraction) + `onFirecrawlCrawlComplete` internal mutation (guard `status`, warn `unstored`, ids via `context`).
   - `crons.ts` — 5-min tick, hourly stale sweep.
3. Schema: added `products.missedCrawls: v.optional(v.number())` (consecutive-miss counter for the 3-strike archive).
4. Env on dev `cool-giraffe-632`: set `FIRECRAWL_WEBHOOK_SECRET` (value not recorded here, in the deployment). With the secret set, html crawls choose webhook mode automatically (code checks `env.FIRECRAWL_WEBHOOK_SECRET`); without it, poll mode.
5. **Baseline crawl verified live**: 19/20 products_json sources succeeded on the first cron tick (1000+ products/variants, 0 drop events — correct, baseline fires none, 12 rawCaptures; bigger bodies skip capture at 512 KB cap).
6. `drinkpassenger.com` products.json 404s (headless Shopify, JSON endpoint disabled) → flipped that source to `mode: "html"` via a temp mutation; its Firecrawl crawl completed. **All 20 roasters are now `active`, all 20 sources `watching`.**
7. Temp inspection code removed; ultracite check + convex push green.

## IMMEDIATE NEXT STEPS

1. **Commit** (user must confirm; conventional commits, atomic series). Suggested split: `feat(backend): wire Firecrawl component` / `feat(backend): add extraction pipeline` (extraction+crawlSources+crawler+crons+schema) / `chore(backend): refresh generated types`. Check `pgrep -fa convex` for a running watcher before staging.
2. **Update `hackathon.md`** via `convex-hackathon-skill` for the step-2 milestone (no private hostnames in it; drinkpassenger.com domain is public/seed-list info, fine to include).
3. **Verify the event paths** (unproven yet):
   - Drop event emission — fires on crawl #2. Sources run at 60-min cadence; to speed up, temporarily patch a source's `cadenceMinutes`/`nextCrawlDueAt` via a temp mutation, or wait for the hourly tick. Then assert `dropEvents` rows + variant diffs.
   - 3-strike archive — needs a product absent from 3 consecutive successful crawls; simulate by patching `missedCrawls: 2` on a product then crawling, or run 3 crawls with a narrowed feed.
   - Stale sweep — patch `lastSuccessAt` back beyond `stalenessThresholdMs` and wait for the hourly sweep.
   - Webhook delivery — the drinkpassenger crawl ran in poll mode (secret set afterward); next html crawl exercises webhook mode.
4. Tracker: no issue was opened/closed for step 2 this session; consider one on GitHub (`oscabriel/nouveau`) for the commit trail, then close it.

## Key learnings (new this session)

- **`ctx.storage.store` exists only in actions** (`StorageActionWriter`), not mutations. Raw captures are therefore stored by the crawler action, which passes `{ storageId, extractionOk }` into `applyCrawlResult` (validator `v.id("_storage")`).
- **The component's `onComplete` must be an internal MUTATION**, not an action (it mints a `FunctionHandle<"mutation">`). `firecrawl.listPages(ctx, ...)` works fine from that mutation.
- **Callback payload shape** (matches README): `{ crawlId, jobId, status, pageCount, unstored, error, context }`; `context` is what `startCrawl` was handed.
- **Ultracite in practice**: `no-await-in-loop` wants `Promise.all` even for Convex `ctx.db` writes (fine — single transaction; seed.ts already does this). Sequential cursor pagination needs `// eslint-disable-next-line no-await-in-loop`. `func-style` forces const-arrow for helpers; `no-negated-condition` flips ternaries like `x === undefined ? {} : { grams: x }`. Python bulk-edits over formatted code silently no-op when the anchor text drifted — verify with grep.
- **Backend typecheck**: run `npx tsc --noEmit` from `packages/backend/convex/` (its tsconfig lives there). It also surfaces pre-existing JSX noise from `apps/web`/`packages/ui` — filter those; they are NOT from your change. The canonical task `bun run check-types` only covers ui/web.
- **`convex run` gotcha**: after adding a function you must `npx convex dev --once` (there is no `npx convex push`) before `npx convex run` sees it. Internal functions can't be run from the CLI — use a temp public query/mutation (pattern: scratch file → push → run → delete → push).
- **Convex MCP `convex_data` reads timed out repeatedly this session**; the one-off-query tool rejects every import style tried. `npx convex run scratch:...` was the reliable inspection path. `convex_status` gives the `deploymentSelector` the other MCP tools need.
- **cron logs may be empty even when firing** — verify pipeline behavior by querying data, not by waiting on logs.
- Deploy targets unchanged: dev = `cool-giraffe-632` (`packages/backend/.env.local`), prod = `artful-chameleon-402` (`bun run deploy`, needs consent). Convex CLI only reliable from `packages/backend/`.

## Fog carried forward (build-spec §13)

OG image design, degraded-alert content, per-roaster cadence policy, digest (conditional on pipeline stability by end of Week 2), stats surfaces, taste profile (v1.1), demo arc (written last). New fog from this session: whether non-coffee products (e.g. "Passport Run Registration" on Madcap) should be filtered at extraction — spec only mandates wholesale filtering; non-coffee SKUs currently enter the catalog.

## Suggested skills

- `convex` — routing skill; load before any backend work.
- `convex-expert` — all code under `packages/backend/convex/`.
- `convex-deploy-guard` — announce `target: dev (cool-giraffe-632)` before any deployment-affecting command.
- `convex-verify` / `convex-test` — proving drop-event emission, 3-strike archiving, stale sweep (a `convex-test` suite over `applyCrawlResult`/`extraction.ts` would lock the baseline rule + archive rule in CI).
- `convex-hackathon-skill` — update `hackathon.md` after committing step 2.
