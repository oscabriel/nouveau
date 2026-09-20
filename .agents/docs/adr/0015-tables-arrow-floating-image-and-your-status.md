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

**The roasters directory shows your status, not the crawler's.** The crawl-health Status column is removed from the directory; health stays on the roaster page's status line, on `/settings/alerts`, and in the owner's watches list. The WATCH / WATCHING toggle column becomes the directory's Status column, labelled as such, showing the viewer's own relation to each roaster.

**`/drops` is a table.** The feed cards become `DropTable` rows with the landing's filter tabs. The lot name links to the lot page; the row-end arrow is the second link to it. The "Log" action goes; logging happens on the lot page. The variant list goes; the price cell shows the lot's lowest available price, prefixed "from" when the lot is also sold in a larger or dearer size.

## Considered alternatives

- **Keep the circle.** It was designed as a quiet mark. Testers and the owner read it as decoration. An arrow says "go".
- **Keep the image inside the row.** It is tidy, but at row height a 3:2 coffee bag photo is a thumbnail. A floating image can be large without changing the table's rhythm.
- **Keep both status columns.** Two things called status in one row. The crawler's state is operational and belongs where watches are managed; the directory is where a person decides whether to watch.
- **Keep `/drops` as cards.** The design system already says feed cards become rows; this record only settles the columns.

## Consequences

- Where the arrow goes is the main open question below, because today's circle opens the shop and today's lot name opens the lot page.
- Signed out, the directory's Status column has no relation to show. It needs a defined state (empty, or a SIGN IN caps link that starts the sign-in flow).
- The lot catalog on the roaster page loses its Log / Close cell to the arrow, which means the inline log form on that page goes and logging happens on the lot page only. `lots.tsx`, `log-form.tsx`'s catalog mount, and the tinted second row all simplify.
- The floating image needs the row's image URL on every table row, which the drop queries already return and the catalog and saved queries need to add. The `thumbUrl` size grows from 240 to whatever the floating size is.
- Price-drop rows in `/drops` lose their per-event struck price if the cell shows the lot's minimum instead of the changed variant's price. That is the second open question.
- `/drops` collapsing to one row per lot (as the landing does) or keeping one row per event (as the roaster page does) is the third.

## Open questions

- **Arrow destination.** Same page as the lot name (Nouveau's lot page), or the roaster's shop as the circle did. Recommendation: the lot page, so every mark in a row goes to Nouveau and the shop is one click further, on the lot page, where the price and stock line is. If the shop link stays, it should use the up-right arrow the feed card already uses for external links, so the two arrows say different things.
- **Price cell on `/drops`.** The lot's lowest available price with "from", as decided, loses the old-price strike on a price-drop row. Options: keep the strike when the event is a price drop and the dropped variant is the cheapest; or show the event's own price on `/drops` and the "from" price elsewhere. Recommendation: the event's price with its strike on a price-drop row, "from" the minimum otherwise.
- **One row per lot or per event on `/drops`.** The landing collapses; the roaster page does not. A feed is a log of events, so per event is the natural reading; a lot that dropped and restocked in a week would then appear twice.
- **Floating image size.** Not set. Something near 240 pixels wide at 3:2, offset from the pointer so the cursor never covers it, and clamped inside the viewport.
- **Directory rows for a signed-out viewer.** Empty Status cell or SIGN IN link. Recommendation: SIGN IN in the caps link style, which also gives the signed-out directory a reason to exist.
