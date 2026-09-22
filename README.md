# Nouveau

A live index of beans from specialty coffee roasters, and a place to remember what you've tried and get notified of new drops.

Nouveau watches US specialty roasters' shops, catches new lots, restocks and price drops, and emails the people watching that roaster. Signed in, you log the lots you drink with a rating and your own tasting notes, save the ones you want to try, and ask "Find my next bag" in plain words and watch an agent search the catalog and hand over in-stock picks one card at a time.

- Live app: https://nouveau.coffee
- Convex static-hosting URL: https://artful-chameleon-402.convex.site
- Build log: [hackathon.md](hackathon.md), written for the Convex All Gas Hackathon

## How it works

Everything runs on Convex: backend, database and host. A cron every five minutes claims the crawl sources that are due; realtime queries drive the landing index, `/drops` and the panes; file storage keeps each crawl's raw capture; full-text search finds a lot by name; Google sign-in runs through Convex Auth. `@convex-dev/workpool` serializes alert sends and agent runs, `@convex-dev/aggregate` updates follower counts in the same transaction as a watch, and `@convex-dev/rate-limiter` paces Check now and next-bag quotas. The site is served by `@convex-dev/static-hosting` at nouveau.coffee, with the realtime API at api.nouveau.coffee.

Each crawl commits in one transaction: raw capture, catalog upserts, drop-event diffing, and rescheduling. A roaster's first crawl fills its catalog and fires nothing; from the second on, a new lot, a back-in-stock or a price drop becomes a drop event. Events feed the landing index and `/drops`, and every alert-worthy one fans out to the roaster's unmuted watchers inside the transaction that emitted it. One notifications-ledger row per (user, event) doubles as the one-email-per-event dedupe guard; sends go through the workpool, and AgentMail delivers from one shared inbox to each watcher's own email, replies threaded in that inbox, with each send's pending, sent and delivered lifecycle read live into the activity feed.

A probe at submission reads each new roaster's shop once and picks how it's crawled: Shopify's catalog feed where the shop publishes one, WooCommerce's Store API where it doesn't, and change-tracked page reads through Firecrawl for the rest. Feed or no feed, Firecrawl fetches every lot's product page, its rendered HTML first and the shop's own page as fallback, all under a token-bucket budget, and hands it to TypeSafe's Jev. The page text is split into lines, and those lines are the options Jev answers: one Choice per fact picks the line holding it (producer, region, elevation, process, roast level, variety), closed-vocabulary Choices pin origin country, process family, roast level band and altitude band, and every note-shaped line gets a yes-or-no Noul. The app cuts the value out of the winning line and verifies it against the page before it stores anything. Reads run at crawl time for lots still missing facts, and a viewer reaching a thin lot first triggers the read on view. Jev also shadows the lot classifier's ambiguous tail, recording without acting.

"Find my next bag" is an OpenAI agent loop on `@convex-dev/agent`. `gpt-5.6-luna` runs through the Responses API with `store: false` and effort low, one fresh thread per run, with tools over the internal queries: search the catalog, read a lot's page under the same Firecrawl budget, check price and stock, and read the user's logs only on consent. Each `pickLot` call hands over one validated lot; the server re-checks ids, stock and price at handoff and again on read; cards stream into the pane while the run continues.

The design is one column, black type on a white ground, hairline tables, and Thornton's 1808 Coffea arabica plate for the only color. [DESIGN.md](DESIGN.md) is the record; the decisions behind the product are in `.agents/docs/adr/`.

## Repository

```
apps/web              Vite + React 19 + TanStack Router, Tailwind 4
packages/backend      Convex functions, schema, crons, tests (vitest + convex-test)
packages/ui           Shared styles and primitives
.agents/docs          ADRs, work plan, Convex and code-standard guidelines
CONTEXT.md            The domain vocabulary
DESIGN.md             The design record
```

Convex components in use: `@convex-dev/auth` (Google OAuth), `@convex-dev/agent`, `@convex-dev/aggregate`, `@convex-dev/rate-limiter`, `@convex-dev/static-hosting`, `@convex-dev/workpool`, `@agentmail/convex`, `@firecrawl/firecrawl-convex`.

## Running it

Requires [Bun](https://bun.sh) and a Convex account.

```sh
bun install
bun run dev:setup      # first time: creates or links the Convex dev deployment
bun run dev            # convex dev watcher + Vite on localhost:3004
```

`bun run dev:setup` writes `packages/backend/.env.local` with `CONVEX_DEPLOYMENT` and `CONVEX_URL`. Put the same URL in `apps/web/.env` as `VITE_CONVEX_URL`.

The backend reads these from the Convex deployment's environment (set them in the dashboard or with `npx convex env set`):

| Variable | Used for |
| --- | --- |
| `SITE_URL` | The browsed origin, allowed as an auth redirect target |
| `AUTH_GOOGLE_CLIENT_ID`, `AUTH_GOOGLE_CLIENT_SECRET` | Google OAuth through Convex Auth |
| `AUTH_PRIVATE_KEY`, `AUTH_JWKS` | Convex Auth's signing keys |
| `AGENTMAIL_API_KEY` | The shared alert inbox and outgoing alert emails |
| `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET` | Reading product pages the feed left thin |
| `OPENAI_API_KEY` | Find my next bag |
| `TYPESAFE_API_KEY` | Jev, the page reader's span picker |

## Checks

```sh
bun run check-types                     # tsc in both packages
bun x ultracite check                   # lint and format (bun x ultracite fix to apply)
cd packages/backend && bunx vitest run  # backend tests
```

## Deploying

```sh
bun run deploy
```

This builds `apps/web` against `apps/web/.env.production`, pushes the functions and schema to `artful-chameleon-402`, and uploads the static bundle to Convex static hosting, which serves it at `nouveau.coffee` and the `*.convex.site` URL above.
