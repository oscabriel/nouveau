# Nouveau, a hackathon-first product spec

Status: revised proposal. This replaces the earlier unconstrained reimagining, not the current implementation or the historical decisions in `docs/build-spec.md` and `docs/adr/`.

Source baseline: `3d50c8d`. Build forward from current main. Keep the TypeScript monorepo, Convex backend, TanStack Router frontend, and Convex static hosting. No application changes or deployment are authorized by this document.

This revision follows the [All Gas assessment](nouveau-hackathon-fit.md) and the [official hackathon criteria](https://www.convex.dev/hackathons/all-gas). The assessment grades the earlier draft; this document incorporates its findings.

## 1. Product and deadline

> Nouveau remembers the coffees you like, helps you choose your next bag, and watches for the releases you care about.

The audience is home brewers who buy from several specialty roasters. They want to remember what they tried, find another coffee they might like, and know when something they want becomes available. The first monitored catalog remains US specialty roasters.

Personal history is the long-term reason to keep the app. For the hackathon, connect that history to the implemented discovery and alert system instead of rebuilding a complete social journal first.

The submission deadline is September 22, 2026, at 12:00 PM PT, as recorded in the project build spec. The official page requires a public app, public repository, and a video under three minutes. It scores useful everyday behavior, Convex depth, real sponsor participation, and external social proof. It publishes no numerical weights.

The product must demonstrate one connected task before adding more destinations or data models.

## 2. Decisions changed by the hackathon review

| Earlier proposal | Revised decision |
| --- | --- |
| Restart from `a37561b` and port selected product work | Build on current main. Earlier commits remain references, not a reset target. |
| Ship a full journal and social graph before reconnecting alerts | Preserve the working monitoring and alerts; connect them to personal history and saving. |
| Defer every runtime OpenAI feature | Ship one grounded OpenAI feature, Find my next bag. |
| Replace per-user AgentMail inboxes with a service sender | Keep the existing inbox provisioning, package patch, and delivery path unless a demonstrated defect requires a change. |
| Introduce lot revisions, separate listings, and a broad identity migration | Preserve current lot IDs and URLs. Apply narrow history safeguards where needed; defer the migration. |
| Require bags, person follows, comments, and moderation in the first public release | Defer bags and comments. Make person follows conditional on completing the core flow and submission artifacts. |
| Treat demo and distribution as later work | Plan the demo sequence and recruit real testers during the build. Record only working behavior. |

The framework and hosting choices stay unchanged. The change is scope and execution order.

## 3. The core experience

An illustrative journey:

1. A user records a coffee they tried, with an optional rating and note.
2. They open Find my next bag and choose a few coffees they liked. A new user can instead state preferences without inventing a history.
3. Nouveau returns a short list of actual available coffees, with explanations and source links.
4. The user saves one to Want to try. Saving a coffee does not subscribe them to email.
5. They can separately watch that coffee or its roaster for updates. Coffee-specific restock alerts also work for unavailable coffees found elsewhere in the catalog.
6. AgentMail delivers an opted-in alert about a confirmed event. The app shows the same event and its current delivery state.
7. The user later logs the coffee and can share their public log or profile. Another person can save the coffee from that log.

Purchases happen at the roaster. A shop-link click is not proof of purchase. Logging never requires a purchase record, bag inventory, social connection, or successful email delivery.

## 4. Launch scope

### Preserve and verify

The source and build log already describe these behaviors. Recheck the user flows before treating them as submission-ready:

- Google sign-in, Convex hosting, and public browsing.
- Roaster catalog, coffee pages, and archive access.
- Logs, half-step ratings, public profiles, and public activity.
- Structured Shopify extraction, Firecrawl fallback and HTML extraction.
- Crawl scheduling, source health, baseline behavior, and archive rules.
- Classification, US-market pinning, pagination, and batch-processing fixes.
- Roaster watches, mute, AgentMail inboxes, and the email deduplication ledger.

An existing dependency or historical deployment note is not a substitute for a current end-to-end check.

### Required additions

- Find my next bag, with a real OpenAI call over bounded, source-backed candidates.
- A demonstrated Firecrawl contribution that adds useful source information.
- Want to try, with saving from coffee pages and public logs.
- Coffee-specific restock watches, deduplicated with matching roaster watches.
- A My coffee view with saved coffees and dated personal history.
- Faster mobile logging and an explicit private/public audience for new logs.
- In-app updates independent of whether email succeeds, with explicit email consent for new watches.
- Submission evidence, an under-three-minute video, and a real external sharing effort.

The acceptance test is a user who can record a coffee, use it to choose another, save or watch that coffee, receive a genuine update, and share a log. Each step must work without a developer repairing data behind the screen.

### Conditional additions

Person follows and a chronological Following view can ship only after the required flow, privacy tests, and submission artifacts are complete. If follows do not ship, retain the clearly labeled public Activity feed. Do not call it personalized.

A narrow roaster-submission flow or social-preview improvements can follow under the same condition. Neither should delay the main task.

## 5. Find my next bag

This is a bounded recommendation task, not a chat product.

### Inputs

The user can select up to five coffees from their own history and enter a short preference request. Budget and bag-size constraints are explicit form fields so the backend can apply them without relying on model interpretation. Preferences can ask for something similar or different, with broad choices such as process or decaf where metadata supports them.

Explain which selected history will go to OpenAI before the user starts. Include personal notes only by explicit choice. A request uses the user's selected information, not an undisclosed scan of all private logs.

Users with no history can enter preferences and get a result labeled as based on those preferences. It must not imply that Nouveau already knows their taste.

### Candidate selection and source evidence

Convex filters a bounded pool of at most 20 candidate coffees using the current catalog. Price constraints apply to a specific available variant in a confirmed currency and market. Show that size with its price. Shipping and tax are outside the budget calculation and must be labeled as excluded.

Missing price, size, or stock information cannot silently satisfy a constraint. An unavailable or stale source is not proof that a coffee can be bought now. If too few candidates qualify, return fewer results and explain the limitation.

Keep structured Shopify data for price and stock. Firecrawl enriches supported product pages when their prose contains useful information missing from the feed. Reuse timestamped public evidence across users and cap enrichment work per request. Keep user history out of that shared cache.

Store enough provenance to connect a result to its coffee, source URL, observation time, and supporting passage. A scrape must affect the displayed information or recommendation, not run solely to create a sponsor trace.

### Model output

OpenAI compares the supplied candidates and returns up to three existing coffee IDs with short explanations. Explanations distinguish the user's preferences from the roaster's published descriptors. They may describe why a coffee appears relevant, but cannot assert that the user will like it.

The model does not write catalog facts or personal logs. It cannot create a coffee, price, stock claim, or tasting descriptor. Treat fetched page text as untrusted source content, not instructions. Give the model no purchasing or arbitrary browsing tools.

Validate the output against the candidate IDs and supplied evidence, then recheck availability before rendering a buying action. Prices and stock labels come from the database, not generated prose. Unsupported explanations are rejected or removed rather than shown as facts.

### User-visible states

Requests have queued, running, ready, or failed states. A ready request can contain zero eligible results with a reason. Loading copy says what is happening without implying a result exists.

An OpenAI or Firecrawl failure leaves browsing, saving, and logging available. A filtered catalog can appear as a clearly labeled non-AI fallback, not as a successful personalized recommendation. Retries must be bounded and must not create uncontrolled model or crawl spending.

Recommendation results are private to the requesting user. The submission evidence records the actual model used and a genuine generated result. Optional schema fields, a configured key, or coding-agent usage are not runtime integration evidence.

### Scope fallback

If the shortlist cannot meet correctness and cost gates before submission, explicitly revise the release scope to a faithful OpenAI-generated summary of a real release. This is a smaller product, not an equivalent implementation of Find my next bag. Update the UI, demo, and build log to match; do not quietly replace personalized recommendations with generic copy.

## 6. Personal tracking and sharing

### My coffee

The signed-in starting page emphasizes Want to try and History, with a Log action and access to Find my next bag. There is no Brewing tab until bag tracking exists.

A saved coffee is a private intention. Saving, removing a save, and watching are separate actions. Removing a coffee from Want to try does not silently remove an alert subscription.

History supports search, archive access, and pagination. A coffee can be both saved and previously tried. Repeated logs are valid because a user may revisit a coffee or brew it differently.

### Logging and privacy

New logs require a coffee and date tried, defaulting to today. Keep optional 1 to 5 ratings in half steps, notes, and a broad brew method. The known-coffee logging flow should take under 20 seconds in observed usability checks.

Store the date tried separately from creation time. Existing logs only prove when the user recorded them; do not invent a historical tasting date. Editing a note does not announce it as a new tasting.

New logs default to private, with the audience visible before saving. Existing public logs keep their existing visibility unless their authors change it. Implement the audience rule across every public query, lot page, profile, activity result, and aggregate in the same increment. Privacy is not complete if only the form or profile respects it.

Users can edit and delete their own logs. Changing a log to private removes it from public reads immediately, without depending on a later cleanup job. New public identities use a chosen display name; email and authentication identifiers remain private. Preserve existing profile addresses.

The first release searches the existing coffee catalog, including archives. A failed search offers clear feedback rather than creating a public catalog record through an unreviewed free-text path. Member-added coffees remain a later coverage improvement.

### Small social scope

Keep public coffee pages, public logs, profiles, and the global Activity feed. Add Save coffee wherever somebody else's log names a coffee. Profile links and coffee links work without signing in; writing requires normal self-service sign-in, not an invitation.

Person follows are conditional. Comments, DMs, follower leaderboards, and new discussion systems are outside this release. Preserve authorship controls and a way to report abusive public content; a deferred comment system is not a reason to ignore abuse in existing public notes.

Public profiles do not expose saved coffees, private logs, alert preferences, or watched roasters by default. Publishing a log does not publish the rest of the user's coffee activity.

## 7. Discovery and alerts

Discover presents coffee first, with roasters as a tab or filter. Distinguish a confirmed release from an older coffee newly added to Nouveau. Keep archived coffees accessible for logging without treating them as currently available stock.

A coffee page shows the roaster's facts, current known availability, the viewer's saved/logged state, and public logs. Main actions are Save, Log, and Watch. Checkout remains external. Roaster descriptors stay separate from the user's notes and generated recommendation explanations.

### Watch behavior

Preserve existing roaster watches and mute semantics. Add a separate coffee-watch relationship rather than forcing a broad migration of all watches. Coffee-specific restock alerts are required; size-specific controls and new price-alert settings can wait unless they are already correct and easy to expose.

New watches default to in-app updates. Email is explicit opt-in. Existing email choices remain intact. A muted relationship produces no update by itself, but another active matching watch may still qualify; show the matching reasons in update detail.

A user with both a roaster watch and a coffee watch gets one in-app update and at most one queued email per event. Notifications match confirmed events, not page changes or model conclusions. Keep the one-new-event-per-lot behavior. Adding a size to an existing coffee must not be described as a new coffee release.

Keep the existing AgentMail per-user inbox model and package patch. Failed provisioning or delivery must be visible in settings or update detail, and must not block personal tracking. Preserve the provider outbound reference and reconcile uncertain outcomes before retrying. A database deduplication key alone does not prove exactly-once delivery across the provider boundary.

### Reliability rules

- Baseline crawls populate the catalog without release alerts.
- Failed or incomplete crawls do not justify absence or stock claims.
- Classification corrections and expanded extraction coverage are catalog maintenance, not drops.
- Price comparisons use the same variant, currency, and market.
- Source health and last-confirmed timestamps remain visible near availability and watch controls.
- Extraction failure displays an inability to confirm availability. Raw page changes do not trigger speculative release alerts.

Detection within about 15 minutes remains an internal target for supported healthy sources, not a measured claim about every release. Keep the existing tested extraction paths. Fix concrete correctness defects as necessary, but defer a general pipeline rewrite.

## 8. Frontend and API architecture

### Stack and package layout

Keep Bun workspaces, Turborepo, TypeScript, React, Vite, TanStack Router, Tailwind, Convex, Convex Auth with Google, Firecrawl, AgentMail, and the shared UI/env/config packages. Add the bounded OpenAI call within the existing backend. No extra database, queue service, frontend framework, or hosting provider is needed.

Use current dependency pins and auth wiring as the implementation reference. The older locked spec's auth version is stale. Do not resurrect it during this work.

Existing Convex modules remain in place. Add focused modules for recommendations, saved coffees, and coffee watches. Refactor a module only when a feature or demonstrated defect requires it; reorganizing all backend files is not a release task.

### Public interface

Keep generated Convex function references as the client interface. Query results are bounded, validated views rather than entire tables for the browser to join.

| Area | Interface intent |
| --- | --- |
| Recommendations | Request a private run, subscribe to its state/result, and retry within a bounded policy |
| Saved coffees | Save or remove one coffee and paginate the caller's saved list |
| Logs | Extend existing create/edit/read functions with dates and audience checks |
| Coffee watches | Set or remove the caller's lot watch and delivery preference |
| Updates | Read recipient-scoped events separately from email delivery details |

A recommendation-request mutation resolves the caller, validates ownership of selected logs, records explicit inputs, enforces quotas, and schedules an internal action. That action performs external work and commits through internal mutations. The client subscribes to the owned result. A submitted user ID never establishes authorization.

Reuse the rate-limiter component for model requests and external fetch quotas. Limit concurrent work and retries. Model failure cannot roll back an unrelated log or save. Keep provider credentials on the backend and leave prompts, personal notes, and email addresses out of operational logs.

Preserve the current email ledger. In-app updates need their own recipient record or equivalent explicit separation so a failed or disabled email does not erase the user's update. Deduplicate matching watch reasons transactionally and process large fanout in bounded batches.

### Minimum data changes

Keep the current `products` table as the lot record for this release, with its existing IDs and URLs. Extend the model only for saved coffees, coffee watches, private recommendation runs, dates/audience, and independent in-app updates.

Protect historical logs from destructive catalog cleanup. If a stored snapshot of identifying copy is needed for new logs, add that narrowly. Existing records cannot recover historical facts that were never captured. The full separation of durable lots, listings, and revisions remains a later migration with a rehearsal and redirect plan.

### Pages and interaction

Use My coffee, Discover, and Activity as the initial main destinations. If person follows ship, add a genuinely personalized Following view with Activity still labeled as public. Keep inbox/watch management and profile settings as utilities. Preserve existing coffee, roaster, and profile routes; add redirects if navigation changes an address.

TanStack Router owns routes, validated filters, and scroll restoration. Convex owns server state. Local React state holds drafts and interaction state. Failed saves retain the draft; a request key prevents retrying the same log submission from creating duplicates.

Use compact lists, readable coffee names, real roaster imagery, a light neutral background, graphite text, and a deep blue action color. Dark mode preserves hierarchy. Mobile gets reachable Log and Save controls; desktop gets a compact navigation column. Avoid decorative dashboards and unnecessary card containers.

Ratings have keyboard and screen-reader labels, including an unrated choice. Target 44-pixel touch controls. Respect reduced motion and enlarged text. New feed items wait behind an update control rather than moving the item being read.

### Hosting

Keep the client-rendered Vite app on `@convex-dev/static-hosting` at the deployment's `convex.site` origin. Preserve the current `/api`, auth, OAuth, and Firecrawl route allocations. OpenAI work belongs in backend actions, not a new web server.

Direct links must resolve. Route-specific social previews are optional; client-side metadata alone does not prove they work for crawlers. Keep a truthful generic preview until a tested same-stack solution exists.

## 9. Build order and completion gates

### Gate 1: preserve the submission base

Verify sign-in, a real coffee page, logging, monitored source health, and actual email delivery. Preserve the extraction regression suite and documented fixes. Resolve demonstrated failures before adding new workflows.

Done means the existing app's core paths work on the intended deployment, with evidence of what was checked. An HTTP 200 alone does not satisfy this gate.

### Gate 2: complete the sponsor-backed selection task

Build Find my next bag with bounded candidate selection, source evidence, a real OpenAI call, output validation, and private result access. Demonstrate Firecrawl adding information that the product uses.

Done means a person can request and inspect a useful result, an invalid model result cannot create invented facts, and failure/cost limits work. Record the actual runtime model and integration behavior in the build log after verification.

### Gate 3: connect selection to tracking and alerts

Add saved coffees, coffee-specific watches, dated logs, audience rules, and independent in-app updates. Apply the My coffee navigation and fast mobile log flow. Preserve existing public links and email choices.

Done means a user can save a recommended coffee, watch it, see one update for overlapping watches, log it, and deliberately share it. Another user can save the coffee from the public log without seeing private data.

### Gate 4: finish the submission

Run the verification matrix below, obtain real user feedback, record the video, and complete the evidence checklist. Only then consider person follows or another conditional feature.

A new feature is not a substitute for a missing demo, unusable sign-in, unverified email delivery, or absent external sharing.

## 10. Verification

Use the existing Convex test setup and extraction fixtures. Keep local quality gates from the repo scripts: `bun run check`, `bun run test`, and `bun run check-types`. At the source baseline, the backend has no `check-types` script, so also run `bun x tsc --noEmit -p packages/backend/convex/tsconfig.json` for an implementation.

Required cases:

- Two users cannot read or mutate each other's saves, private logs, watches, or recommendation runs.
- Selected log IDs belong to the caller; unchecked IDs cannot feed private notes into a model request.
- Public-to-private changes hide a log from every public read and aggregate immediately.
- Legacy public logs preserve visibility, while new logs default to private.
- Repeated submission keys create one log; a deliberate repeat tasting creates another.
- Empty candidates, unknown price/currency/size, stale availability, invalid model IDs, unsupported claims, and provider failures produce honest states.
- Recommendation retries and page enrichment stay within configured quotas.
- Saving does not publish or enable email. Removing a save does not remove a watch.
- Overlapping roaster and coffee watches create one update and one email attempt per event; consent and mute changes apply before delivery.
- Baseline, incomplete, classification-correction, and market-change cases do not create false releases or destructive archives.
- Large catalogs and personal histories remain accessible through pagination.
- Deep links, mobile forms, Google sign-in, and mounted HTTP routes work in a browser.

Use isolated non-production data for controlled event tests. Production-affecting changes require separate approval. Never demonstrate a synthetic event as a real roaster release.

## 11. Submission evidence and distribution

The [official page](https://www.convex.dev/hackathons/all-gas) names sponsor work, external social proof, and the short demo as judging criteria. A coding agent using OpenAI is not evidence of a runtime product feature. Follows inside Nouveau are not evidence of an X or LinkedIn post.

Before submission:

- Confirm Luma registration and the owner's age, location, affiliation, and other applicable eligibility conditions.
- Keep the GitHub repository public and the app accessible at `convex.site` without an invitation gate.
- Confirm normal self-service sign-in and useful signed-out browsing. Do not expose private data or bypass auth for judges.
- Share the working app on X or LinkedIn and tag @convex, @OpenAI, @firecrawl, and @agentmail. Record the actual post URL and genuine feedback.
- Keep `hackathon.md` factual, with shipped behavior, the stack, real sponsor roles, exact runtime model, live URL, and demo link. Refresh relevant documentation only after behavior exists.
- Submit the repository, live app URL, and a video under three minutes at the [official submission destination](https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit) before the deadline.

The preceding assessment verified public repository visibility and HTTP reachability, not the complete user experience, registration, social post, or completed submission. Those remain tasks, not assumed facts.

The page provides Firecrawl build credits after registration, but no OpenAI API or Convex build credits. Budget runtime model use separately from coding subscriptions. Record usage without collecting private note text as analytics.

### Demo sequence

Target about 2 minutes 40 seconds:

1. Show a real logged coffee and open Find my next bag.
2. Request a shortlist, inspect an explanation, and open its source.
3. Save a coffee and choose an alert.
4. Show a genuine alert with its matching event and actual timestamp.
5. Log a coffee and open a public profile or log view.
6. End with the public URL and a short statement of each sponsor's job.

A prior alert is labeled as earlier, not as the result of a watch created seconds ago. A controlled source is clearly labeled. Plan the sequence early, record the working product, and avoid inventing releases, activity, testimonials, or engagement.

### Success measures

Observe whether people can log a known coffee quickly, retrieve an old log, save a recommended coffee, and understand why an alert arrived. Record actual tester feedback and repair the failures that interrupt those tasks.

Track false alerts, duplicate delivery incidents, stale source coverage, and recommendation failures. Feed time and catalog size do not prove usefulness. Public posts and engagement are submission evidence, distinct from these product measures.

## 12. After the hackathon

The personal-product direction remains. The deferred work is not a hidden prerequisite for this release:

- Bags with unopened, open, and finished states, plus optional roast and opening dates.
- Private member-added coffees, followed by a controlled public contribution and correction flow.
- Person follows if they did not fit, then comments only with moderation controls.
- Durable lot identity separated from shop listings and copy revisions, with migration rehearsal and old-link preservation.
- Feed fanout and staged crawl generations where measured scale or correctness requires them.
- Export and account-management improvements, richer personal retrieval, and explicit taste-profile controls.
- Local scenes, custom collections, detailed brew records, social previews, and digest delivery.
- Prediction cards only when sufficient history supports the claims.

DMs, payments, autonomous purchases, native clients, and broad conversational agents remain outside the current product commitment. A service-sender migration is a later maintenance decision, not a hackathon feature.

The release succeeds when personal history helps someone choose a real coffee and the monitoring system helps them get it. Build that connection on the existing app, then earn the larger roadmap through actual use.
