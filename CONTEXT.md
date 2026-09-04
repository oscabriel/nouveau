# Nouveau

A drop-alert service with a social layer for home coffee brewers: watches US specialty roasters' shops, catches the moments that matter, and gives coffee people a place to keep and share what they've tried.

## Language

**Roaster**: A specialty coffee roastery whose shop Nouveau watches. Roasters don't opt in; watching is done from public product pages. _Avoid_: Brand, vendor, shop (for the business; "shop" means the website)

**Lot**: One coffee product in a roaster's shop — the user-facing unit of a release. A lot has one or more bag sizes. _Avoid_: Product in user-facing copy; "product" is fine in code and schema

**Variant**: A bag size of a lot, carrying its own price and stock state. _Avoid_: SKU, size option

**Drop**: The release of a new lot by a roaster — the moment Nouveau exists to catch. Used loosely in the wild for any limited release; here it means "new lot appeared on a watched shop."

**Drop event**: A detected change on a watched roaster's shop that warrants notifying watchers: new lot, back-in-stock, or a downward price move. Sold-out states and upward price moves are observations, not drop events; they are stored for stats and never notify. _Avoid_: Alert (an alert is the notification sent about a drop event, not the event itself)

**Watch**: A user's following relationship with a roaster. One user watches many roasters. The watch is the unit that carries health. _Avoid_: Follow, subscription, watchlist item

**Watch status**: The health state of a watch, derived from its roaster's crawl source: watching, stale, or crawl-failed. Exists so silence is never mistaken for "nothing new." If a watch can't be confirmed healthy, the user sees that.

**Crawl source**: The per-roaster pipeline state that a watch's health derives from. One roaster has one source. _Avoid_: Crawler, job

**Baseline crawl**: A roaster's first successful crawl, which populates its lot catalog and fires no drop events. Alerts start from the second crawl. A source with no baseline is not yet alert-worthy. _Avoid_: Seeding, initial crawl

**Archived lot**: A lot that has been absent from three consecutive successful crawls. Archived lots can't fire back-in-stock events; they remain in history. _Avoid_: Sold out (sold-out is a stock state, not an archive state)

**Local scene**: A saved view of roasters near a location the user entered (city, zip). The user's own coffee geography, as opposed to the curated directory.

**Taste profile**: A user's preferences used for matching drops to people. Deferred beyond launch; at launch, matching is follow-based (everything from roasters you follow).

**Submission**: A user's attempt to add a roaster by pasting its URL. Validated automatically; a submission becomes a roaster when its baseline crawl succeeds, or fails visibly with a retry. _Avoid_: Request, suggestion

**Degraded alert**: An alert sent when structured extraction failed but the raw page shows something changed. Worse data beats no alert.

**Log**: A user's record of trying a lot: the lot, an optional rating, optional personal notes, and when it was logged. The unit of the social layer; logs are public. _Avoid_: Review, check-in, entry

**Rating**: A log's 1–5 star score, half steps allowed. A log can exist without one. _Avoid_: Score, stars (stars are the display, not the value)

**Notes**: The taster's own words on a log. _Avoid_: Tasting notes unqualified — unqualified "tasting notes" means the roaster's (see Roaster notes), and an alert email's summary is neither

**Roaster notes**: Tasting descriptors taken from the roaster's own copy — description prose and tags on the lot's shop page. Only descriptors literally present count; nothing is invented. _Avoid_: AI summary (that's the alert email's generated line)

**Profile**: A user's public page: their logs, ratings and notes, plus the roasters they watch. One per user. _Avoid_: Account (that's the sign-in); Taste profile (that's the deferred matching concept)

**Activity feed**: The public feed of recent logs across all users. _Avoid_: Timeline, social feed; the drop feed (§8.1 of the build spec) is the other feed and stays distinct
