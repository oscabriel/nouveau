---
name: Nouveau
description: A live index of specialty coffee. Black type on a white ground, hairline tables, one botanical plate for color.
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
    fontFamily: "EB Garamond Variable, Georgia, Times New Roman, serif"
    fontSize: "17.5vw"
    fontWeight: 400
    fontStyle: italic
    lineHeight: 1
    letterSpacing: "-0.01em"
  lede:
    fontFamily: "EB Garamond Variable, Georgia, Times New Roman, serif"
    fontSize: "clamp(1.5rem, 2vw, 1.875rem)"
    fontWeight: 400
    lineHeight: 1.25
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
  title:
    fontFamily: "EB Garamond Variable, Georgia, Times New Roman, serif"
    fontSize: "clamp(2rem, 3vw, 2.75rem)"
    fontWeight: 400
    lineHeight: 1
    letterSpacing: "normal"
  section:
    fontFamily: "Schibsted Grotesk Variable, Helvetica Neue, Helvetica, Arial, sans-serif"
    fontSize: "clamp(1.25rem, 1.7vw, 1.5rem)"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "normal"
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
  search-field:
    textColor: "{colors.ink}"
    typography: "{typography.cell}"
    height: "44px"
    borderBottom: "1px {colors.rule}"
  status-line:
    textColor: "{colors.grey}"
    typography: "{typography.cell}"
  sheet:
    backgroundColor: "{colors.ground}"
    borderLeft: "1px {colors.rule}"
    width: "28rem"
---

# Nouveau

_Recorded from the built world, 2026-09-16, after the landing redesign; extended 2026-09-18 with the header, `/roasters` and `/roasters/$slug`; amended 2026-09-20 after the design pass (ADRs 0011 to 0017: addresses, chrome, theme, landing, tables, the record, the next-bag pane); amended 2026-09-21 with the serif wordmark and titles. Replaces the earlier "watch tower" system (deep blue, Inter, cool neutrals) in full. References pinned by the owner: theindex.website for structure and type, vanschneider.com/blog for the table row hover. Updated as each further screen ships._

## Overview

Nouveau is an index, not a store. The page is one centered column of sparse black type on white; the data is the composition. There is no UI accent color. The only color on any page is the coffee itself: Thornton's 1808 Coffea arabica branch threaded through the wordmark, and lot photographs in tiles and row hovers. Two faces: a grotesk for every label and cell, a Garamond for the wordmark, the page titles and the one sentence of prose under the wordmark. Rules are hairlines, corners are square, controls are text.

Dark mode inverts the ground and ink and keeps everything else. The theme is a relation to the OS, not a value: it follows the system by default, and the switch inverts it (ADR-0013). A stored absolute value from before is discarded on read.

## Colors

Strategy: restrained to the point of monochrome. Ink on ground, one grey for secondary cells, one tint for row hover, one hairline.

- Ground `oklch(0.995 0 0)`; ink `oklch(0.13 0 0)`. Dark: ground `oklch(0.13 0 0)`, ink `oklch(0.97 0 0)`.
- Grey `oklch(0.52 0 0)` (5.0:1 on ground) for every table cell except the lot name, for inactive tabs and toggles, and for row numbers. Dark: `oklch(0.68 0 0)`.
- Tint `oklch(0.96 0 0)` is the hovered row and the empty tile ground. Dark: `oklch(0.2 0 0)`.
- Rule `oklch(0.88 0 0)` for every hairline. Dark: `oklch(1 0 0 / 14%)`.
- `--primary` is ink; `--ring` is ink. Focus is a 1px ink outline offset 2px.
- Status color lives in the dot only. The crawl-status dot is emerald (watching), amber (stale) or red (failed), 8px, and the line beside it is always grey. Nothing else in UI chrome carries hue.
- Tasting-note pills are the one exception to the no-hue rule, by the owner's brief (2026-09-21): nine soft ground/border pairs, one per SCA wheel family, ink text. Light: ground at L 0.92 to 0.95 with chroma 0.02 to 0.045, border at L 0.6 to 0.82; dark: ground at L 0.26 to 0.28, border at L 0.45 to 0.47. Hues follow the wheel: fruity 20, floral 320, sweet 75, nutty/cocoa 55, spices 40, roasted 60 (low chroma), sour/fermented 105, green/vegetative 145, other 240. The `.pill-*` utilities in `globals.css`. Only the taster's own notes take a color; a word the wheel does not know is a hairline pill; the roaster's notes stay plain text.
- The tile chip is always white on near-black, both themes, because it sits on a photograph. The rating stars on the chip are black (ADR-0014); everywhere else they are ink. No star is amber.

## Typography

- **Schibsted Grotesk Variable** (self-hosted via `@fontsource-variable/schibsted-grotesk`) for labels, tabs, section heads, cells and every control. Stand-in for LL Unica77; the owner will refine.
- **EB Garamond Variable** (`@fontsource-variable/eb-garamond`, self-hosted, upright and italic files) for the wordmark, the inner-page titles and the lede. Regular weight everywhere; italic for the two wordmarks (landing, footer) only. Replaced Source Serif 4 on 2026-09-21.
- Caveat left with the footer captions on 2026-09-21 (ADR-0012 amendment); two families remain.
- The ramp, as used:
  - Label: 11px, weight 500, uppercase, tracking 0.06em, line-height 1. Nav, table headers, footer links, toggles, the sign-in block. The `.label-caps` utility in `globals.css`.
  - Wordmark: Garamond italic, weight 400, uppercase, 17.5vw (about 252px at 1440, 68px at 390), tracking -0.01em, line-height 1. Landing only; the header's NOUVEAU stays a label.
  - Lede: 24px to 30px Garamond, line-height 1.25, `text-balance`, measure capped at 44rem.
  - Title: 32px to 44px Garamond, weight 400, mixed case. Inner-page h1: "Roasters", the roaster's name, "About". Counts follow in 14px grey grotesk tabular figures in parentheses. `page-title.tsx`.
  - Section: 20px to 24px, weight 400. Inner-page h2 ("Drop history", "Lots"), counts in 12px tabular.
  - Tabs: 18px to 24px, weight 400; counts in 12px tabular figures in parentheses.
  - Cells: 14px on mobile, 15px from `md`, line-height snug. Row numbers 12px tabular.
  - Footer wordmark: Garamond italic, weight 400, uppercase, 8.5vw from `md` (about 122px at 1440), 10.5vw below (about 41px at 390), tracking -0.01em, line-height 1. NOUVEAU.COFFEE, `site-footer.tsx`.
  - The marquee (22vw wordmark) is gone with the footer that carried it (ADR-0012).
- Tabular figures (`.tnum`) on dates, prices, counts, and row numbers. Drop dates render `09.16` (month and day; the table is a live index, the year is noise, ADR-0014). Full dates elsewhere render `2026.09.16`.
- The grotesk never goes above weight 600, and it carries no display sizes; the Garamond does that work. The one italic in the app is the wordmark.

## Layout

- Full-width page, gutters 20px (mobile) and 40px (`md`). No max-width container on the landing; the table spans the gutters like the reference.
- Header (`header.tsx`, ADR-0012): one row of caps labels, no bar or rule beneath it. Pads 12px/16px top. Left: NOUVEAU (weight 600), ROASTERS, DROPS. Right: ACTIVITY, LEARN MORE, then LOGIN signed out or the person's first name (fallback handle, never an id) signed in. The name opens a dropdown: Profile, the LIGHT / DARK pair, Settings, Sign out. One `nav`; below `md` it stacks as two left-aligned rows, the left group then the right group under it (owner, 2026-09-21), no flex-wrap. The current route keeps a persistent underline; the name is underlined on the person's own profile. No ModeToggle and no standalone theme word in the header.
- Inner pages (`/roasters`, `/roaster/$roaster`, `/roaster/$roaster/$lot`, `/drops`, `/$user`, `/activity`, `/about`): title row at 40px/56px below the header, full width between the gutters like the landing table. Search field 40px/48px under the title; the table 48px/64px under that. Sections 64px/96px apart. `/activity` is the title with the count, one grey sentence, and the log rows 48px/64px under it; nothing else. `/about` is the title, one grey sentence, then one caps-labeled section per feature, prose 56px/80px apart. Every route ends in the plate footer, mounted once in the root layout.
- Landing order, top to bottom (ADR-0014, one page for both auth states): header, the wordmark with the branch through it (top padding 14vw / 9vw, so the leaves clear the nav), lede (+9vw), the primary slot (+24px; SIGN IN signed out, FIND MY NEXT BAG signed in), LATEST / SHUFFLE and three 3:2 tiles (+64px / +56px, so the tiles start above the fold at 1440×900), filter tabs and the drop table (+64px / +80px), footer (+128px / +160px). The signed-in scaffold home is gone.
- The next-bag pane (`sheet.tsx` in `@nouveau/ui`, `next-bag-sheet.tsx`, ADR-0017): a dialog fixed to the right edge, full width below `md` and 28rem from it, ground-colored, a hairline on its left edge, no shadow, no backdrop tint. It slides in over 300ms ease-out and snaps under `motion-reduce`. Open state is the root search param `?bag=true`, so it opens over whatever page the person is on and Back closes it. Inside: FIND MY NEXT BAG and CLOSE as caps labels, the text box as a search field, INCLUDE MY LOGS as a toggle with FIND at the right, then the run.
- Tiles: 3 columns from `md`, gap 24px; stacked with gap 16px below.
- Table: `border-collapse`, hairline under the header row and under every body row. Row padding 20px top and bottom, 16px right per cell (12px on mobile). Drop table column order N°, Lot, Roaster, City, Origin, Event, Released, Price, arrow (ADR-0014, 0015): no Process, no year. City shows from `lg`, Origin from `md`, Price from `sm`.
- Root layout is a grid with `grid-cols-[minmax(0,1fr)]` so a wide table can never widen the page.
- Breakpoints as Tailwind defaults: `sm` 640, `md` 768, `lg` 1024.

## Elevation & Depth

None. No shadows anywhere. Depth is photograph over ground, and the chip over the photograph. Selection is inverted (ink ground, page-colored text).

## Shapes

- `--radius: 0`. Every box is square: buttons, chips, tiles, inputs, popovers.
- The only round shapes are dots: the 8px toggle indicator, the status dots on inner pages, and the pulsing 8px dot on the pane's status line while a run works. The shop-link circle is gone (ADR-0015); rows end in an arrow: right for a link into Nouveau, up-right for the roaster's shop.

## Components

- **Caps link** (`link-caps`): label type, 44px hit area, underline on hover. Header, footer, toggles, sign-in and sign-out.
- **Primary button** (`button-primary`): ink block, ground-colored label type, 44px tall, 20px side padding, opacity 0.8 on hover. The one filled control, and it marks the one primary action on a screen: SIGN IN WITH GOOGLE (`sign-in-cta.tsx`), FIND MY NEXT BAG on the landing and the profile (`next-bag-sheet.tsx`), and Save on `/settings/account` (ADR-0014).
- **Toggle pair** (LATEST / SHUFFLE): two caps buttons, `aria-pressed`, the active one in ink and underlined like an active nav link, the inactive one in grey. The dot is gone (ADR-0014). The dot toggle below keeps it.
- **Dot toggle** (`dot-toggle.tsx`): a caps word with an 8px dot before it. On is ink with the dot filled; off is grey with the dot faded, going ink on hover. `aria-pressed` carries the state; `busy` disables the button and pulses the dot while a mutation runs. One component, five mounts: WATCH / WATCHING, SAVE / SAVED, RATE IT in the log form, INCLUDE MY LOGS in the pane, and each side of the LIGHT / DARK switch.
- **Stars** (`stars.tsx`): five 16px stars with half-step fills, filled ones in the current text color (ink on the page, black on the tile chip), empty ones at 40% grey. `sr-only` reads "Rated n out of 5". The log row, the log form and the tile chip.
- **Tasting pill** (`tasting-pill.tsx`): 28px tall, 1px border, 10px side padding, 13px text, the family's `.pill-*` class or the hairline. On log cards each pill links to `/drops?family=` (underline on hover); a word without a family never links. **Tasting tags input** (`tasting-tags-input.tsx`): the log form's field, pills in a row over one hairline with the text input flowing after them; Enter or a comma commits a word, the x on a pill or Backspace on an empty field removes one, the input disappears at eight.
- **Tile** (`latest-tiles.tsx`): 3:2 link, `object-cover` photo, tint ground while loading, white chip bottom-left with the lot name (13px, 6px/10px padding, truncated to the tile width) and the log's rating as black stars top-right with the rater's name under them (11px, grey 600, underlines on hover) linking their `/$user` page. The chip is a sibling of the lot link inside the `li`, so the two links never nest. The pool is the most recent rated logs with a photo, one per taster, padded and shuffled server-side (ADR-0014). Links to `/roaster/$roaster/$lot`.
- **Tabs**: centered `role="tablist"`, hairline under the group, active tab in ink with an ink hairline that overlaps the group rule (`-mb-px`), inactive in grey. Counts in tabular figures. On the landing and `/drops` they filter the drop table by event type. The Your roasters tab is gone (2026-09-21); MY ROASTERS is a dot toggle in the filter row.
- **Search field** (`search-field.tsx`): one line of cell type over a hairline, 44px tall, no box; the hairline goes ink on focus. The placeholder is the label. The browser's search clear button is hidden.
- **Status line** (`status-chip.tsx`): colored 8px dot, grey text. Compact form (dot plus the state word) in table cells; full line ("Watching, last checked 4 min ago") on the roaster page. The dot pulses while a crawl is in flight.
- **Watch toggle** (`watch-button.tsx`): the dot toggle for a roaster. WATCH in grey; WATCHING in ink.
- **Save toggle** (`save-button.tsx`): the dot toggle for a lot. SAVE in grey; SAVED in ink. Signed out it renders nothing, since the try list is private. On the lot page, the try list, other people's log rows and the next-bag cards.
- **Log row** (`log-card.tsx`, ADR-0016): one line of cell type under a hairline: taster (ink), "tried" in grey, the lot name in ink at weight 600, "from" and the roaster in grey, the relative time in 12px tabular at the right. The profile drops the taster, the lot page drops the lot. Below: the stars, the review at `max-w-prose`, then a two-column list with caps TASTING NOTES and ROASTER NOTES labels and grey values, the picks joined by middle dots. The Save toggle on another taster's row; EDIT and DELETE as caps actions on one's own. `/activity`, `/$user` and the lot page.
- **Log sheet** (`LogSheet` in `log-form.tsx`, batch 8): the log form in the same right-edge pane as Find my next bag (28rem from `md`, full width below, hairline left, 10% ink backdrop). Header row: LOG THIS LOT or EDIT LOG as the caps title, CLOSE right; the lot's name under it in cell type. Fields 32px apart under caps labels: RATING as the stars input, TASTING NOTES as the tags input with "The roaster says: …" in 12px grey under it when the lot has roaster notes, REVIEW as one line of cell type on a hairline that grows with the text; SAVE LOG (UPDATE LOG when editing) in ink and CANCEL in grey as caps actions. Opened by LOG THIS LOT on the lot page and EDIT on the viewer's own log rows. The inline form and the RATE IT toggle are gone.
- **Stars input** (`stars-input.tsx`): five 24px stars, click or drag across them in half steps, the half under the pointer previewing on hover; the value in 12px tabular grey and CLEAR beside them once set; unrated is all stars faded. The accessible control is a visually hidden range (0 to 5 by halves) that the keyboard drives; a focus ring shows around the stars.
- **Caps action** (Check now, Load more, Close, Retry, Add a roaster): a caps link that happens to be a button. Disabled goes grey with no underline.
- **Arrow cell** (`ArrowCell` in `table.tsx`, ADR-0015): every table row ends in a short right arrow (14px, 1.5 stroke) in a 24px hit area. The cell is a link into Nouveau: the lot page on drop tables and the catalog, the roaster page on the directory. Nothing in a row leaves the site.
- **Hover image** (`TableHoverImage` in `table.tsx`, ADR-0015): one fixed element per table, the lot photo at 280px wide and 3:2, floating above-right of the pointer and clamped to the viewport, fine pointers only. Focus shows it at the row's leading edge. Rows opt in with `data-image-url`; the directory mounts none.
- **Directory table** (`roasters.index.tsx`, ADR-0015): N°, Roaster (ink link), City (from `sm`), Lots (from `sm`, right, tabular: the roaster's current lots, counted at crawl time and stored on the roaster), New (from `md`, right, tabular: current lots first seen inside the last seven days), Watchers (from `md`, right, tabular), Status (signed in only: the WATCH / WATCHING control, the person's status, not the crawler's), arrow. No crawl-health column; health stays on the roaster page's status line.
- **Lot catalog** (`lots.tsx`, ADR-0015): N°, Lot (archived lots grey with a caps ARCHIVED tag), Roaster notes (from `md`, grey, truncated), Origin (from `lg`), Price, arrow. No Log cell and no inline form; logging lives on the lot page.
- **Drop table** (`DropTable` in `drop-index.tsx`, ADR-0015): one row per drop event, co-dropping variants grouped, generic over its row. `showRoaster={false}` drops the Roaster and City columns on a roaster's own page. Price is the event price with the old price struck through on a price drop, `from` plus the minimum otherwise. A caller may hand it an `underRow` (the delivery line under MY ROASTERS on `/drops`) that spans the table's own column count.
- **Drop filter row** (`DropFilterRow` in `routes/drops.tsx`, batch 8): under the tabs, 32px down, the `Lots` filter idiom: MY ROASTERS dot toggle first when signed in, then hairline selects for roaster and city (choices are the values in the loaded rows), an origin search input (substring), a tasting-note family select (the nine wheel families), a `≤ $ price` number input (the event's new price, else the lot's minimum), and CLEAR in grey when anything is set. All client-side over the loaded 100 rows; the tabs' counts stay whole-feed. `?family=` seeds the family select. No TanStack Table: the three tables share no column state and none sorts, so a dependency would buy nothing.
- **Index table** (`drop-index.tsx`): the landing's drop table collapsed to one row per lot (newest event wins) under the filter tabs. Row numbers in grey, lot name in ink linking to the lot page, roaster in grey linking to the roaster page, everything else grey. Row hover: tint ground and the floating hover image. The in-cell slide, the fading number and the circle are gone.
- **Cards** (`next-bag-run.tsx`, ADR-0017): the one place cards are allowed. Each is a fixed component over validated fields from the run document, in a hairline-divided list, appearing with a 300ms fade as its `pickLot` call lands: rank in grey tabular, 88px 3:2 photo, lot name in ink (15px, weight 600) linking its page, roaster · price · grams in grey, the model's why in cell type, then the Save toggle and BUY with an up-right arrow. Step lines above them while the run works: a 64px caps label column (SEARCH, CHECKED, PAGE READ, YOUR LOGS) and grey tabular detail. The steps go when the run settles.
- **Lot page** (`roaster.$roaster.$lot.tsx`, ADR-0016): the inner-page shell. Title row with the lot name and, on the right, the Save toggle, LOG THIS LOT and BUY with an up-right arrow (the one outbound link in the title row); under it a grey line with the roaster (link) and ARCHIVED or SOLD OUT as a caps word after a middle dot. Then a three-column grid: the photo at 3:2 on tint in the first column, the fact list in the other two (caps label, value, hairline per row; only published facts), ROASTER NOTES under a caps label, a pulsing grey dot with "Reading the roaster's page for more" while a page read is pending, the roaster's copy at `max-w-prose`. Sizes is a section-scale h2 over the hairline table (Size, Grind from `sm`, Price, Stock, and an up-right arrow to the exact size on the shop; sold-out rows go grey). Logs is the same h2 with the count, the log form under it while logging, rows with `showLot={false}`, and SIGN IN WITH GOOGLE under the rows signed out.
- **Workbench** (`/nerd-stuff`, `components/nerd/`, ADR-0018): the one route at workbench density, a departure scoped to this page by the owner (2026-09-21): 13px rows, 12px padding, an inline serif title instead of `PageTitle`, everything on screen at once. The tokens that still hold: no accent hue, no chips, square corners, hairlines. Four parts. The stat strip (`stat-strip.tsx`) is six ink cells like `button-primary`, the one ink block on the page, caps labels over the run's totals. The stage track (`live-row.tsx`) is six caps cells over one hairline, FEED GATE PAGE JEV CUT STORE; passed cells ink, the one in flight ink with the 6px grey reading dot and its elapsed time, the rest grey. The trace row (`trace-row.tsx`) is one button under a hairline: the outcome word in caps at the left, the lot name in ink, the timings in grey under it, the kept facts as one grey line joined by middle dots, and the arrow cell into the lot page. The trace detail (`trace-detail.tsx`) groups every judgment by the mechanism that made it, one row each: caps label, the value (grey and struck through when dropped), the runner-up in grey after it, a 2px ink-on-hairline probability bar, the percentage in tabular figures, KEPT or DROPPED. From `lg` the detail is the sticky right column; below it opens inline under its row.
- **Footer** (`site-footer.tsx`, ADR-0012, amended 2026-09-21): one link row mirroring the header: NOUVEAU, ROASTERS, DROPS left, BACK TO THE TOP centered, ABOUT, GITHUB right; no user links. Below `md` the row stacks as three left-aligned rows: the left links, BACK TO THE TOP, then ABOUT and GITHUB, no flex-wrap. Under the hairline NOUVEAU.COFFEE in the landing wordmark's Garamond italic, right-aligned from `md`, centered and full-width below, and the flower (`02-five-stamina.webp`, linking the Coffea arabica article, fading to 0.8 on hover) under it, the bottom-most element on the page (owner, 2026-09-21; beside the wordmark before). The webp is square with the drawing at 448x361 of the 540x540 canvas (symmetric margins), so the element rides at the wordmark's own font-size from `md` (10.5vw below is not matched; the flower stays 128px there), and the visible drawing then sits at the caps' cap height. The other five details and their Caveat captions are gone. Mounted once in the root layout.
- **Wordmark** (`Wordmark` in `routes/index.tsx`): one `h1` with `aria-label="Nouveau"`, three layers deep. NOU and EAU sit at the back; the branch (`/coffea-arabica.webp`, transparent, `fetchPriority="high"`) is absolutely centered on the V's box at 2.05em tall, shifted up 4%, and paints over them; the V sits in front of the branch. Anchoring the image to the V's own span keeps it threaded through the word at every width. Owner's mock, 2026-09-21; overrides the earlier grotesk caps wordmark and the standalone plate above it.
- **Plate assets** (`apps/web/src/assets/coffea-arabica/*.webp`, ADR-0012): serving-size exports of the six details and the branch, cream fringe fixed. `apps/web/public/coffea-arabica.webp` is the trimmed branch (1112×1160, from the defringed `01-branch.webp`) that the wordmark carries; there is no standalone hero image anymore.
- **Favicon** (`apps/web/public/favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`; linked from `index.html`): the seed drawing (`06-seed.webp`) trimmed and squared. The two favicons are 32px on a transparent ground; the 180px Apple touch icon sits on white because iOS fills transparency with black. No manifest, so no larger sizes.

## Do's and Don'ts

- Do let the data be the page: hairline tables, caps headers, grey cells, ink for the one thing the row is about.
- Do keep every control as text or an arrow; the filled ink block is for the one primary action on a screen (sign in, FIND MY NEXT BAG, the account Save). Form submits elsewhere (SAVE LOG) are caps actions.
- Do use photographs of the coffee for color. Never add an accent color to UI chrome.
- Do keep dark mode a straight inversion; no tinted darks.
- Don't use cards, borders around content groups, rounded corners, shadows, or gradients. The one exception is the next-bag shortlist (ADR-0017), where each pick is a fixed card over validated fields; nothing else gets one.
- Don't put a kicker or eyebrow above a heading; the toggles and tabs are controls, not labels for the section under them.
- Don't use Inter, the deep blue, or the two-column pitch-plus-feed landing; that system is gone.
- Don't render a lot without a photo in the tiles; it belongs in the table only.

Not canonized: `/roasters/submit` and `/settings/alerts` inherit the tokens and shared controls only. The old routes (`/lots/$lotId`, `/feed`, `/next-bag`, `/watches`, `/saved`, `/profile/$userId`, `/roasters/$slug`) are redirects to the ADR-0011 map (`/roaster/$roaster/$lot`, `/drops`, `/?bag=true`, `/$user`) and have no layout of their own.
