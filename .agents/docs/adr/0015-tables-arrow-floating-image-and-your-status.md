---
status: accepted
---

# Every table: an arrow at the row end, a floating image on hover, your own status instead of the crawler's

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Covers `DropTable` (`drop-index.tsx`), the roaster page's lot catalog (`lots.tsx`), the roasters directory (`roasters.index.tsx`), and the new `/drops` route that replaces the feed cards (`feed-card.tsx`, `global-feed.tsx`). Amends the Directory table, Lot catalog, Drop table and Index table entries in `DESIGN.md`.

## Context

The drop table ends each row with a 10 pixel hairline circle that fills on hover and opens the roaster's shop in a new tab. Its hover image slides in over the row number inside the N° cell, 112 pixels wide, the height of the row, desktop only, with focus-within parity. The roasters directory has a Status column showing crawl health (Watching, Stale, Crawl failed, Checking now) and, only when signed in, an unlabelled column with the WATCH / WATCHING toggle; it has no row-end mark and no hover image. The roaster page's catalog ends rows with a Log / Close button that opens the inline log form.

`/feed` is a list of cards. Each card shows the event word, the roaster, a relative time, the lot name, up to three variant names, one price with the old price struck through, a "See the lot" link that in fact opens the roaster's shop, and a "Log" link that in fact opens Nouveau's lot page.

## Decision

**Arrow, not circle.** The row-end mark on every table is a short right arrow. It is a link. It replaces the circle on the drop tables and appears on the roasters directory and the lot catalog too.

**The image floats and follows the cursor.** On hover the lot's photo appears above the table, larger than the row, anchored to the pointer and moving with it across the table, so it never sits inside a cell. It is one element per table, `pointer-events: none`, shown only for a fine pointer; touch gets no hover image. Keyboard focus on a row shows the same image anchored to the row's leading edge, since there is no pointer to follow. The in-cell slide and the fading row number are gone. Tables whose rows have no image (the roasters directory) show nothing.

**The roasters directory shows your status, not the crawler's.** The crawl-health Status column is removed from the directory; health stays on the roaster page's status line, on `/settings/alerts`, and in the owner's watches list. The WATCH / WATCHING toggle column becomes the directory's Status column, labelled as such, showing the viewer's own relation to each roaster. For a signed-out viewer the column is removed entirely rather than filled with sign-in links; the signed-out directory simply has one fewer column, and the header's LOGIN is the sign-in affordance.

**`/drops` is a table.** The feed cards become `DropTable` rows with the landing's filter tabs. The lot name links to the lot page; the row-end arrow is the second link to it. The "Log" action goes; logging happens on the lot page. Rows are per event, as the roaster page is, except that variants dropping together (the same event across multiple weights) are one row, which is how the feed already groups them. The per-variant list goes; the price cell shows the event's own price, with the old price struck through on a price-drop row, and the lot's lowest available price prefixed "from" otherwise.

**Floating image size.** About 280 pixels wide at 3:2, floating above-right of the pointer so the cursor never covers it, clamped inside the viewport. One size lives in the design tokens for every table.

## Considered alternatives

- **Keep the circle.** It was designed as a quiet mark. Testers and the owner read it as decoration. An arrow says "go".
- **Keep the image inside the row.** It is tidy, but at row height a 3:2 coffee bag photo is a thumbnail. A floating image can be large without changing the table's rhythm.
- **Keep both status columns.** Two things called status in one row. The crawler's state is operational and belongs where watches are managed; the directory is where a person decides whether to watch.
- **Keep `/drops` as cards.** The design system already says feed cards become rows; this record only settles the columns.

## Consequences

- Where the arrow goes is the one open question below, because today's circle opens the shop and today's lot name opens the lot page.
- Signed out, the directory loses its Status column; the queries behind it already branch on `optionalUserId`, so the column's absence is a component-level branch on the same value.
- The lot catalog on the roaster page loses its Log / Close cell to the arrow, which means the inline log form on that page goes and logging happens on the lot page only. `lots.tsx`, `log-form.tsx`'s catalog mount, and the tinted second row all simplify.
- The floating image needs the row's image URL on every table row, which the drop queries already return and the catalog and saved queries need to add. The `thumbUrl` size grows from 240 to the floating size (about 280 pixels wide).
- Price-drop rows in `/drops` keep their struck old price because the cell shows the event's price, not the lot's minimum.
- Grouped-variant rows on `/drops` mean the event's price cell may need the group's own price (the dropped variants' price on a price-drop event), which the feed already computes.

## Open questions

None. The arrow goes to the lot page, same as the name: every mark in a row points at Nouveau, and the shop is one click further, on the lot page, where the price and stock line is. Settled by the owner, 2026-09-20.
