---
status: accepted
---

# The header carries three public links, the footer carries the plant

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Depends on ADR-0011 for the route names. Amends the Header, Footer and Hero plate entries in `DESIGN.md`.

## Context

The header today (`apps/web/src/components/header.tsx`) is a wordmark plus Roasters, Activity and (signed in) Feed on the left, and on the right either a Sign in button or a grey "Your account" group of Watches, Saved, the user's name and Sign out, then the light/dark toggle. Below `md` the account group mounts a second time as its own row. The footer (`site-footer.tsx`) is a 22vw NOUVEAU.COFFEE marquee scrolling for 60 seconds, then one row: Roasters, Activity, Feed on the left, Back to the top in the middle, Sign in or Watches plus GitHub on the right. `DESIGN.md` says every inner page ends in that footer; in the code only `/`, `/roasters` and `/roasters/$slug` do.

The hero is `apps/web/public/coffea-arabica.png`, the whole Thornton 1808 branch at 580 by 900, rendered 224 or 272 pixels tall, upright, signed-out landing only. `apps/web/public/coffea-arabica/` (untracked as of this record) holds the same plate cut apart: `01-branch.png` and a full-plate cutout at 4312 by 5769 (33.8 MB and 10.7 MB), and six numbered details at their source size: five stamens, the pistil, a berry, berry halves, a seed, and the seed in its aril cup. Nothing references them.

## Decision

**Header.** Left: NOUVEAU (home), ROASTERS (`/roasters`), DROPS (`/drops`). Right: two or three links at most. The theme toggle leaves the header (ADR-0013). Sign out leaves the header and lives in `/settings/account`. The owner settled the right-hand set:

| State      | Right side                             |
| ---------- | -------------------------------------- |
| signed out | ACTIVITY, LOGIN                        |
| signed in  | ACTIVITY, the user's handle (`/$user`) |

The split is that the left names what the site is about (roasters, drops) and the right names the people (the community feed, you). Signed out, the second link reads LOGIN; signed in, it becomes the user's handle. The handle carries a dropdown holding SETTINGS and the theme pair (LIGHT / DARK, ADR-0013), so sign-out, settings and theme are all one click deep without spending header links. One nav, not two mounts: below `md` the right group wraps under the left instead of rendering twice.

**Footer.** Every route ends in the footer, including the signed-in and settings pages. Its link row mirrors the header on the left (NOUVEAU, ROASTERS, DROPS), keeps BACK TO THE TOP in the middle, and shows ABOUT and GITHUB on the right. No user links in the footer. `/about` is a new route.

**The plant replaces the marquee.** The scrolling wordmark goes. In its place the footer shows the plate's parts, each with a caption in a script face naming the part and linking to its Wikipedia article: Stamen (the stamens), Gynoecium (the pistil), Drupe (the berry and the berry halves), Seed, and Aril (the seed in its aril cup), no section anchors. Under or beside them, a much larger rendering of the branch links to the Coffea arabica article. The captions are content, not decoration, so the images carry alt text and the block is not `aria-hidden`.

**The caption face is Caveat, self-hosted**, per the design system's font rule. It reads at caption size on both themes; Pinyon Script is the fallback if Caveat reads too casual next to the plate.

**Hero.** The branch turns on its side, about 80 degrees, leaves hanging left, as a pre-rotated export rather than a CSS transform, so the layout box is right and the cream-fringe fix rides along in the same cut. It renders somewhat larger than today's 224 and 272 pixels. It stays the signed-out and signed-in landing's opening image (ADR-0014). The owner will supply a fresh export in `apps/web/public/`.

## Amendment

**2026-09-20 (owner feedback after the live signed-in check). The header label is the first name, not the handle; sign out joins the dropdown.** The signed-in header showed the raw users-document id when the row predates handles ("looks crazy"). The label becomes the user's first name, the first word of the Google account name, falling back to the handle when no name exists; the id never renders. The label still links to `/$user`, addressed by handle-or-id path (ADR-0011), so the display change needs no routing. Sign out, which the header item originally moved to `/settings/account`, also mounts as the dropdown's last item; `/settings/account` keeps its own sign out. The handle remains the stored identity and the profile's address; the label is display only. Rows created before ADR-0011 landed never run the sign-in derivation again (it fires for new sign-ins only), so the backfill rides the app shell: on first load after sign-in the header calls a lazy mutation that claims the row's handle with the same derivation and suffix rules.

**2026-09-21 (owner's batch 8 brief). The footer keeps one flower and gains the domain.** Five of the six details and their Caveat captions leave the footer; the five-stamen flower stays, above BACK TO THE TOP, which moves out of the link row so the row is the three left links and ABOUT, GITHUB right. Beside the flower, NOUVEAU.COFFEE set huge in the Garamond italic the landing wordmark uses since 2026-09-21. With no captions left, Caveat leaves the app (`@fontsource-variable/caveat` uninstalled, the `--font-caveat` token gone); the type scale is back to two families. The flower keeps its alt text and its Coffea arabica link.

**2026-09-21 (owner's post-batch-8 list). The flower is the last thing on the page.** The lower block stacks at every width: NOUVEAU.COFFEE first, then the five-stamen flower under it, bottom-most. The same day's earlier arrangement (flower and wordmark side by side on one baseline) goes. The flower keeps the wordmark's font-size from `md`, its alt text and its Coffea arabica link.

**2026-09-21 (owner's work-plan-2 brief). The flower returns to the wordmark's left from `md`; the nav stacks in two columns below it.** The stacked arrangement of the same day stays only below `md`. From `md` the flower sits at the page's left edge and NOUVEAU.COFFEE at the right, bottoms flush on one line. Header and footer below `md` are two columns, left links stacked at the left edge and right links stacked at the right edge, in place of the wrapped rows of `f1fd30e`; the footer hides BACK TO THE TOP below `md`. In the header's right column the person's name leads on mobile.

## Considered alternatives

- **Keep the marquee and add the plate elsewhere.** The marquee is the loudest thing on every page and says the domain name, which the wordmark already does. The plate says what the product is about.
- **User links in the footer right (Watches, Saved).** Those surfaces move into `/$user` (ADR-0016), and a footer that changes with sign-in state doubles the states to design. Public links only.
- **A five-link header.** Roasters, Drops, Activity, Next bag, plus the user. The owner asked for two or three on the right; Find my next bag gets the landing's main button instead (ADR-0014), so it needs no nav slot.

## Consequences

- A script typeface enters the type scale. `DESIGN.md` has nine ramps, all grotesk and one serif lede; Caveat is the first entry in the new slot and must be self-hosted.
- The plate assets must be exported at serving size before anything references them. A 33.8 MB PNG in `public/` ships verbatim through Vite. The details are small already (113 to 486 pixels on their long side) and may need a cleaner cutout; the branch needs a downscaled export for the footer and a rotated export for the hero. The owner is re-exporting the hero asset themselves.
- The hero's cream fringe (the "Not canonized" note in `DESIGN.md`) gets fixed in the same export, since the image is being re-cut anyway.
- Implementation note (2026-09-20): the serving-size exports live at `apps/web/src/assets/coffea-arabica/*.webp` (seven files, imported by `site-footer.tsx` so Vite hashes them), not in `public/`. The hero stays at `apps/web/public/coffea-arabica.png`.
- `navLinkClass` in `header.tsx`, `footerLink` in `site-footer.tsx` and `capsLink` in `roasters.index.tsx` are the same string three times; the footer mirroring the header is the moment to keep one.
- `/about` needs copy. The hackathon log's "What it does" line and `PRODUCT.md`'s tone section are the sources.

**2026-09-20 (owner feedback, second live check). The header label opens the menu; the profile is the menu's first item.** The label was the `/$user` link and the dropdown trigger at once, so one click navigated to the profile and the menu's theme pair and sign out could not be used in place. The label is now a button that only opens the menu, underlined while on the user's own profile, and PROFILE leads the menu above the theme pair, SETTINGS and SIGN OUT. The profile stays one click deep, through the menu.

**2026-09-21 (owner, same-day correction to the batch 8 brief). BACK TO THE TOP returns to the link row, and the flower matches the wordmark.** Under the flower the owner asked to restore the original row: NOUVEAU, ROASTERS, DROPS left, BACK TO THE TOP centered, ABOUT and GITHUB right, the row it had before the brief moved it under the flower. The flower and NOUVEAU.COFFEE stay. The webp is a square whose visible drawing is 448x361 of the 540x540 canvas with symmetric margins, so the element rides at the wordmark's own font-size from `md`; the drawing then sits at the caps' height with both bottoms flush, no per-breakpoint height to maintain.
