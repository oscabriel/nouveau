---
status: accepted
---

# One landing page for both states, ratings in the tiles, Find my next bag as the button

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Supersedes the "Signed-in home" direction in the design handoff of 2026-09-20 (My coffee tables on the home page). Depends on ADR-0011 for links and ADR-0016 for where the personal surfaces go.

## Context

`routes/index.tsx` branches on `useConvexAuth`. Signed out: the hero plate, the NOUVEAU title, the serif lede, the Sign in button, three tiles (`latest-tiles.tsx`), and the drop index table (`drop-index.tsx`) with its filter tabs, all from one `feed.globalFeed` call. Signed in: a scaffold-era `max-w-3xl` page titled "Your roasters" with a Find my next bag link, a Want to try list, the personalized drop feed with delivery lines, and an unhealthy-watch banner. No hero, no tiles, no footer.

The tiles show the three latest drops with photos, a white name chip bottom-left, and a Latest / Shuffle pair marked by an 8 pixel dot before the chosen word. The table's columns are number, lot, roaster, city, origin, process, event, released (as `YYYY.MM.DD`) and price, with a hairline circle at the row end that opens the roaster's shop.

## Decision

**One page.** The signed-in landing is the signed-out landing. The slot the Sign in button occupies becomes **Find my next bag** for a signed-in user, because that is the activity the product wants a signed-in person to do. Nothing personal appears on the home page: the personalized drop feed, the Want to try list and the unhealthy-watch banner move to the owner's view of `/$user` (ADR-0016). The home page is a public index whoever is looking.

**Tiles show ratings.** The three tiles become the three most recent rated logs whose lot has a photo, ordered by log time: the lot's image, the lot's name chip bottom-left as today, and the rating as black star icons in the opposite corner, top-right, on the same white chip treatment so it reads over any photo. Half stars render as the `stars.tsx` half fill. Before three such logs exist, the tiles fall back to the three most recent drops with photos, as today. Shuffle keeps its job and draws three random rated logs. The chosen word in the Latest / Shuffle pair is underlined, like an active nav link; the dot goes.

**Table.** The Process column is removed. Released shows `MM.DD`; the year is implied by an index that holds the fifty most recent drops. The row-end mark, hover image and price cell follow ADR-0015.

## Considered alternatives

- **Keep a personal home for signed-in users.** The design handoff planned it. It splits the product into two front doors and puts the personal record somewhere with no shareable address. `/$user` is that address.
- **Tiles show latest logs regardless of rating.** A log without a rating has nothing to put in the corner; a tile with only a name says less than a drop tile does.
- **Numeric rating in the corner.** The owner asked for stars. Stars also match the lot page and log rows.

## Consequences

- A new public query: the most recent rated logs joined to their lot's image, name, roaster slug and handle, with a limit and a random draw for Shuffle. Per the design-pass rule, that is a backend commit with tests before the tile change. Its rules, settled by the owner: **pad** the tiles with recent drops so the first rating appears the moment it exists; **dedupe by user** when more than three rated logs exist, so one taster cannot fill all three; **Shuffle draws from the most recent fifty** rated logs with photos, keeping the query bounded; **the taster is not named** on the tile, which is already the tile's link rule, so the query need not return the handle.
- The tiles cite a person's log, so the tile links to the lot page, not the log; the taster is not named on the tile.
- The Sign in button and the Find my next bag button share one slot and one primary-button component; the copy and the destination differ by state.
- The unhealthy-watch banner, which today only ever rendered on the signed-in home, needs its new home built in the same pass or it disappears. ADR-0016 places it in the owner's watches section.
- `DESIGN.md`'s drop table entry loses Process and the year.
