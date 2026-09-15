# Nouveau — product context

_(Captured from the revised product spec, `.agents/research/nouveau-reimagined-product-spec.md`, with ADR-0004 recording the hackathon scope cut. Vocabulary is `CONTEXT.md`.)_

## What it is

Nouveau remembers the coffees you tried, helps you choose your next bag, and watches roasters for the releases you care about. It crawls US specialty roasters' shops (Shopify `products.json`, Firecrawl for the rest), keeps a catalog of lots, fires drop events (`new`, `back_in_stock`, `price_drop`; `sold_out` and `price_rise` are stored silently), and emails watchers through a per-user AgentMail inbox. On top of that catalog people log what they drank, save what they want to try, and ask Find my next bag for a shortlist that OpenAI explains from the roaster's own words. Buying happens at the roaster; Nouveau links out and is not a store.

## Audience

Home brewers who buy from several specialty roasters. They want to remember what they tried, find another coffee they might like, and know when something they want comes back. Signed-out visitors see the live global drop feed and the public activity feed before being asked to sign in.

## Screens that exist

- **Home**: signed out, the live global drop feed and a roaster teaser. Signed in, Find my next bag, Want to try (saved lots), and the personalized drop feed from watched roasters with delivery footers and one quiet unhealthy-watch banner.
- **Find my next bag** (`/next-bag`): pick a few of your logs or state preferences, set a price cap and minimum bag size, get a short list of currently available lots. Each card quotes the roaster's published words (catalog or a Firecrawl page fetch, timestamped), gives OpenAI's comparison to your preference, and links to the lot page and the shop.
- **Lot page** (`/lots/$lotId`): the roaster's published copy, availability, Save and Log actions, and the lot's public logs. Archived lots resolve fully so links never rot.
- **Activity** (`/activity`): the public feed of recent logs across all users.
- **Profile** (`/profile/$userId`): a taster's public logs and the roasters they watch. Saved lots never appear here.
- **Roasters** (`/roasters`, `/roasters/$slug`): the directory with search, and each roaster's lots (searchable), drop history, watch button, and crawl-status chip.
- **Watches** (`/watches`): the roasters you watch, with status chips and mute.
- **Saved** (`/saved`): everything on Want to try, paginated.
- **Live feed** (`/feed`): the global drop feed on its own page.
- **Sign-in**: Google only, self-service.

## Rules that matter

- Logs are public in this release and say so. Saves are private, do not email, and do not watch.
- Roaster notes are descriptors literally present in the roaster's copy. Nothing is invented; OpenAI compares, it does not predict you will like something.
- Feeds carry alert-worthy events only. A baseline crawl fires no alerts. A failed crawl never implies "sold out" or "nothing new"; the watch status says what the system is actually doing.
- Watch status copy tells the truth: "Watching, last checked 4 min ago", "Stale, still checking", "Crawl failed, we'll keep trying".

## Not in this release

Coffee-specific watches, dated logs, log privacy, in-app updates independent of email, add-a-roastery submissions, local scenes, settings page, drop-rhythm prediction, per-route social previews. See ADR-0004.

## Tone

Plain, honest, specific. No gamification, no hype.

## Platform

Web (desktop and mobile browsers). TanStack Router + Tailwind v4 + Convex realtime subscriptions, served from `@convex-dev/static-hosting` on the deployment's `convex.site` origin.
