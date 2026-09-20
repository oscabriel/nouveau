---
status: accepted
---

# The header carries three public links, the footer carries the plant

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Depends on ADR-0011 for the route names. Amends the Header, Footer and Hero plate entries in `DESIGN.md`.

## Context

The header today (`apps/web/src/components/header.tsx`) is a wordmark plus Roasters, Activity and (signed in) Feed on the left, and on the right either a Sign in button or a grey "Your account" group of Watches, Saved, the user's name and Sign out, then the light/dark toggle. Below `md` the account group mounts a second time as its own row. The footer (`site-footer.tsx`) is a 22vw NOUVEAU.COFFEE marquee scrolling for 60 seconds, then one row: Roasters, Activity, Feed on the left, Back to the top in the middle, Sign in or Watches plus GitHub on the right. `DESIGN.md` says every inner page ends in that footer; in the code only `/`, `/roasters` and `/roasters/$slug` do.

The hero is `apps/web/public/coffea-arabica.png`, the whole Thornton 1808 branch at 580 by 900, rendered 224 or 272 pixels tall, upright, signed-out landing only. `apps/web/public/coffea-arabica/` (untracked as of this record) holds the same plate cut apart: `01-branch.png` and a full-plate cutout at 4312 by 5769 (33.8 MB and 10.7 MB), and six numbered details at their source size: five stamens, the pistil, a berry, berry halves, a seed, and the seed in its aril cup. Nothing references them.

## Decision

**Header.** Left: NOUVEAU (home), ROASTERS (`/roasters`), DROPS (`/drops`). Right: two or three links at most. The theme toggle leaves the header (ADR-0013). Sign out leaves the header and lives in `/settings/account`. The owner left the exact right-hand set open; the proposal recorded here is:

| State | Right side |
|---|---|
| signed out | ACTIVITY, SIGN IN |
| signed in | ACTIVITY, the user's handle (`/$user`), SETTINGS |

The split is that the left names what the site is about (roasters, drops) and the right names the people (the community feed, you). Activity could equally sit on the left; that is the open question below. One nav, not two mounts: below `md` the right group wraps under the left instead of rendering twice.

**Footer.** Every route ends in the footer, including the signed-in and settings pages. Its link row mirrors the header on the left (NOUVEAU, ROASTERS, DROPS), keeps BACK TO THE TOP in the middle, and shows ABOUT and GITHUB on the right. No user links in the footer. `/about` is a new route.

**The plant replaces the marquee.** The scrolling wordmark goes. In its place the footer shows the plate's parts, each with a caption in a script face naming the part and linking to its Wikipedia article: the stamens, the pistil, the berry, the berry halves, the seed, and the seed in its aril. Under or beside them, a much larger rendering of the branch links to the Coffea arabica article. The captions are content, not decoration, so the images carry alt text and the block is not `aria-hidden`.

**Hero.** The branch turns on its side, about 80 degrees, so the leaves hang down almost flat, and renders somewhat larger than today's 224 and 272 pixels. It stays the signed-out and signed-in landing's opening image (ADR-0014).

## Considered alternatives

- **Keep the marquee and add the plate elsewhere.** The marquee is the loudest thing on every page and says the domain name, which the wordmark already does. The plate says what the product is about.
- **User links in the footer right (Watches, Saved).** Those surfaces move into `/$user` (ADR-0016), and a footer that changes with sign-in state doubles the states to design. Public links only.
- **A five-link header.** Roasters, Drops, Activity, Next bag, plus the user. The owner asked for two or three on the right; Find my next bag gets the landing's main button instead (ADR-0014), so it needs no nav slot.

## Consequences

- A script typeface enters the type scale. `DESIGN.md` has nine ramps, all grotesk and one serif lede; the caption face is new and needs choosing and loading.
- The plate assets must be exported at serving size before anything references them. A 33.8 MB PNG in `public/` ships verbatim through Vite. The details are small already (113 to 486 pixels on their long side) and may need a cleaner cutout; the branch needs a downscaled export for the footer and a rotated export for the hero.
- The hero's cream fringe (the "Not canonized" note in `DESIGN.md`) gets fixed in the same export, since the image is being re-cut anyway.
- `navLinkClass` in `header.tsx`, `footerLink` in `site-footer.tsx` and `capsLink` in `roasters.index.tsx` are the same string three times; the footer mirroring the header is the moment to keep one.
- `/about` needs copy. The hackathon log's "What it does" line and `PRODUCT.md`'s tone section are the sources.

## Open questions

- **Where Activity goes.** Right (with the people) as proposed, or left (as a third content link, making the right side just SIGN IN or handle plus SETTINGS). Either satisfies "two or three".
- **Whether SETTINGS is a header link or lives inside `/$user`'s own view.** Dropping it makes the signed-in right side ACTIVITY and the handle, which is the tightest set.
- **Which Wikipedia targets.** Stamen, Gynoecium (for the pistil), Coffee bean or Drupe for the berry, Seed, Aril; and whether to link a section anchor where the article's relevant paragraph is deep. Coffea arabica for the branch is settled.
- **Rotation direction and method.** A CSS transform keeps the unrotated layout box, so an 80 degree turn of a 580 by 900 image reserves the wrong space; a pre-rotated export is simpler and lets the fringe fix ride along. Which way the branch turns (leaves hanging left or right) is the owner's eye.
- **Script face.** No candidate named. It should read at caption size on both themes and be loaded from Google Fonts or self-hosted, per the design system's font rule.
