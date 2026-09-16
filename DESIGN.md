---
name: Nouveau
description: A live index of American specialty coffee. Black type on a white ground, hairline tables, one botanical plate for color.
colors:
  ground: "oklch(0.995 0 0)"
  ink: "oklch(0.13 0 0)"
  grey: "oklch(0.52 0 0)"
  tint: "oklch(0.96 0 0)"
  rule: "oklch(0.88 0 0)"
  ground-dark: "oklch(0.13 0 0)"
  ink-dark: "oklch(0.97 0 0)"
  grey-dark: "oklch(0.68 0 0)"
  tint-dark: "oklch(0.2 0 0)"
  rule-dark: "oklch(1 0 0 / 14%)"
typography:
  label:
    fontFamily: "Schibsted Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0.06em"
  wordmark:
    fontFamily: "Schibsted Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.75rem, 2.5vw, 2.25rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
  lede:
    fontFamily: "Source Serif 4 Variable, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.375rem, 2vw, 1.75rem)"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "normal"
  tab:
    fontFamily: "Schibsted Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.125rem, 1.7vw, 1.5rem)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "normal"
  cell:
    fontFamily: "Schibsted Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.375
    letterSpacing: "normal"
  marquee:
    fontFamily: "Schibsted Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "22vw"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.02em"
rounded:
  none: "0px"
  dot: "9999px"
spacing:
  gutter: "20px"
  gutter-md: "40px"
  row: "20px"
  section: "80px"
  section-md: "112px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0 20px"
    height: "44px"
  link-caps:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    height: "44px"
  table-head:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 16px 12px 0"
  table-cell:
    textColor: "{colors.grey}"
    typography: "{typography.cell}"
    padding: "20px 16px 20px 0"
  table-cell-lot:
    textColor: "{colors.ink}"
    typography: "{typography.cell}"
    padding: "20px 16px 20px 0"
  table-row-hover:
    backgroundColor: "{colors.tint}"
  tile-chip:
    backgroundColor: "#ffffff"
    textColor: "#0a0a0a"
    padding: "6px 10px"
  tab-active:
    textColor: "{colors.ink}"
    typography: "{typography.tab}"
  tab-inactive:
    textColor: "{colors.grey}"
    typography: "{typography.tab}"
---

# Nouveau

_Recorded from the built world, 2026-09-16, after the landing redesign. Replaces the earlier "watch tower" system (deep blue, Inter, cool neutrals) in full. References pinned by the owner: theindex.website for structure and type, vanschneider.com/blog for the table row hover. Updated as each further screen ships._

## Overview

Nouveau is an index, not a store. The page is one centered column of sparse black type on white; the data is the composition. There is no UI accent color. The only color on any page is the coffee itself: Thornton's 1808 Coffea arabica plate in the hero, and lot photographs in tiles and row hovers. Two faces: a grotesk for every label and cell, a text serif for the single sentence of prose under the wordmark. Rules are hairlines, corners are square, controls are text.

Dark mode inverts the ground and ink and keeps everything else. The default theme is light.

## Colors

Strategy: restrained to the point of monochrome. Ink on ground, one grey for secondary cells, one tint for row hover, one hairline.

- Ground `oklch(0.995 0 0)`; ink `oklch(0.13 0 0)`. Dark: ground `oklch(0.13 0 0)`, ink `oklch(0.97 0 0)`.
- Grey `oklch(0.52 0 0)` (5.0:1 on ground) for every table cell except the lot name, for inactive tabs and toggles, and for row numbers. Dark: `oklch(0.68 0 0)`.
- Tint `oklch(0.96 0 0)` is the hovered row and the empty tile ground. Dark: `oklch(0.2 0 0)`.
- Rule `oklch(0.88 0 0)` for every hairline. Dark: `oklch(1 0 0 / 14%)`.
- `--primary` is ink; `--ring` is ink. Focus is a 1px ink outline offset 2px.
- Semantic status colors (emerald healthy, amber stale, red failed) survive from the incumbent status chips and are outside the token set; they are the only colored UI on inner pages until those pages are redesigned.
- The tile chip is always white on near-black, both themes, because it sits on a photograph.

## Typography

- **Schibsted Grotesk Variable** (self-hosted via `@fontsource-variable/schibsted-grotesk`) for everything but the lede. Stand-in for LL Unica77; the owner will refine.
- **Source Serif 4 Variable** (`@fontsource-variable/source-serif-4`) for the lede only. Stand-in for LL Catalogue.
- The ramp, as used:
  - Label: 11px, weight 500, uppercase, tracking 0.06em, line-height 1. Nav, table headers, footer links, toggles, the sign-in block. The `.label-caps` utility in `globals.css`.
  - Wordmark: 28px to 36px, weight 600, uppercase, tracking 0.01em.
  - Lede: 22px to 28px serif, line-height 1.3, `text-balance`, measure capped at 44rem.
  - Tabs: 18px to 24px, weight 400; counts in 12px tabular figures in parentheses.
  - Cells: 14px on mobile, 15px from `md`, line-height snug. Row numbers 12px tabular.
  - Marquee: 22vw, weight 600, tracking -0.02em, line-height 1, cropped at 16.5vw container height so the baseline falls below the fold.
- Tabular figures (`.tnum`) on dates, prices, counts, and row numbers. Dates render `2026.09.16`.
- No display face beyond the grotesk at weight 600. No italics in UI.

## Layout

- Full-width page, gutters 20px (mobile) and 40px (`md`). No max-width container on the landing; the table spans the gutters like the reference.
- Header: one row of caps labels, wordmark first, actions right, no bar or rule beneath it. Pads 12px/16px top.
- Landing order, top to bottom: header, plate (224px / 272px tall), wordmark (+40px / +48px), lede (+16px), sign-in block (+36px), LATEST / SHUFFLE toggles and three 3:2 tiles (+80px / +112px), centered tabs and the table (+80px / +112px), footer marquee and link row (+128px / +160px).
- Tiles: 3 columns from `md`, gap 24px; stacked with gap 16px below.
- Table: `border-collapse`, hairline under the header row and under every body row. Row padding 20px top and bottom, 16px right per cell (12px on mobile). Column order N°, Lot, Roaster, City, Origin, Process, Event, Released, Price, shop link. City and Process show from `lg`, Origin from `md`, Event and Price from `sm`.
- Root layout is a grid with `grid-cols-[minmax(0,1fr)]` so a wide table can never widen the page.
- Breakpoints as Tailwind defaults: `sm` 640, `md` 768, `lg` 1024.

## Elevation & Depth

None. No shadows anywhere. Depth is photograph over ground, and the chip over the photograph. Selection is inverted (ink ground, page-colored text).

## Shapes

- `--radius: 0`. Every box is square: buttons, chips, tiles, inputs, popovers.
- The only round shapes are dots: the 8px toggle indicator, the 10px shop-link circle (1px stroke, fills on row hover), and the status dots on inner pages.

## Components

- **Caps link** (`link-caps`): label type, 44px hit area, underline on hover. Header, footer, toggles, sign-in and sign-out.
- **Primary button** (`button-primary`): ink block, ground-colored label type, 44px tall, 20px side padding, opacity 0.8 on hover. The one filled control. Used for "Sign in with Google" (`sign-in-cta.tsx`).
- **Toggle pair** (LATEST / SHUFFLE): two caps buttons, `aria-pressed`, the active one in ink with a filled 8px dot before it, the inactive one in grey with the dot faded out.
- **Tile**: 3:2 link, `object-cover` photo, tint ground while loading, white chip bottom-left with the lot name (13px, 6px/10px padding, truncated to the tile width). Links to `/lots/$lotId`.
- **Tabs**: centered `role="tablist"`, hairline under the group, active tab in ink with an ink hairline that overlaps the group rule (`-mb-px`), inactive in grey. Counts in tabular figures.
- **Index table** (`drop-index.tsx`): one row per lot (newest event wins), row numbers in grey, lot name in ink linking to the lot page, roaster in grey linking to the roaster page, everything else grey. Row hover: tint ground, the number fades out, and the lot photo (112px wide, row height) slides in from the left over the number cell with a 300ms ease-out; `motion-reduce` snaps. Focus-within triggers the same. The circle at the row's end opens the roaster's shop in a new tab and fills on hover.
- **Footer** (`site-footer.tsx`): the wordmark NOUVEAU.COFFEE at 22vw, two copies scrolling left over 60s (`@keyframes marquee`, translate -50%), static under `motion-reduce`. Below it one row: left links (Roasters, Activity, Feed), BACK TO THE TOP centered, right links (Sign in or Watches, GitHub).
- **Mode toggle**: ghost icon button, no border. Redesign pending.
- **Hero plate**: `apps/web/public/coffea-arabica.png`, 580×900, provenance embedded in the PNG comment. Rendered at 224px / 272px tall with `fetchPriority="high"`.

## Do's and Don'ts

- Do let the data be the page: hairline tables, caps headers, grey cells, ink for the one thing the row is about.
- Do keep every control as text or a hairline circle; the filled ink block is for sign-in only.
- Do use photographs of the coffee for color. Never add an accent color to UI chrome.
- Do keep dark mode a straight inversion; no tinted darks.
- Don't use cards, borders around content groups, rounded corners, shadows, or gradients.
- Don't put a kicker or eyebrow above a heading; the toggles and tabs are controls, not labels for the section under them.
- Don't use Inter, the deep blue, or the two-column pitch-plus-feed landing; that system is gone.
- Don't render a lot without a photo in the tiles; it belongs in the table only.

Not canonized: the hero PNG still carries a cream fringe from the flood-fill matte, visible against the dark ground. That is a defect awaiting a proper alpha matte, not a texture rule. Inner routes (`/roasters`, `/lots/$lotId`, `/feed`, `/activity`, signed-in home, `/next-bag`, and the rest) still run their scaffold-era layouts and inherit only the tokens; their composition is not yet part of this system.
