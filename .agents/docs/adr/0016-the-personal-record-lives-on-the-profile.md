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

**The vocabulary of the record, as the owner listed it:** watch a roaster; save a lot to the try list; log a lot you have tried; rate it; write notes on it. "Try list" is the name for the set of saved lots. The lot page is where a lot is saved, logged and rated (ADR-0015 removes the inline form from the catalog), so the record's actions all start from the object.

**Personal tasting notes are the user's own descriptors, distinct from the roaster's.** The owner wants a taster to record what they tasted, which may disagree with the roaster's notes. The glossary's "Notes" (prose) already exists; this adds a structured descriptor list on the log, shown beside the roaster's on the lot page and on the profile. The shape is open below.

## Considered alternatives

- **A My coffee page apart from the profile.** The design handoff planned it on the home page. A second private page duplicates the profile's log list and gives the record no public address. Owning the profile URL is what Letterboxd does and what the owner asked for.
- **Keep `/watches` and `/saved` as routes.** They are lists the profile now holds; two more nav slots for the same rows.
- **Merge the activity feed into the home page.** Rejected by the owner: activity stays at `/activity` and on profiles.

## Consequences

- `logs.profile` grows: for the owner it also returns watches (with health) and the try list, or the page calls the three queries it already uses on the retired routes. The public branch must never include the private two, enforced in the query, not the component.
- The personalized drop feed (`feed.personalizedFeed`) and its delivery lines lose their only mount when the signed-in home goes. Where they go is open below.
- The alert email's mute link points at `/settings/alerts`, which is unchanged.
- The log form gains the descriptor field once its shape is decided; that is a schema commit with tests.
- `CONTEXT.md` gains "Try list" and "Handle", and "Profile" and "Lot page" take their new addresses.

## Open questions

- **"Review" versus "notes".** The owner's message says "ratings and reviews". ADR-0002 chose "log" with "notes" and the glossary avoids "review". Recommendation: keep "notes" in the UI and the glossary; "review" invites essays, and a log is a diary entry.
- **The shape of personal tasting notes.** A free list of short descriptors on the log (like `roasterNotes[]`), or a set of caps toggles drawn from the roaster's notes plus free additions. Recommendation: a free list, entered as comma-separated text, stored as an array, with the roaster's notes shown as reference and never prefilled (the log form already does this for prose).
- **One log per lot or many.** Today many. A profile that manages "ratings" reads better with one rating per lot; a diary reads better with many logs. Letterboxd keeps one rating and many diary entries. Recommendation: many logs, and the lot's tile and profile rows show the latest rating.
- **Logging a saved lot.** Whether a log removes the lot from the try list. Recommendation: yes, with a toast that says so and an undo, because "want to try" is over once it is tried.
- **The personalized drop feed.** A "Your roasters" tab on `/drops` (signed-in only) is the natural home; the delivery lines (pending, sent, delivered) could then sit under those rows as the design handoff planned. Or drop the delivery lines and let `/settings/alerts` show delivery. Recommendation: the tab.
- **Watched roasters on the public profile.** The design handoff listed them; issue #20 says no. This record says no. Reopen only with a privacy toggle.
