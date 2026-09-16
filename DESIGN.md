# DESIGN.md

_Recorded from the built world, 2026-09-16, after the tokens commit (7968674) and the landing redesign (ee8ddf2). Updated as each screen of the design pass ships._

## World

Nouveau's visual world is a watch tower, not a store: a light neutral ground with graphite type, one deep blue action color, and hairline-divided lists that read like a live wire. No card stacks, no decorative dashboards; the data is the decoration.

## Tokens (`packages/ui/src/styles/globals.css`)

- Ground: light `oklch(0.988 0.003 255)`; dark `oklch(0.17 0.01 258)`. Both carry a faint cool cast; cards stay white (dark: `oklch(0.215 0.012 258)`).
- Text: graphite `oklch(0.22 0.012 258)` light, `oklch(0.96 0.004 255)` dark. Muted foreground `oklch(0.5 0.015 258)` / `oklch(0.7 0.012 258)`.
- Action: deep blue `oklch(0.44 0.14 262)` as `--primary` (buttons, primary links, focus rings). Dark theme lifts it to `oklch(0.72 0.11 262)` on dark text. Ring follows the blue.
- Radius: `--radius: 0.5rem` (tight, for the compact-list direction); pills go full-round.
- Face: Inter Variable throughout. Display treatment is weight and tracking (`font-semibold tracking-tight`, `text-balance`), not a second face. Change only with a durable system decision.
- Status colors are semantic, outside the token set: emerald for healthy/live, amber for stale, red for crawl-failed, emerald for price drops.

## Composition rules (established by the landing)

- Feeds are hairline-divided rows (`divide-y`), not cards. One row = type label, roaster, lot name, variant/price right, relative time, then links.
- Persuade layout (signed-out home): pitch rail left, live feed right, hairline vertical divider; pitch sticks at desktop so the CTA stays in view. Feed teaser capped at 8 rows; "Full feed" link carries the rest. No kicker above the headline; a motion-safe pulse dot marks "Live now".
- Touch targets: 44px (`min-h-11`) for primary actions, `min-h-10` in the header, `min-h-9` for secondary pills.
- Motion: one authored moment (the live pulse), `motion-safe` everywhere.
- Copy: `PRODUCT.md` tone; "Sign in" under 390px, "Sign in with Google" above.

## Screens covered

- Signed-out `/` (landing): committed `ee8ddf2`. Screenshots in `.impeccable/review/`.
- Signed-in home (`/`): unchanged; its redesign is a later task in the pass.
