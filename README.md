# Nouveau

A live index of beans from specialty coffee roasters, and a place to remember what you've tried and get notified of new drops.

Nouveau watches US specialty roasters' shops, catches new lots, restocks and price drops, and emails the people watching that roaster. Signed in, you log the lots you drink with a rating and your own tasting notes, save the ones you want to try, and ask "Find my next bag" in plain words and watch an agent search the catalog and hand over in-stock picks one card at a time.

- Live app: https://nouveau.coffee
- Convex static-hosting URL: https://artful-chameleon-402.convex.site
- Build log: [hackathon.md](hackathon.md), written for the Convex All Gas Hackathon

## How it works

Everything runs on Convex, which is the backend, the database and the host in one. A cron every five minutes claims the crawl sources that are due; realtime queries drive the landing index, `/drops` and the panes; file storage keeps each crawl's raw capture; full-text search finds a lot by name inside a roaster's catalog; and Google sign-in runs through Convex Auth. The `@convex-dev/workpool` component serializes alert sends and drives the agent runs, `@convex-dev/aggregate` updates follower counts in the same transaction as a watch, and `@convex-dev/rate-limiter` paces Check now and next-bag quotas. The web app itself is served by `@convex-dev/static-hosting` at nouveau.coffee, with the deployment's realtime API at api.nouveau.coffee as a Convex custom domain.

Firecrawl reads what the feeds don't carry. Shops with no feed are read through Firecrawl's product format page by page, gated by change tracking on the collection page, and Firecrawl also picks up any feed URL that fails. The same client makes the page read for thin lots, of which there are many, since a roaster's tasting notes usually live in a Shopify metafield the feed never carries: after each crawl a sweep reads the product pages of lots still missing facts, Firecrawl's rendered HTML first and the shop's own page as the fallback, and a viewer who reaches a thin lot first gets the read on view. Every read asks TypeSafe's Jev which line of the page holds each fact; code cutters take the value from the picked line and verifiers gate what gets stored. Jev also shadows the lot classifier's ambiguous tail, recording without acting.

A roaster's first crawl fills its catalog and fires nothing; from the second crawl on, a new lot, a back-in-stock or a downward price move becomes a drop event, and events feed the landing index and `/drops`. Every alert-worthy event fans out to the roaster's unmuted watchers inside the transaction that emitted it: one notifications-ledger row per (user, event) doubles as the one-email-per-event dedupe guard, the send goes through the workpool, and AgentMail delivers from one shared product inbox to each watcher's own email, replies landing in that inbox threaded per conversation.

Find my next bag is an OpenAI agent loop on `@convex-dev/agent`. `gpt-5.6-luna` works through the Responses API with `store: false` and effort low, one fresh thread per run, with tools over the internal queries: search the catalog, read a lot's page facts through the same Firecrawl budget, check price and stock, and read the user's logs only when they consent. It hands over one validated lot per `pickLot` call; the server re-checks ids, stock and price at handoff and again on read; each card streams into the pane while the run continues.

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
