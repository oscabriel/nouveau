---
status: accepted
---

# The personal record lives on the profile; settings hold the account

Decided 2026-09-20 (owner), recorded before any code. Implementation is a later session. Extends ADR-0002 (logs, ratings, notes, profile, activity feed) and ADR-0004 (Save shipped alone). Depends on ADR-0011 for `/$user` and `/settings`. Issue #20 (coffee watches, dated and private logs, the audience rule) stays deferred and is not reopened here.

## Context

The personal record has four relations today. A **watch** is per roaster (`watches`: user, roaster, muted). A **save** is a private bookmark of a lot the user wants to try (`savedCoffees`, with an optional `fromRunId` citing the Find my next bag run). A **log** is the public record of trying a lot (`logs`: lot, optional rating in half steps, optional notes up to 1000 characters, `loggedAt`); a user can hold several logs for one lot, and can edit or delete their own. **Roaster notes** are the roaster's descriptors on the lot. There is no "tried" state apart from the log, and no privacy field on logs.

These live on five pages: the signed-in home (Want to try, the personalized drop feed with delivery lines, the unhealthy-watch banner), `/watches` (mute, unwatch, health), `/saved` (unsave, stock at last check), `/profile/$userId` (logs, the same page for self and others with only the copy changing), and `/activity` (everyone's recent logs). `/settings/alerts` lists watches again with their mute toggles. Save buttons appear on lot pages, on recommendation results, and on other people's logs, which is how a lot gets onto Want to try.

The owner's framing: Letterboxd puts other people's activity on the signed-in front page; Nouveau keeps it on `/activity` and `/$user`, and the home page stays public (ADR-0014).

## Decision

**`/$user` is the profile, public and owned.** For any viewer it shows the user's logs: lot, rating, notes, when. For the user themself the same URL is the management view: their logs with edit and delete, their watched roasters with health, mute and unwatch, their try list with unsave and stock at last check, and the Find my next bag button. Watches and the try list are private and never render for another viewer, which matches the save toast ("Only you can see it") and issue #20's rule that a public profile exposes no watches or saved coffees. `/watches` and `/saved` retire into this page. The unhealthy-watch banner becomes one grey sentence at the top of the watches section.

**`/settings` is the account.** `/settings/alerts` stays as built (the alert inbox and per-watch mute). `/settings/appearance` holds the theme switch (ADR-0013). `/settings/account` holds the handle, the name, and sign out.

**`/activity` stays the community feed** and is the only place other people's logs appear together. The home page carries none of it.

**The vocabulary of the record, as the owner listed it:** watch a roaster; save a lot to the try list; log a lot you have tried; rate it; review it. "Try list" is the name for the set of saved lots. The lot page is where a lot is saved, logged and rated (ADR-0015 removes the inline form from the catalog), so the record's actions all start from the object.

**Many logs per lot, the latest rating wins the display.** A user can hold several logs for one lot, as today; the profile rows and the landing tiles show the latest rating. Logging a saved lot removes it from the try list, with a toast that says so and an undo, because "want to try" is over once it is tried.

**Personal tasting notes are structured; the freeform text is the review.** A log carries two things the prose field alone cannot hold. First, a bounded set of tasting descriptors: up to four picked from the standard roaster-notes vocabulary, stored as an array on the log, shown beside the roaster's own descriptors on the lot page and on the profile. The picker is a fixed list, not free text, and is never prefilled from the roaster's notes for that lot. Second, the freeform text field, labelled REVIEW, takes anything else the taster wants to say; the old "notes" prose becomes the review. ADR-0002's "log" stays the name of the record; "review" is the name of the text on it.

## Considered alternatives

- **A My coffee page apart from the profile.** The design handoff planned it on the home page. A second private page duplicates the profile's log list and gives the record no public address. Owning the profile URL is what Letterboxd does and what the owner asked for.
- **Keep `/watches` and `/saved` as routes.** They are lists the profile now holds; two more nav slots for the same rows.
- **Merge the activity feed into the home page.** Rejected by the owner: activity stays at `/activity` and on profiles.

## Consequences

- `logs.profile` grows: for the owner it also returns watches (with health) and the try list, or the page calls the three queries it already uses on the retired routes. The public branch must never include the private two, enforced in the query, not the component.
- The personalized drop feed (`feed.personalizedFeed`) and its delivery lines lose their only mount when the signed-in home goes. Where they go is open below.
- The alert email's mute link points at `/settings/alerts`, which is unchanged.
- The log form gains the descriptor picker and its field is relabelled; that is a schema commit with tests. The try-list removal on log is a backend commit with tests, since a save can outlive the unsave via undo.
- `CONTEXT.md` gains "Try list" and "Handle", and "Profile" and "Lot page" take their new addresses. "Notes" changes meaning: the structured descriptors are personal tasting notes, the prose is the review.

## Open questions

- **The standard tasting-note list.** Settled by the owner, 2026-09-20: the vocabulary is a published industry-standard wheel (the SCA Coffee Taster's Flavor Wheel), held as a TypeScript enum type end to end so a descriptor is type-safe from the picker through the schema to the query results. Remaining shape question: the full wheel runs about a hundred leaf attributes across nested levels; the picker needs a cut of it (top-level categories only, or top two levels), and the enum needs one home both apps import. Settled in implementation, 2026-09-20: the cut is the **top two levels** — nine categories and their twenty-eight second-level terms; two of those terms ("floral", "green/vegetative") repeat their category name as the published wheel does, so thirty-five distinct pickable values. Level one alone is too coarse ("fruity" says little a tile can use), and the ~100 level-three leaves cannot fit a picker that asks for four picks. The vocabulary lives in one module both apps import (`packages/backend/convex/tasting.ts`, which the web app already reaches through `@nouveau/backend`), held as a literal-union type with a Convex validator built from the same array — the type-safe intent the "enum" phrasing asked for, without the `enum` keyword's runtime baggage.
- **The personalized drop feed.** Settled by the owner, 2026-09-20: a "Your roasters" tab on `/drops` (signed-in only), with the delivery lines (pending, sent, delivered) under those rows.
- **Watched roasters on the public profile.** The design handoff listed them; issue #20 says no. This record says no. Reopen only with a privacy toggle.

## Amendments

**2026-09-20 (design-pass review part 2, 2.2). "The latest rating" is per log, not per lot.** The decision above reads as one profile row per lot carrying the lot's latest rating. That is not what shipped: `$user.tsx` renders every log as its own `LogCard`, newest first, and each row shows the rating that log carries. Two logs for one lot are two rows with two ratings. The landing tiles work the same way, since each tile is one log. The sentence therefore means "each row shows its own rating, and the newest log sits on top"; grouping by lot is not planned. The owner had not chosen between the two readings when this was written; this line records the default the implementation took and stands until the owner asks for grouping.

**2026-09-21 (owner's batch 8 brief). Tasting notes are the taster's words; the wheel classifies them.** The picker is retired. The log form's tasting-notes field is free text: a word or two, Enter or a comma, and it becomes a removable pill. The stored list is still an array of strings on the log, now any word, trimmed and lowercased, deduplicated, up to eight (was four with the picker; a typed word costs nothing, so the cap is only a storage bound) and thirty-two characters each. The SCA wheel stays as the classifier: `tasting.ts` holds every wheel term at all three levels plus the everyday spellings tasters type (chocolatey, caramel, stone fruit), each under one of the nine top-level families, and `familyOf()` resolves a word to its family or null. The family is derived on read, never stored, so a vocabulary fix reaches old logs. No model does the assignment: the wheel's own structure gives it for free, and Jev would add a call and a cost for the words the wheel already knows. A word the wheel does not know keeps its pill, uncolored, and never links. Each family has a soft ground and border color (DESIGN.md), the first hue in UI chrome; the owner asked for it, and the pill links to `/drops?family=` so one word on a log leads to every recent lot in its family. Roaster notes stay plain text: they are the roaster's words, not the taster's. Drop cards carry the families their lot's roaster notes resolve to, for the filter and the links.

**2026-09-21 (owner's batch 8 brief). The log form is a pane.** Logging and editing happen in the same right-edge sheet Find my next bag uses, opened from LOG THIS LOT on the lot page and EDIT on the viewer's own rows, instead of an inline form under the logs heading. The rating is five stars taken by click or drag in half steps, unrated until touched; the RATE IT toggle and the range slider are gone. ADR-0015's "the lot page is where a lot is logged" still holds: the pane opens from the lot page and names the lot.
