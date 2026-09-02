# Nouveau — product context

_(Captured from the locked build spec, `docs/build-spec.md` — the binding source.)_

## What it is

Nouveau is the alert layer for US specialty coffee roasters: it crawls roaster shops (Shopify `products.json` / Firecrawl), emits Drop events (`new`, `back_in_stock`, `price_drop`, plus silently-stored `sold_out` / `price_rise`), and lets people watch roasters and get told the moment a drop happens. The roaster's own shop is where the action is; Nouveau links out ("See the lot"), it is not a store.

## Audience & scene

Specialty-coffee people who chase limited drops (Onyx, Sey, Regalia...) and miss them because roasters don't do notifications. They check roaster sites manually, repeatedly, from phones and laptops in the morning. The cold-start proof: the signed-out home shows a real-time global feed of live drops — watching is happening before you sign up.

## Screen inventory (locked, §11)

Home (global feed signed-out / your feed + delivery footers + unhealthy banner signed-in), Directory, Add-roastery flow, Watches page (status chips, mute), Roaster page (Lots grid, drop history, prediction card, watch button, chip), Local scenes, Sign-in (Google only), Settings.

## Feed UX (locked, §8)

- Feeds carry alert-worthy events only: `new`, `back_in_stock`, `price_drop`.
- Personalized cards carry a delivery footer from the notifications ledger; global feed cards stay clean.
- One quiet unhealthy banner above the personalized feed, no per-item noise.
- Watch status chips: "● Watching — last checked 4 min ago", "● Stale — last success 2h ago, still checking", "● Crawl failed — the shop stopped responding; we'll keep trying".

## Tone

Plain, honest, specific. No gamification, no hype. Status copy tells the truth about what the system is doing ("still checking", "we'll keep trying").

## Mode

Operate (scanability, truth of state), with a Persuade duty on the signed-out home: prove the product works before asking for a sign-up.

## Platform

Web (desktop + mobile browsers). TanStack Router + Tailwind v4 + Convex react subscriptions (feeds are real-time).
