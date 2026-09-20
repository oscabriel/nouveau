---
status: accepted
---

# The theme follows the system or inverts it, from settings, not the header

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Amends the theme-switch line in `DESIGN.md` ("the caps word for the theme you would switch to, last on the right").

## Context

`ThemeProvider` in `routes/__root.tsx` is `next-themes` with `attribute="class"`, `defaultTheme="light"`, storage key `vite-ui-theme`. `ModeToggle` in the header flips between `light` and `dark` only; there is no system option even though the library supports one. So a visitor whose OS is dark gets a light page until they find the toggle, and their choice is stored per browser.

## Decision

The preference has two values, relative to the operating system: **system** (default) and **inverted**. There is no absolute light or dark choice. The control is a single switch that flips between the words LIGHT and DARK, and its default side is whatever the user's system theme is, so a dark-OS visitor lands on the DARK side of the switch showing the dark page. It lives on `/settings/appearance`, and the header's handle dropdown carries the same pair (ADR-0012): one state, two mounts. A signed-out visitor gets the system theme with no control, which is acceptable because the pages are designed for both themes and the OS setting is the visitor's own.

The stored value is the relation, not a colour. When the OS flips, an inverted user flips with it. The value stays in `localStorage` per browser, as today, because it describes this device's OS relative to this device's page.

## Considered alternatives

- **Three modes (light, dark, system).** More choice, more chrome. The owner wants the toggle gone from every page, and a three-way switch buried in settings is more than the choice deserves.
- **Store the preference on the user record.** Would follow the user across devices, but "inverted" only means something relative to the device the page is on, and a signed-out visitor would still need the local fallback.

## Consequences

- The default changes from light to system. Anyone with a dark OS sees the dark theme on first visit from now on. The design pass reviews both themes at every stage already, so no page is unprepared.
- `next-themes` handles `system` natively; "inverted" is computed from its `systemTheme` and needs a `matchMedia` listener so a live OS change re-inverts without a reload.
- The existing stored `light` and `dark` values are discarded on first load after the change; nobody has a preference worth migrating.
- `ModeToggle` and its `min-h-11 w-9` hydration spacer leave the standalone header row; the theme pair moves into the handle dropdown, which is new chrome. `DESIGN.md`'s header entry drops its last item and the title loses "not the header".

## Open questions

None. The switch copy (LIGHT / DARK, default following the system) and the signed-out behaviour are settled by the owner, 2026-09-20.
