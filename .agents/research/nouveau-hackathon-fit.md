# All Gas assessment of the first Nouveau proposal

Historical assessment of the first, unconstrained reimagining against the [official hackathon page](https://www.convex.dev/hackathons/all-gas) and local source at `3d50c8d`. The source and live-check findings below describe that review, not a fresh verification.

The [revised product spec](nouveau-reimagined-product-spec.md) now incorporates these findings and replaces the draft graded here. The C+ verdict and feature grades below apply to the earlier draft, not the revised spec. Keep this report as the rationale for the changed scope and build order.

These are advisory grades, not official scores or predicted results. The page publishes criteria but no numerical weights. A design earns no credit for an implementation that does not exist.

## Verdict

I give the full reimagining **C+ as a hackathon execution plan**. I still prefer its personal-product direction, but it spends too much work on journal and social breadth while postponing runtime OpenAI and the sponsor-backed discovery-and-alert flow.

The existing alert-led product is the stronger submission base. Its Convex behavior, monitoring, email delivery, public pages, and engineering history already support several judging criteria. It still has an OpenAI gap and unverified submission deliverables.

The best entry is a smaller hybrid: keep the implemented monitoring and alerts, improve the path through personal coffee history and saving, and add one grounded OpenAI feature that helps someone choose a coffee. Do not rebuild the backend to demonstrate that idea.

## 1. What the page actually asks for

The official introduction says to build a new full-stack app with Convex, Firecrawl, and AgentMail. The judging criteria explicitly say:

> OpenAI, Firecrawl, and AgentMail do real work in your product.

The next sentence clarifies that they should generate, crawl, or send rather than just appear in the README. This is the largest mismatch with my proposed scope. The original spec at least planned an OpenAI-generated alert summary. The current implementation has no runtime model call, and my proposal explicitly defers AI summaries, embeddings, and algorithmic recommendations. [S1]

Other distinctions from the page matter:

- "Everyday apps, not developer tools" fits coffee tracking and alerts. There is no requirement to build an AI developer product.
- Creativity and usefulness include something a real person can use this week. The page says copycats score low.
- Convex depth means actual queries, mutations, live updates, auth, and components. A module reorganization alone does not improve this score.
- Hosting at `convex.site` or `chatgpt.site` is required. Judges or an agent must be able to open the app without an invite.
- Social proof means sharing on X or LinkedIn. Engagement counts. It does not mean implementing social-network features inside the app.
- The video must be under three minutes, with more real product interaction and less explanation.
- Judges read the hackathon build log. It should contain what was built, the stack, the live URL, and the demo link. [S1]

The rules section requires Convex and cohost or partner integrations, but does not spell out an automatic disqualification formula for a missing sponsor. I would treat missing runtime OpenAI as a serious judging and compliance risk, not claim the page proves automatic disqualification. Using Codex during development should not be assumed to satisfy the separate criterion about OpenAI doing work in the product. The page permits other IDEs for a `convex.site` app. [S1]

## 2. Grading against the published criteria

This compares the original alert-led direction with the reimagining as a design. Shipped evidence and missing artifacts are accounted for separately below.

| Criterion | Original alert-led direction | Full reimagining | Assessment |
| --- | --- | --- | --- |
| Everyday app | A | A | Both serve home coffee drinkers rather than developers. |
| Creativity | B+ | B | Cross-roaster monitoring connected to coffee history is a better differentiator than leading with another logging social network. This is a risk in positioning, not a claim that Nouveau copies an existing app. |
| Usefulness | B+ | A- | Bags, saved coffees, dated history, and better retrieval improve usefulness between drops. Actual user testing would still be needed. |
| Convex depth | A | A | The current core already uses the named platform capabilities. More tables, fanout, and identity machinery are not necessary to demonstrate depth. |
| Sponsor stack | B as originally intended; weaker as shipped | C | The original planned a role for OpenAI. The reimagining removes that role while retaining Firecrawl and AgentMail. Neither gets implementation credit for a planned model call. |
| Live URL | A for hosting choice | A for hosting choice | The current public origin responds. A proposed rebuild is not a deployed replacement. |
| Social proof | Unverified | Unaddressed | No post or engagement evidence was found in the reviewed repo materials. Building Following does not satisfy this criterion. |
| Video | B+ for demo focus; artifact unverified | C for demo focus; artifact unverified | Monitoring, an alert, and a coffee page make a short story. A full bag lifecycle, social graph, identity redesign, and notification system compete for screen time. |
| Build log | A- for engineering evidence | C as a submission plan | Existing history is detailed and candid. The proposal does not specify a submission-ready evidence package. The current log still has no demo link. |

The last row is an explicit page instruction rather than a separately published weighted category. Do not add these letters into an invented official total.

## 3. The sponsor scorecard

### Convex: A, carry it forward

This is the strongest part of Nouveau's submission base. The source has real auth, database writes, reactive feeds, scheduled crawls, component calls, file storage, and notification state. `packages/backend/convex/convex.config.ts` mounts the integrations; `crawler.ts`, `crawlSources.ts`, `logs.ts`, and `notifications.ts` show actual behavior. [R1]

The batch-commit, currency, classification, and notification fixes in `hackathon.md` are evidence of building against real data. They support a stronger story than adding another component solely to lengthen the technology list. [R2]

I would withdraw the pre-submission recommendation to restart from `a37561b`. That is a reasonable structural reference for a future rebuild, but the hackathon judges what ships. The existing app already demonstrates depth.

### OpenAI: F for current runtime evidence and for the proposal as written

The current log states "AI models: none". A source search found an optional `aiSummary` field and an email slot, but no generator. `notifications.ts` explicitly says the slot remains empty until the generator lands. [R1, R2]

My proposal makes the gap permanent for launch by deferring every runtime AI feature. That is the clearest mistake when evaluated against this event.

Restore one useful model-powered behavior. My preference is **Find my next bag**: compare a bounded set of available coffees against a user's selected favorites and request, then return a short, source-linked shortlist. This is more connected to personal tracking than generic tasting-note prose.

A smaller fallback is a faithful summary of an actual new release, with source links and no invented descriptors. That meets the published "generate" wording, but has less product value than a recommendation tied to the user's history.

### Firecrawl: B+, with stronger visible evidence needed

Firecrawl is not merely installed. `crawler.ts` calls `scrape`, `startCrawl`, and `listPages`. The build log records an HTML crawl completing through the component. [R1, R2]

However, most of the intended seed coverage uses direct Shopify JSON. A demo showing only that path would not visibly establish Firecrawl's contribution.

Keep structured JSON for prices and stock. Show a genuine Firecrawl job handling a source or product detail that the JSON does not provide. The existing spec already identifies richer roaster-page copy as a useful extension. Do not replace working JSON extraction with a slower path just to display a sponsor logo. [R3]

### AgentMail: A- for the implemented role

The code provisions inboxes, calls `agentmail.sendMessage`, stores outbound IDs, and connects delivery state to the app. That is real product work rather than a nominal dependency. Current delivery reliability still needs an end-to-end check; this review did not send mail. [R1]

The page's criterion explicitly includes sending. It does not require one inbox per user, receiving replies, or a conversational email agent. A service sender can satisfy the published role. [S1]

But replacing the current sender model before submission has little judging payoff. Keep the existing working implementation unless its reliability forces a change. My simplification was a long-term architecture opinion, not a reason to spend hackathon time on mail migration.

## 4. Grade the original features we would carry over

These grades measure hackathon contribution relative to effort and demo relevance, not intrinsic code quality. "Implemented" reflects source and build-log evidence, not a fresh full production test.

| Feature | Grade | Evidence or status | Decision |
| --- | --- | --- | --- |
| Real roaster monitoring and drop detection | A | Implemented | Keep central to the demo. It connects external data to a concrete user benefit. |
| Convex live updates, auth, scheduled work, and components | A | Implemented | Preserve; demonstrate behavior rather than enumerate APIs. |
| AgentMail alerts and delivery ledger | A- | Implemented | Show a genuine alert and its matching event. |
| Coffee pages, logs, ratings, public profiles | A- | Implemented | Keep. These give monitoring a personal and shareable destination. |
| Classifier, US-market pin, pagination, baseline and archive rules | A- | Implemented | Preserve the fixes and regression cases. They make the result credible. |
| Visible source health | B+ | Implemented | Keep quiet but available; it makes missing updates explainable. |
| Firecrawl extraction and richer product copy | A- | Extraction implemented; richer page work partly proposed | Select one meaningful real example for the demo. |
| User-submitted roaster URL | B+ | Planned in the original spec | Useful if narrow and reliable, but do not make arbitrary-site support a launch promise. |
| OpenAI alert summaries | B | Planned, not implemented | A valid minimum sponsor feature, though a personalized shortlist is stronger. |
| Drop-rhythm prediction | C+ | Planned, not implemented | Cut unless enough observations support a defensible prediction. |
| Local scene pages | C | Planned, not implemented | Keep location filters; defer a separate product area. |
| Per-user inboxes and reply controls | C for extra scope | Inboxes implemented; reply controls deferred | Retain the working inbox setup, but do not add reply automation just for judging. |
| Custom social-preview images | B- | Planned | Helpful for actual sharing, below the working loop and missing OpenAI behavior. |

## 5. Grade my proposed additions

| Proposal | Grade for this hackathon | Decision |
| --- | --- | --- |
| My coffee, Discover, Following navigation | A- | Keep the task-oriented simplification, scaled to the functions that actually ship. |
| Want to try and saving from a coffee page or log | A | High value and directly connects personal history, social discovery, and alerts. |
| Coffee-specific restock alerts | A | Explicit user intent and a clear reason for AgentMail to act. |
| Dated history and faster mobile logging | A- | Makes the everyday-app claim credible and shows well in a short demo. |
| Private/public log choice | B+ | Worth doing for trust. Keep all visibility checks together; do not add partial privacy. |
| Person follows | B | Useful if the central loop is already complete. Not a substitute for external social proof. |
| Full bag lifecycle and inventory | C+ | Good roadmap material, but too much form and state work for the judging benefit. |
| Comments, reporting, and moderation | C | Real social value, expensive to ship responsibly. Defer comments rather than ship them without controls. |
| Public member-added coffee records and merge tools | C+ | Solves coverage, but public provenance and duplicate handling expand the job. |
| Lot revisions and separation from source listings | B for domain correctness; C for a full migration now | Preserve stable records and snapshots where necessary. Defer the full identity redesign unless current corruption makes it unavoidable. |
| New feed fanout and staged crawl generations | C as broad pre-submission work | Fix concrete correctness defects, but do not rebuild healthy paths to display architecture. |
| Removing speculative extraction-failure alerts | A- | Keep the truthfulness rule. A changed page does not prove a coffee release. |
| Moving detailed delivery state to an inbox | B+ | Good UI improvement; keep delivery proof reachable for the demo. |
| Removing per-user inbox provisioning | C before submission | No material judging gain if the existing implementation works. |
| Deferring all runtime OpenAI | F | Reverse this decision. |
| Restarting from an early commit | D as execution strategy | Keep the existing deployed app as the submission base. |

## 6. The focused hybrid I would submit

The revised pitch is:

> Nouveau remembers the coffees you like, helps you choose your next bag, and watches for the releases you care about.

This retains personal tracking and sharing, but gives all sponsor integrations a direct role in one user task.

### One grounded OpenAI feature

**Find my next bag** accepts a few favorites selected by the user and a request such as a budget and a preference for something similar or different.

Convex first narrows the current catalog using reliable price, size, currency, and availability fields. Firecrawl supplies real product-page detail where structured feeds lack it. OpenAI compares the candidates and produces a bounded shortlist with explanations tied to supplied coffee records and source passages.

The model cannot invent lots, prices, availability, or tasting descriptors. The app validates returned IDs and rechecks availability before display. Unknown preferences stay unknown. Selecting private logs for model processing requires a clear user action. No chat system, embeddings project, or autonomous purchasing is required.

The same coffee can then be saved or watched. AgentMail delivers actual opted-in updates. Public logs and profile links make it possible to share what somebody tried.

### Scope order

1. Preserve and verify the shipped monitoring, catalog, email, and logging paths.
2. Add the grounded OpenAI shortlist and document actual Firecrawl participation.
3. Add saving and coffee-specific watches, with a simpler My coffee path.
4. Polish the mobile loop and provide public browsing plus self-service sign-in, with no invitation gate.
5. Add person follows only if the preceding loop and submission artifacts are complete.

Keep the full reimagining as a roadmap. Do not present its unfinished features as part of the entry.

## 7. Eligibility and evidence checklist

| Requirement | Evidence from this review | Status |
| --- | --- | --- |
| App started on or after Aug 25 at noon PT | Earliest project commit is Aug 29 | Consistent with the window; Git history is evidence, not proof of all prior work |
| Public GitHub repository | `gh repo view` reports PUBLIC | Verified |
| Public `convex.site` or `chatgpt.site` URL | `https://artful-chameleon-402.convex.site` returned HTTP 200 | Reachability verified; full browser and sign-in flow not retested |
| Convex backend and partner integrations | Source mounts and calls the integrations | Convex, Firecrawl, and AgentMail evidenced; runtime OpenAI missing |
| Luma registration and personal eligibility | Not available in reviewed materials | Owner must confirm |
| Share on X or LinkedIn, tagging all four sponsors | No post link found in reviewed repo docs | Unverified, not evidence that no post exists |
| Video under three minutes | No demo link found in the build log | Unverified |
| Build log with product, stack, live URL, and demo | Product, stack, and URL present; demo link absent; models accurately listed as none | Needs final submission details after work exists |
| Submit repository, app URL, and video by Sep 22 at noon PT | Official page lists deadline; submission form requires sign-in | Submission not verified or performed |
| Original work, rights, age, location, and affiliation restrictions | Official rules list these conditions | Owner must confirm applicable eligibility |

The page offers 20,000 Firecrawl credits after Luma registration and says it does not provide OpenAI API or Convex credits during the build. Budget runtime OpenAI usage; do not assume coding-subscription credits pay for the product's API calls. [S1]

I opened the submission page but did not authenticate, register, submit, or publish anything. Its anonymous view exposes only sign-up/sign-in, so this report does not infer additional form requirements. [S2]

### Build log and social proof

The current build log is useful evidence because it names real defects, fixes, and verification limits. Keep that honesty. Add the final demo link, exact runtime model, actual sponsor behavior, and a short reproducible user path once those exist. Never list an optional schema field as a functioning model integration.

For external social proof, share a usable URL with an actual coffee task and ask real brewers to try it. Record the post URL and genuine feedback. Do not fabricate activity, testimonials, engagement, or app users.

### A video under three minutes

Aim for about 2 minutes 40 seconds:

- First 20 seconds: show a real logged coffee and the problem of choosing the next one.
- Next 45 seconds: request the shortlist, open an explanation, and show its real source.
- Next 30 seconds: save a coffee and enable a specific alert.
- Next 30 seconds: show a genuine prior alert and its matching event, with its actual timestamp visible.
- Next 25 seconds: record a coffee and open its public log or profile.
- Final 10 seconds: show the live URL and summarize which sponsor performs which job.

A prior alert must be labeled as earlier, not presented as the result of a watch created seconds ago. Alternatively, use a clearly labeled controlled source to demonstrate the actual transition. Do not wait for a real roaster to release something on camera, invent a drop, or build a fake public activity feed.

## 8. What I am changing my mind about

I would keep personal history at the center of the long-term product, but I would not put a complete social journal ahead of the working discovery and alert chain for this event.

The hackathon gives us a reason to retain the original product's strongest behavior and make it easier to understand. It does not give us a reason to build every social feature or discard tested infrastructure.

My recommendation is a focused submission built on current main, with saving, a grounded OpenAI shortlist, visible Firecrawl contribution, real AgentMail delivery, and an honest short demo. The full rebuild waits.

## Sources

- **S1.** [Convex All Gas Hackathon](https://www.convex.dev/hackathons/all-gas). Official qualification and judging criteria, participation steps, eligibility, hosting, public-repository requirement, sponsor expectations, deadline, and build credits. Fetched through Firecrawl during this review.
- **S2.** [Official submission destination](https://vibeapps.dev/judging/convex-all-gas-hackathon-openai/submit). Anonymous access requires sign-in before form details are available.
- **R1.** Local source at `3d50c8d`, particularly `packages/backend/convex/convex.config.ts`, `crawler.ts`, `notifications.ts`, `schema.ts`, `logs.ts`, and `feed.ts`.
- **R2.** `hackathon.md`, project history and documented verification. Historical deployment claims are not fresh production checks.
- **R3.** `docs/build-spec.md` and `docs/adr/0001-shopify-products-json-as-primary-extraction.md`, original intended product and extraction rationale.
- **R4.** The first, pre-hackathon reimagining, whose decisions and grades are recorded above. Its replacement is the [revised product spec](nouveau-reimagined-product-spec.md); that revision is not the subject of these historical grades.
- **R5.** Read-only checks in this session: public repository visibility, earliest Git commit timestamp, whole-source model-call search, and HTTP 200 from the public app origin. No deployment mutation, app data query, email send, or full browser test occurred.
