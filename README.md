# Nouveau

A live index of American specialty coffee and a place to remember what you tried.

Nouveau watches US specialty roasters' shops, catches new lots, restocks and price drops, and emails the people watching that roaster. Signed in, you log the lots you drink with a rating and your own tasting notes, save the ones you want to try, and ask "Find my next bag" in plain words and watch an agent search the catalog and hand over in-stock picks one card at a time.

- Live app: https://nouveau.coffee
- Convex static-hosting URL: https://artful-chameleon-402.convex.site
- Convex deployment: `artful-chameleon-402`, reached by the app at https://api.nouveau.coffee (https://artful-chameleon-402.convex.cloud)
- Build log: [hackathon.md](hackathon.md), written for the Convex All Gas Hackathon

## How it works

Everything runs on Convex. A cron every five minutes claims the crawl sources that are due and reads each shop through the Shopify feed, the WooCommerce Store API, or product pages one at a time (ADR-0006). A roaster's first crawl fills its catalog and fires nothing; from the second crawl on, a new lot, a back-in-stock or a downward price move becomes a drop event. Drop events feed the landing index, `/drops`, and the alert emails, which go out through AgentMail to each watcher's own inbox. Lot pages that the feed left thin get read by Firecrawl, with TypeSafe's Jev picking the facts out of the page text.

Find my next bag is an OpenAI tool loop on `@convex-dev/agent`. The model searches the catalog with typed filters, checks stock, and hands over one validated lot per `pickLot` call; each card lands live in the pane while the run continues.

The design is one column, black type on a white ground, hairline tables, and Thornton's 1808 Coffea arabica plate for the only color. [DESIGN.md](DESIGN.md) is the record; the decisions behind the product are in `.agents/docs/adr/`.

## Repository

```
apps/web              Vite + React 19 + TanStack Router, Tailwind 4
packages/backend      Convex functions, schema, crons, tests (vitest + convex-test)
packages/ui           Shared styles and primitives
packages/env          Typed env access for the web app
.agents/docs          ADRs, work plan, Convex and code-standard guidelines
CONTEXT.md            The domain vocabulary
DESIGN.md             The design record
```

Convex components in use: `@convex-dev/auth` (Google OAuth), `@convex-dev/agent`, `@convex-dev/aggregate`, `@convex-dev/rate-limiter`, `@convex-dev/static-hosting`, `@convex-dev/workpool`, `@convex-dev/migrations`, `@agentmail/convex`, `@firecrawl/firecrawl-convex`.

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
| `AGENTMAIL_API_KEY` | Per-user alert inboxes and outgoing alert emails |
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
