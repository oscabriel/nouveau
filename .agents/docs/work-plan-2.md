# Work plan 2: the owner's list of 2026-09-21 (after the design pass)

Recorded from the owner's brief, screenshots included as written. The order and grouping below are the next session's call; nothing here is decided yet. Where the current state of the code matters for a decision, the note says so.

State when this plan was written: `main` at `2a06d49`; dev (`cool-giraffe-632`) and prod (`artful-chameleon-402`) both carry pieces 1 to 5 of the nerd-stuff plan (the prod deploy happened just before this file). Prod's `appConfig.workbenchUserId` is still unset. The hackathon closes 2026-09-22 at noon Pacific, so late items land after it.

## Decisions (owner, 2026-09-21, before work started)

- **OG images and shareable review links are dropped for the hackathon.** The app is a SPA on `@convex-dev/static-hosting`; link crawlers do not run JS, so per-review `og:image` tags cannot be served without a second HTML origin. Batch 3 shrinks to one static `og:image` in `index.html` for the whole app. The owner supplies the image (`apps/web/public/og.png`, 1200x630).
- **Footer flower.** Side by side with NOUVEAU.COFFEE from `md` (flower left, bottoms flush); stacked under it below `md`. ADR-0012 gets a further amendment.
- **Settings.** `/settings/account` already edits name and handle. Alerts and Account become tabs under `/settings`. The account page shows the profile URL prefix as `nouveau.coffee/` (unless it is derived from the running origin). "Username" in the brief is the handle.
- **Weight unit.** Grams stay canonical in the database. `users.weightUnit` is `"metric" | "imperial"`, metric when unset. Display converts everywhere a weight renders: g/kg for metric, oz/lb for imperial. Imperial snaps to the nearest typical bag size (2, 8, 12, 18 oz; 1, 2, 5 lb) since the stored grams are usually a conversion of one of those.
- **Mobile nav.** Two vertical columns below `md`, left links and right links, header and footer both. The footer drops BACK TO THE TOP below `md`.
- **Landing lede** stays "Never forget your favorite cup or miss the next big drop." (committed as `0e26bd8`).
- **Cursor glow** is a radial gradient masked to the branch's alpha, following `mousemove`; off on touch and under `prefers-reduced-motion`.
- **About page image** is the existing hero webp, captioned "Coffea arabica, Robert John Thornton, 1808" linking to the Wikipedia article.

## Ground rules (carried over from work-plan.md)

- Backend changes are separate commits with tests before the UI that uses them. A new query field or a new user field is a backend commit, never a drive-by inside a design change.
- Read `.agents/docs/convex-guidelines.md` before backend work and `.agents/docs/code-standards.md` before calling a batch done.
- Design changes never change behavior. Where a task does both, split the commits.
- Stage files by name, never `git add -A`; the owner may have uncommitted edits in the tree.

## Batch 1: chrome and tables (independent, quick)

- [x] **About page branch image.** Put the branch image (really big) on the right side of `/about`, in the space that is currently empty, and hide it on smaller screens. Give it an image caption crediting Robert John Thornton (the plate is his 1808 `Coffea arabica`; the footer's Caveat captions already name the sources, so match their wording and link style).
- [x] **Landing branch image: link and glow.** Two additions to the branch that sits in front of the V in the landing wordmark: it links to the `Coffea arabica` page on Wikipedia, and a subtle glow inside the image follows the cursor.
- [x] **Mobile nav, header and footer.** The current mobile layout drops the links into whatever rows the widths allow (`work-plan-2-images/mobile-nav-current.png`). What the owner wants, mocked up in Affinity: the three left links and the three right links stacked vertically on both header and footer (`work-plan-2-images/mobile-nav-stacked-mock.png`). A stacking fix landed 2026-09-21 (`f1fd30e`); compare against the mock before deciding whether this is a re-do or a refinement.
- [x] **Desktop footer flower.** The stamen flower drifted below the wordmark (`work-plan-2-images/footer-flower-below-wordmark.png`). It belongs to the left of the wordmark, left aligned but vertically in line with it. Note: the footer was reworked twice on 2026-09-21 (`60eb47b`, `087711e`, then `2a06d49`) and the last state stacks the flower under NOUVEAU.COFFEE by design (ADR-0012 as amended), so this may be a regression to fix or a direction to re-amend; check the ADR before touching it.
- [x] **Dropdown link clickable area.** In the header dropdown the hover/click region stops at the end of the link's word (`work-plan-2-images/dropdown-link-width.png`); extend it to the full width of the dropdown.
- [x] **Circle icon consistency.** The dot-circle beside a button means selected, its absence means not selected (`work-plan-2-images/circle-icon-inconsistent.png`). It is inconsistent today: `/roasters` shows it for WATCH/WATCHING and `/drops` for MY ROASTERS, and it is missing where it should appear: the `/` route's LATEST/SHUFFLE buttons and the LIGHT/DARK toggle in the nav dropdown. A `DotToggle` component already exists (`ec654b0`); this is an audit of which buttons use it and which render the dot by other means.
- [x] **H1/H2 layout audit on inner pages.** `/roasters`, `/about`, `/activity` and `/drops` carry slightly different spacing between their H1 and H2. Verify the font sizes and styles are the same and normalize the spacing.
- [x] **Tasting pills in every table.** Lot notes shown in tables (roaster catalog, `/drops`, profile tables, wherever they appear) should use the colored `TastingPill` styling added for user reviews (`work-plan-2-images/tasting-pills.png`, landed as `e24220f`). The pills already link to `/drops?family=`; reuse, do not restyle.
- [x] **Roaster lot table defaults to in-stock only.** One checkbox, checked by default, unchecking shows everything. Frontend-only default; no new query.

## Batch 2: profile and settings (backend first)

Current state: `/settings` is a redirect to `/settings/alerts` (`settings.index.tsx`); `/settings/account` already edits the handle and display name (`updateMe`, ADR-0011). The handle is globally unique app-wide with old-handle redirects, so "username" in the brief below likely means it; confirm before deciding whether this item is new work or a move and a rename of what `/settings/account` already does.

- [x] **Profile edit route.** Add a profile edit page under `/settings`, reworking the current settings route to `/settings/alerts`. The user edits display name and username (globally unique app-wide) and sets a default unit for weight (gram or oz). The weight unit needs a new field on `users` and a backend commit with tests before any UI mounts it.
- [x] **`/$user` small edits.** Against the current state (`work-plan-2-images/user-route-current.png`): the mute and unwatch buttons in the Watching section sit too close together; and the persistent "(1)" beside the user's display name goes (the page shows one user, the count reads as noise).

## Batch 3: OG image (shrunk, see Decisions)

- [x] **Landing page OG image.** Static `og:*` and `twitter:*` tags in `index.html` pointing at `/og.png`; the owner supplies the file.

Dropped 2026-09-21, kept for the record:

- ~~**`/$user/roaster/$roaster/$lot` route.**~~ A simple page for linking directly to a user's rating of a lot: the lot image on the left, the user's review in the middle, and a card to make your own review of the same lot on the right. The middle block shows the lot name in large text; both the image and the name are links to the lot page. Needs a backend query that resolves (user handle, roaster slug, lot handle) to one log, with tests, before the route. This is a new addressing dimension: the existing routes address lots, not a user's rating of a lot.
- ~~**Dynamic OG images for review links.**~~ Pair the shareable links with dynamically generated, Nouveau-branded OG images: the lot image, the name Nouveau, the reviewer's name, the rating, and the tasting notes. Open question for an ADR: where the images are generated (edge/HTML route on the static hosting, a Convex action, or pre-rendered at log time).

## Carry-over

- [x] **Performance and stability pass** (first round, see the log; re-open if the owner still sees stutter) from work-plan.md batch 8, still unticked. Owner reports random stuttering, reloads and waits. Work the TanStack Router docs (route preloading, `defaultPreload`, stale-time), the Convex query patterns, and the `convex-*` skills before changing anything; one fix per commit.

## Progress log

| Date | Batch | What landed |
| ---- | ----- | ----------- |
