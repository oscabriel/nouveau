# Nouveau

A drop-alert service with a social layer for home coffee brewers: watches US specialty roasters' shops, catches the moments that matter, and gives coffee people a place to keep and share what they've tried.

## Language

**Roaster**: A specialty coffee roastery whose shop Nouveau watches. Roasters don't opt in; watching is done from public product pages. _Avoid_: Brand, vendor, shop (for the business; "shop" means the website)

**Lot**: One roasted coffee in a roaster's shop — the user-facing unit of a release. A lot has one or more bag sizes. Whole bean, ground, instant and steeped bags all count; the format doesn't matter, the coffee does. _Avoid_: Product in user-facing copy; "product" is fine in code and schema

**Non-lot**: A shop item that is not one roasted coffee, so it never enters the catalog: brewing equipment, merch, tea and other consumables, gift cards, subscriptions, bundles and samplers (several coffees or none), capsules and pods (a format duplicate of a lot), canned and ready-to-drink coffee. Decided at extraction from the shop's own product type, tags and title (build spec §16). _Avoid_: Junk, noise in code and docs; the shop item is legitimate, it just isn't a lot

**Variant**: A bag size of a lot, carrying its own price and stock state. _Avoid_: SKU, size option

**Drop**: The release of a new lot by a roaster — the moment Nouveau exists to catch. Used loosely in the wild for any limited release; here it means "new lot appeared on a watched shop."

**Drop event**: A detected change on a watched roaster's shop that warrants notifying watchers: new lot, back-in-stock, or a downward price move. Sold-out states and upward price moves are observations, not drop events; they are stored for stats and never notify. _Avoid_: Alert (an alert is the notification sent about a drop event, not the event itself)

**Watch**: A user's following relationship with a roaster. One user watches many roasters. The watch is the unit that carries health. _Avoid_: Follow, subscription, watchlist item

**Watch status**: The health state of a watch, derived from its roaster's crawl source: watching, stale, or crawl-failed. Exists so silence is never mistaken for "nothing new." If a watch can't be confirmed healthy, the user sees that.

**Crawl source**: The per-roaster pipeline state that a watch's health derives from. One roaster has one source. _Avoid_: Crawler, job

**Source mode**: How a crawl source reads its shop, decided once by the platform ladder (ADR-0006): the Shopify feed, the WooCommerce Store API, or product pages read one at a time. Every mode produces the same lots and variants; nothing downstream knows which one ran. _Avoid_: Platform (that's the shop's software; the mode is Nouveau's choice of how to read it), html mode (retired)

**Baseline crawl**: A roaster's first successful crawl, which populates its lot catalog and fires no drop events. Alerts start from the second crawl. A source with no baseline is not yet alert-worthy. _Avoid_: Seeding, initial crawl

**Archived lot**: A lot that has been absent from three consecutive successful crawls. Archived lots can't fire back-in-stock events; they remain in history. _Avoid_: Sold out (sold-out is a stock state, not an archive state)

**Local scene**: A saved view of roasters near a location the user entered (city, zip). The user's own coffee geography, as opposed to the curated directory.

**Taste profile**: A user's preferences used for matching drops to people. Deferred beyond launch; at launch, matching is follow-based (everything from roasters you follow).

**Submission**: A user's attempt to add a roaster by pasting its URL. Validated automatically; a submission becomes a roaster when its baseline crawl succeeds, or fails visibly with a retry. _Avoid_: Request, suggestion

**Alert inbox**: The per-user AgentMail address that receives the user's alert emails. Provisioned at first sign-in; one per user. _Avoid_: Email address (that's the Google account's), mailbox

**Degraded alert**: An alert sent when structured extraction failed but the raw page shows something changed. Worse data beats no alert.

**Log**: A user's record of trying a lot: the lot, an optional rating, optional personal notes, and when it was logged. The unit of the social layer; logs are public. _Avoid_: Review, check-in, entry

**Rating**: A log's 1–5 star score, half steps allowed. A log can exist without one. _Avoid_: Score, stars (stars are the display, not the value)

**Notes**: The taster's own words on a log. _Avoid_: Tasting notes unqualified — unqualified "tasting notes" means the roaster's (see Roaster notes), and an alert email's summary is neither

**Roaster notes**: Tasting descriptors taken from the roaster's own copy — description prose and tags on the lot's shop page. Only descriptors literally present count; nothing is invented. _Avoid_: AI summary (that's the alert email's generated line)

**Page facts**: The facts a lot's rendered shop page states that its feed did not: process, variety, region, elevation, producer, roast level and tasting notes. Read verbatim from the page (its text, the theme's notes element, and the labelled facts in its images' alt text) while any of them is still missing, at most three reads per lot a day apart, and shown only where the feed left a gap. _Avoid_: Enrichment, scrape results

**Thin lot**: A current lot with no process, no variety or no notes after its feed facts and page facts are merged. The lot page's badge. A page read is due more widely: whenever any page fact is missing. _Avoid_: Incomplete, sparse

**Profile**: A user's public page: their logs, ratings and notes, plus the roasters they watch. One per user. _Avoid_: Account (that's the sign-in); Taste profile (that's the deferred matching concept)

**Activity feed**: The public feed of recent logs across all users. _Avoid_: Timeline, social feed; the drop feed (§8.1 of the build spec) is the other feed and stays distinct

**Lot page**: The lot's own public page (`/lots/$lotId`): its published copy, its roaster, and its logs. Every surface naming a lot links here. _Avoid_: Product page (that's the roaster's shop URL the lot page links out to)
