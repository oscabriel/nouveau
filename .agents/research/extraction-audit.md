# Extraction audit

Written 2026-09-15 for handoff Task 1. Investigation only; nothing here changed code or deployed. Every number below comes from one of three sources, all reproducible:

- **Live feeds.** All 20 seed roasters' `/products.json`, every page, fetched 2026-09-15 (`/tmp/nouveau-audit/feeds/*.json`, 4,367 raw items, 18.7 MB). The real `parseProductsJson` and `classifyLot` from `extraction.ts` were run over them with `bun run` from `packages/backend`, so the numbers describe what the crawler would write today, not an approximation of it.
- **Dev export.** `npx convex export` of `cool-giraffe-632` the same day: 2,570 `products`, 11,875 `productVariants`, 569 `dropEvents`, 742 `rawCaptures`, 20 `crawlSources`.
- **Firecrawl.** Ten `/v2/scrape` calls (two per page, five pages) with the exact `ENRICHMENT_PROMPT` and `enrichmentSchema` from `recommendationRules.ts`, plus one product page fetched per roaster to see what the page carries that the feed does not.

The one-line summary: the feed data is better than the extractor makes it look. Prices and availability are right. Almost everything else that is wrong is either a field we take from the wrong place (`grams`), a fact we do not look for where the roaster put it (`origin`, `process`, `roastLevel`), or a regex that stops in the wrong spot (`roasterNotes`). And the biggest single finding is not about extraction at all: Passenger has a full Shopify feed at `www.drinkpassenger.com/products.json`, so html mode was never needed for it.

## 1. Headline findings, ranked by what a judge would see

1. **`grams` is Shopify's shipping weight, not the bag size.** East Pole "12 oz." variants carry `grams: 397` (0 of 27 East Pole variants match their name). Blossom's 12oz/1lb/2lb bags all carry `grams: 0`, so `meetsConstraints` (`grams > 0`) excludes every Blossom lot from Find my next bag forever. Sey "125g" carries 454, so a 125 g bag passes the 200 g minimum. Sightglass "2lb / Whole Bean" carries 340. Verve "10 OZ" carries 340 and the result card prints `10 OZ / Whole Bean (340 g)`. Across all roasters 9,804 variants name a size; 7,748 of them (79%) agree with `grams` within 12%, which means about one in five numbers shown or filtered is wrong. The variant name is right essentially every time. Fix: parse size from the variant name and option values first, fall back to `grams` only when the name has no size.

2. **Passenger does not need html mode.** `https://drinkpassenger.com/products.json` is a 404 (the apex is a headless Next.js front). `https://www.drinkpassenger.com/products.json` returns a normal three-page Shopify feed: 565 items, 260 classified as lots, with `body_html`, tags and images. This closes #25 differently from how it was written: change the roaster's `websiteUrl` to the `www.` host (or have `shopifyProductsUrl` retry on `www.` after an apex 404), set the source back to `products_json`, `rebaselineSource`. The 30 bare html-mode rows on dev (`externalId` like `https://drinkpassenger.com/products/agaro?Size=250%20g`, one of them "Foundational Subscription" because html mode skips the classifier) go away with a rebaseline. It also stops the only recurring Firecrawl spend: an html crawl bills the json format per page, 5 credits × up to 10 pages, every hour.

3. **`origin` lands on 3 of 20 roasters, `process` on 5, `roastLevel` on 1.** Only tag conventions are read (`origin:`, `From:`, `Country:`, `Process:`, `Roast:`, bare `Washed`). 2,075 of 2,771 lots have no origin; 1,269 of those name the country in the title ("Kenya Karumandi", "2026 Demeka Becha - Ethiopia", "Mexico - Altura Veracruz - Natural") and 220 more carry it as a bare tag (`Rwanda`, `El-Salvador`) or Counter Culture's `origin__colombia`. Roast level is in bare tags at Blossom (`Light roast`), Sightglass (`Medium Dark`), Ruby (`Light Roast`), Counter Culture (`roastlevel__dark-roast`), La Colombe (`medium roast`), and in body prose at Ruby (`Medium-light Roast` on its own line) and La Colombe (`Roast Level: Medium`). None of these are read.

4. **`roasterNotes` stops in the wrong place on both sides.** The clause regex runs to the sentence end, so `A, B, and C, this coffee is...` swallows the next clause: 26 stored notes contain a swallowed clause (`bittersweet chocolate and graham cracker, this classic Dark Roast tastes great on its own or with the addition`), 87 are 120+ characters, 85 end in punctuation or an emoji. The `we taste` pattern is line-bounded for Ruby's dash lists and so at Blossom it swallows `. 🌑`. Meanwhile 51 lots with no notes open their description with a bullet list that is the notes (Merit: `Prunes • Fig Danish • Nutmeg`), and Passenger's lead-in-free sentences (`Dark berries, subtle warming spices, and a molasses-like sweetness come together in...`) are missed. Stumptown and Sightglass put descriptors in bare tags (`Brown Sugar`, `Caramel`, `chocolatey deep`) that nothing reads.

5. **The classifier misses Passenger's 35 "Archival Release" lots** (`product_type: "Archival Release"`, frozen back-catalog coffees sold on "Freezer Friday", literally the drop-culture case the product exists for). 30 are rejected by `default`, the rest by title. Plus one untyped "Gaharo Experiments Wet Process" ("Wet" is not in `LOT_TITLE_WORD`). Everything else the classifier rejects across the 20 feeds (1,620 items) I checked by type and title and found correct, including Regalia's untyped Weber Workshops gear and Onyx's white-label contract roasts.

6. **Merit's catalog is counted two to three times.** 64 lots, 38 duplicate titles: "Sugarcane Decaf" appears 5 times with vendors `Ecommerce`, `Merit`, `Wholesale`, `Wholesale`, `Wholesale` and tags `tier2`, `Airport`, `Normal Wholesale`. 26 of the 64 have `vendor: "Wholesale"`. The `vendor` field is not read anywhere; `isWholesale` looks at type, title and tags only. Every Merit drop fires two or three feed cards.

7. **Firecrawl extraction is deterministic where the field has a shape, and drifts where it does not.** Two runs on each of five pages: `elevation`, `process`, `region` and `tastingNotes` came back byte-identical on 5 of 5. `producer` drifted at Sey (both runs verbatim substrings, different spans). `roastLevel` drifted at Merit (`""` then `"Espresso"`, which is the page's "recommended use", on the page but the wrong field). Passenger returned the literal `"Not specified"` for two fields. Sentence selection differed on 2 of 5. The verbatim check catches "Not specified" but not "Espresso"; a per-field shape check would.

## 2. Field correctness

### 2a. Presence, from the live feeds (2,771 lots after the classifier)

| roaster | feed | lots | description | tags | imageUrl | origin | process | roastLevel | roasterNotes | grams≈name |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| blossomcoffeeroasters | 42 | 17 | 100% | 100% | 100% | 0% | 24% | 0% | 88% | 25% (24/68 are 0) |
| coavacoffee | 78 | 15 | 100% | 100% | 100% | 0% | 47% | 0% | 93% | 100% of named |
| counterculturecoffee | 177 | 136 | 100% | 100% | 100% | 0% | 0% | 0% | 60% | 81% |
| drinkpassenger (www) | 565 | 260 | 75% | 98% | 98% | 0% | 0% | 0% | 43% | 99% |
| eastpole | 21 | 9 | 100% | 0% | 100% | 0% | 0% | 0% | 0% | 0% |
| heartroasters | 35 | 9 | 100% | 100% | 100% | 0% | 0% | 0% | 0% | 83% |
| intelligentsia | 333 | 178 | 83% | 99% | 96% | 15% | 0% | 0% | 16% | 100% |
| lacolombe | 62 | 20 | 100% | 100% | 100% | 0% | 0% | 0% | 5% | 89% |
| madcapcoffee | 112 | 14 | 100% | 100% | 100% | 0% | 0% | 0% | 43% | 100% |
| meritcoffee | 169 | 64 | 100% | 89% | 100% | 0% | 0% | 0% | 33% | 84% (28 are 0) |
| onyxcoffeelab | 248 | 101 | 100% | 100% | 100% | 100% | 100% | 0% | 16% | 55% |
| proudmarycoffee | 732 | 646 | 98% | 94% | 98% | 88% | 88% | 0% | 15% | 83% |
| ptscoffee | 222 | 163 | 100% | 93% | 100% | 0% | 0% | 0% | 84% | 81% |
| regaliacoffee | 47 | 13 | 100% | 0% | 100% | 0% | 0% | 0% | 38% | 50% |
| rubycoffeeroasters | 229 | 23 | 91% | 91% | 100% | 0% | 57% | 0% | 65% | 83% |
| seycoffee | 893 | 879 | 98% | 0% | 100% | 0% | 0% | 0% | 81% | 55% |
| sightglasscoffee | 56 | 22 | 100% | 95% | 100% | 0% | 0% | 0% | 9% | 96% |
| stumptowncoffee | 95 | 32 | 100% | 100% | 100% | 0% | 0% | 0% | 13% | 91% |
| sweetbloomcoffee | 100 | 55 | 100% | 96% | 100% | 0% | 0% | 0% | 5% | 92% |
| vervecoffee | 175 | 115 | 100% | 100% | 100% | 0% | 0% | 46% | 23% | 86% |

`grams≈name` is the share of variants whose name states a size where `grams` is within 12% of it. Onyx's 55% is mostly case packs (`10oz Case Pack (6)` = 1701 g, correctly the case), Sey's 55% is 125 g bags weighed at 454.

### 2b. Correctness, hand-checked

I read six in-stock lots per roaster (seeded random sample, all 20 roasters) plus every value the machine checks flagged. Verdict per field:

**`name`.** Right. Sey prefixes the harvest year (`2026 Demeka Becha - Ethiopia`), Proud Mary uses pipes (`LIMITED | PANAMA | Mama Cata | Pacamara | ASD Natural`), Passenger appends the process and year. All verbatim, all fine for a card. No defect.

**`description`.** Verbatim `body_html` stripped, so its correctness is the roaster's. Three quality problems that leak into cards and passages: (a) Heart's descriptions are half pricing disclosure (`FOB cost: $4.78lb / $10.53kg Landed cost at our warehouse: $5.47lb...`); (b) East Pole's are a flattened table (`New Column New Column PRODUCER Hazel Arias...`), already handled downstream by the #21 label-run mapper but stored raw; (c) Coava and Ruby lead with boilerplate (`Select roast profile (Drip or Espresso) based on your brew method.`, `Due to the limited release of Peru La Neblina, this coffee is offered as whole bean only...`). 25% of Passenger lots have an empty `body_html`.

**`tags`.** Stored as-is, capped at 32. Right by definition. Note Regalia, Sey and East Pole publish no tags at all, so any tag-only rule gives them nothing.

**`imageUrl`.** Present 96 to 100% everywhere. Spot-checked eight; all were the product's primary image. No defect.

**`origin`.** 696 values; 694 are a country, the other two are Onyx's `origin:California` (correct; they grow coffee there). So the values are right. The defects are coverage (§1.3) and blends: `attributes.origin ??= value` keeps the first `From:` tag, so Proud Mary's Humbler Blend (`From: Brazil`, `From: Honduras`) becomes `Brazil` and Intelligentsia's 26.2 Blend (`Country: Ethiopia`, `Country: Guatemala`) becomes `Ethiopia`. 25 lots have more than one origin tag. One Proud Mary row (`COLOMBIA | EA Decaf da Caña - Huila`) is tagged `From: Brazil` by the roaster; that is their error and we store it faithfully, which is the right call.

**`process`.** 696 values, 680 in a closed vocabulary, the rest the roaster's own terms (`Thermal-Shock`, `Culture-Innoculated Washed`, `Pulp Natural`), which are correct. Same first-tag defect: 97 lots carry two `Process:` tags and we keep one. Proud Mary tags `Anaerobic Washed` as `Process: Anaerobic` + `Process: Washed`; we store `Anaerobic`. Blends with `Natural` + `Washed` become `Natural`. The handoff asked about compound values like "Washed, Natural"; the data has the opposite problem, compounds collapsed to one word. Titles name the process on 503 lots that have no `process` (`- Washed Process -`, `| Honey`) and are not read.

**`roastLevel`.** 53 values (44 Light, 6 Medium, 3 Dark), all Verve's `Roast:` tag, all right. The `ROAST_VALUE` anchor correctly rejects Intelligentsia's `Roast Level: Comforting`. No "Lightly sweet" false positives found. Coverage is the whole problem (§1.3).

**`roasterNotes`.** 1,291 values. Right when the list ends at a sentence end or line break (Ruby's dash lists, Sey's `In the cup we find...`, PT's `Notes of...`). Wrong in the four ways in §1.4. The structured `Flavor Profile:` tag fallback (Intelligentsia) works.

**`variants[].name`.** Verbatim Shopify variant titles, right. 285 are `Default Title`; the web layer already hides that string. 224 of them are Sey's sold-out archive (one variant, no size option), the rest are single-SKU items (instant coffee, Proud Mary's 100 g tins, Counter Culture archive). No defect beyond the grams one.

**`variants[].grams`.** See §1.1. Wrong or missing on roughly one in six sized variants. Proud Mary writes `250gms`, which a naive `\d+\s*g\b` misses.

**`variants[].priceCents`.** Right. The `localization=US` cookie fixed the Madcap AED flap; no non-USD price seen in any feed today.

**`variants[].available`.** Right. Cross-checked against the product page for six lots.

## 3. Where facts live, per roaster

Legend: **tag** = readable from a tag today or with a small tag rule; **title**; **body** = in `body_html` as prose or labelled lines; **table** = in a `body_html` table; **page** = only on the rendered product page (theme metafields); **vendor** = Shopify's `vendor` field; **—** = not published anywhere I could find.

| roaster | origin/country | region | process | variety | elevation | producer | roast level | tasting notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| blossom | tag (bare `Rwanda`), title | body | tag (bare), title | body (12%) | body (24%) | body | tag (bare `Light roast`) | body (`We taste`, `notes of`) |
| coava | tag (bare `El-Salvador`) | body | tag (bare `Washed`) | body/page | page | body, tag (`producer-…`) | — | body (`notes of`) |
| counter culture | tag (`origin__colombia`) | page | page | page | page | body | tag (`roastlevel__dark-roast`) | body (60%), page |
| passenger (www) | title, page | page | title (`- Washed Process -`) | body (40%) | page | title (producer names), body | — | body (no lead-in) |
| east pole | table `ORIGIN` | table | table `PROCESS` | table `VARIETY` | table `ALTITUDE` | table `PRODUCER` | — | table `NOTES` |
| heart | title (`Ethiopia Halo`) | body `Location:` | body `Process: Fully washed` | body `Variety:`/`Varietals:` | body `Elevation:` | title | — | — (page has none either) |
| intelligentsia | tag `Country:` | page | page | page | page | page | tag `Roast Level:` is taste, not roast | tag `Flavor Profile:`, page |
| la colombe | body `Origins :` prose | body | body prose | body (10%) | body (35%) | — | body `Roast Level: Medium`, tag `medium roast` | page `Tasting Notes:` |
| madcap | title (ALL CAPS lead), body | body | body prose | body (36%) | body (21%) | body | — | body (`notes of`), page |
| merit | page, body | page | page `Process` | page `Cultivar` | page `Altitude` | page | page (`recommended use`, not roast) | body bullet line `A • B • C` |
| onyx | tag `origin:` | page | tag `process:` | page | page | page | — (`profile:modern`) | page (16% in body) |
| proud mary | tag `From:` (multi) | body | tag `Process:` (multi), title | title (pipe segments, e.g. Pacamara) | body (22%) | title, body | — | page, body (15%) |
| pt's | body | body | title, body | body | body | body | body prose (`medium-dark roast`) | body (`Notes of`, `We found notes of`) |
| regalia | vendor (`Huila, Colombia`), body | body | body | title, body | body | body | — | body prose (38% via `notes of`) |
| ruby | title (`Peru El Roble`) | body | tag (bare `Washed`) | body | body | body | body own line `Medium-light Roast` | body `We Taste:` dash list |
| sey | title (`- Ethiopia`) | page | page `Processing` | page `Variety` | page `Altitude` | title | — | body (`In the cup we find`) |
| sightglass | title (`Mexico, Rancho La Perla`) | title | page | page | page | vendor (`Wilfredo Ule Vargas`), title | tag (bare `Medium Dark`) | tag (`chocolatey deep`, `fruited bright`) |
| stumptown | title (`Kenya Karumandi`) | body | body prose | — | — | body | — | tag (bare `Caramel`, `Brown Sugar`), page |
| sweet bloom | body prose | body | body prose | body | — | body | — | body (`flavors of`, 5%) |
| verve | tag (bare `Costa Rica`), `Region:` | tag `Region:` | body prose | body | body, page | body | tag `Roast:` | body (23%), page |

What this table says: country and process are recoverable from the feed (title, tags, body) for 19 of 20 roasters without a page fetch. Variety, elevation and producer are feed-recoverable at about 11 roasters and page-only at Onyx, Sey, Intelligentsia, Merit, Counter Culture and (partly) Coava, Sightglass, Verve. Tasting notes are feed-recoverable at 15 and page-only at Onyx, Heart (nowhere), Intelligentsia (page), Merit (page has the same bullets), Stumptown (tags + page). A crawl-time page pass is worth it for six roasters, not twenty.

One correction to the handoff: Heart does not keep its facts in metafields. They are in `body_html` as `Location: Gedeb Elevation: 1900-2200m Varietals: Heirloom Process: Fully washed`, mixed with FOB cost lines. Heart's page adds nothing the feed lacks.

## 4. Determinism

Method: the exact `ENRICHMENT_PROMPT` and `enrichmentSchema`, `onlyMainContent: true`, `maxAge: 0`, two calls per page. Pages: Onyx Kenya Kamunyaka AA, Sey Huila Decaffeinated, Merit Ojo de Agua, Passenger Los Sueños Decaf, Intelligentsia Honduras La Tortuga Batian. Files in `/tmp/nouveau-audit/determinism/p{1..5}{a,b}.json`.

| field | identical runs | notes |
| --- | --- | --- |
| tastingNotes | 5/5 | Passenger's list includes the lead-in: `"Notes of Cherry"` |
| elevation | 5/5 | `1800 MASL`, `1,600 - 1,800 masl`, `1500-1730masl`, `1600 - 1700 m`, `Not specified` |
| process | 5/5 | Sey's is a 30-word paragraph (`Hand-picked at peak ripeness. Floated to...`), verbatim |
| region | 5/5 | Onyx returned the country (`Kenya`), Intelligentsia a region (`Chinacla, La Paz`), Merit both |
| producer | 4/5 | Sey: `a blend of harvests from a small group of producers in San Agustín, Huila` vs `A small group of producers in San Agustín, Huila` |
| roastLevel | 4/5 | Merit: `""` vs `"Espresso"` (on the page as "recommended use") |
| sentences | 3/5 | same count, different picks |

The regex paths (`extraction.ts`, `catalogPassages`) are deterministic by construction.

Is the verbatim check enough to write into a column? No, on its own. It rejects invented strings (`Not specified`, a paraphrase) and it rejected nothing here that should have landed. But it accepts a wrong-field value that happens to be on the page (`roastLevel: "Espresso"`), a paragraph where a term was wanted (Sey's process), and a lead-in glued to a value (`Notes of Cherry`). The handoff's proposal holds up with one addition: verify verbatim **and** per-field shape, and make the shape check the same one the feed path uses, so a `process` from a tag and a `process` from a page pass the same gate.

Proposed shapes (all case-insensitive, applied after `normalizeProse`-style trimming):

- `process`: one to four words drawn from a closed vocabulary (washed, natural, honey, anaerobic, carbonic, thermal shock, wet hulled, pulped natural, decaf method names, plus the qualifiers white/red/black/yellow/extended/co-ferment). Anything else is stored as `processNote` free text flagged unverified, or dropped.
- `elevation`: `\d[\d,]*(\s*-\s*\d[\d,]*)?\s*(m|masl|meters|ft|fasl)`. Store the string; parse a number only for display.
- `roastLevel`: `(light|medium|dark)([ -](light|dark))?` optionally followed by `roast`. Nothing else.
- `origin`: a country from a fixed list (the `LOT_TITLE_PLACE` countries). `region` takes anything place-shaped up to four words (the existing `looksLikeOrigin`).
- `variety`: a known-variety list (bourbon, typica, caturra, catuai, gesha/geisha, sl28, sl34, heirloom, pacamara, castillo, colombia, sidra, pink bourbon, chiroso, wush wush, batian, ruiru 11, 74110/74158/74165, ...) plus free text up to four words flagged unverified.
- `producer`: up to eight words, no sentence punctuation, not starting with an article. Weakest field; accept drift.
- `tastingNotes`: `string[]`, each item one to four words, no verbs, lead-ins (`notes of`, `flavors of`) stripped before the check. Cap eight.

Cost: 5 credits per json scrape, so 2 per recommendation run (10 credits) today. A crawl-time pass over the six page-only roasters' in-stock lots (Onyx 27, Sey 7, Intelligentsia 25, Merit ~26 unique, Counter Culture 19, Stumptown 17 ≈ 120 pages) is 600 credits once, then only for new lots (dev saw 290 `new` events across all 20 roasters in ~2 weeks, so perhaps 20 a week at these six, 100 credits a week). The account has 17,781 credits. Comfortable, as long as page enrichment runs once per lot and not once per crawl.

## 5. Schema shape

What I would change on `products`, and why, in order of confidence:

- **`variants[].grams` from the name.** Not a schema change, an extraction change. Keep the column. Add `sizeSource: "name" | "shopify"` on `productVariants` only if we want to show provenance; probably not needed.
- **`roasterNotes: string[]`** instead of one clipped string. Every good value in the data is already a list (`Cherry Cola - Dried Fig - Brown Sugar - Cocoa Nib`, `Prunes • Fig Danish • Nutmeg`, `pineapple, Earl Grey tea, and jasmine`). A list renders as chips, dedups, and gives the shape check something to check. Keep the joined string for the recommendation passage (`Tasting notes: a, b, c.`). This is a migration (`@convex-dev/migrations`), small.
- **Add `variety`, `region`, `elevation`, `producer`** as optional strings. Feed-recoverable at half the roasters, page-recoverable at the rest.
- **Add `productType`** (raw Shopify `product_type`). §16 deferred it; the classifier reads it, an audit or a per-roaster rule wants it stored. Cheap.
- **Provenance per field, not per row.** Today an absent field in an authoritative feed `lotCopy` clears the stored value. That is correct for feed facts and destroys page facts. Proposal: `facts: { process?: { value, source: "tag" | "title" | "body" | "page", observedAt } , ... }` or, simpler and flatter, keep the plain columns and add one `pageFacts` object holding only page-derived values with a `fetchedAt`. The feed write touches the plain columns and never `pageFacts`; a read merges with the feed winning on conflict (the feed is what the roaster publishes structurally; the page is what their theme renders). Flatter wins: `copyFetchedAt` on the row, `pageFacts` as the only page-owned field.
- **`lotCopy` provenance.** With the above, `lotCopy` stays feed-only and needs no source flag.

Not proposing: `sourceOfFact` per field as a full ledger. Overkill for a display feature.

## 6. HTML-mode parity

Moot for Passenger (§1.2). Keep html mode for user-submitted non-Shopify shops (the spec's reason for it), but note what it does today: no classifier (subscriptions land as lots), no `lotCopy`, one `Default` variant per product, `externalId` = the URL Firecrawl extracted including query strings. If it stays, three fixes: run `classifyLot` on `{ title: name }` at least; strip query and hash from the URL before it becomes `externalId`; and scrape each product URL with the enrichment schema, bounded to the first N new URLs per crawl. Logs on a lot whose `externalId` changes: the old row goes through the 3-strike archive and keeps its logs; the new row is a new lot with no logs. That is the correct behavior for a lot that genuinely changed URL and the wrong one for a query-string flap, which is why the strip matters.

## 7. Non-lot leakage, both directions

**False negatives (real coffees rejected), from the live feeds:**

- Passenger `Archival Release #NN - <name> - <year>`, `product_type: "Archival Release"`, tag `Freezer Friday`: 35 items, 125 g, all real single lots. `typeVerdict` returns unknown, the untyped path finds no place word, `default` rejects. Fix: add `archival|release|freezer` to `LOT_TYPE` for Passenger's convention, or better, a bare-tag `Freezer Friday` rule. 30 rejected by `default`, 5 by `title`: their titles contain `Cup of Excellence`, `Archival Release` is an unknown type so they take the untyped path, and there `cups?` in `NON_LOT_AMBIGUOUS_TITLE` rejects unless a place or craft word rescues it ("Excellence" is neither). Verified by removing words one at a time from `Archival Release #45 - Miguel Mears - Cup of Excellence - 2021`; only removing "Cup" changes the rule.
- Passenger `Gaharo Experiments Wet Process`, untyped, no tags. `wet` is not in `LOT_TITLE_WORD`.
- Nothing else. I read every rejected item with a coffee-shaped `product_type` or a `default` rule at all 20 roasters (list in `/tmp/nouveau-audit/detail.json` under `rejected`). Coava's `(Subscription)` and `(Add-On)` rows, Counter Culture's bundles and subscriptions, Intelligentsia's `Hidden` RTD, Verve's `Craft Instant Coffee 6 Pack` sachets, Regalia's Weber gear, Onyx's white-label, Ruby's samplers: all correct rejects.

**False positives (non-lots that get in):**

- Merit channel duplicates, 38 rows (§1.6). `vendor: "Wholesale"` on 26 of them.
- Passenger `Necessary Coffee Pot Tags`, `product_type: "Collateral"`, price $0. Title has "Coffee" so the untyped path says lot. `Collateral` belongs in `NON_LOT_TYPE`.
- Ruby `Quick Release Seasonal Blend` and `Bradbury's Seasonal Blend`, untyped, tag `Wholesale`, description `DOWNLOAD shelf tags ... prepared especially for our friends at Pete's Garage`. Wholesale-only, but the bare `wholesale` tag is deliberately not a wholesale marker (Sweet Bloom, Heart). Narrow rule: untyped **and** bare `Wholesale` tag is wholesale.
- Counter Culture `12oz Year-Round Blends`, tag `hidden`, a collection landing product. A bare `hidden` tag on an otherwise tagless item is a non-lot signal.
- Proud Mary `The Duet`, `vendor: "Onyx Coffee Lab"`, `grams: 172365`, a collab box. Vendor ≠ roaster shows up at 16 of 20 roasters but cannot be a rule: La Colombe uses `vendor` for cafe locations, Regalia for the origin, Sightglass for the producer.
- PT's `John Brown Signature Blend Pour Over Pouch`, Ruby `Creamery Steeped Single Serve Coffee`: single-serve formats typed `Coffee`. Judgement call; I would leave them.

## 8. Schedule

Today: `cadenceMinutes: 60` everywhere, `tick` every 5 minutes, so detection latency is uniformly 0 to 65 minutes, mean ~32. The spec said ~15.

What the dev `dropEvents` say about when drops happen (Pacific time, `new` + `back_in_stock`, ~2 weeks of data, so indicative not conclusive):

| roaster        | detections | when                                    |
| -------------- | ---------- | --------------------------------------- |
| proud mary     | 99         | Wed 11:00 to 15:00                      |
| verve          | 62         | Fri 07:00 (60 of 62 in one hour)        |
| pt's           | 45         | Fri 07:00, Thu 15:00                    |
| onyx           | 28         | Thu 11:00 to 12:00, scattered otherwise |
| passenger      | 28         | scattered (html mode, unreliable)       |
| ruby           | 24         | Wed 07:00 to 08:00                      |
| sey            | 16         | Wed 16:00 to 19:00                      |
| intelligentsia | 12         | scattered                               |
| merit          | 10         | Fri 10:00                               |
| blossom        | 8          | Tue 11:00, Thu 12:00                    |
| others         | ≤6 each    |                                         |

Drop-culture roasters release in one-hour windows on a fixed weekday. A 60-minute cadence lands anywhere in that hour; at Verve the crawl caught all 60 at 07:xx, which was luck of alignment. The handoff's list (Onyx, Sey, Regalia, Blossom, Proud Mary, Passenger) is half right by this data: Verve, PT's and Ruby are the sharpest droppers on dev; Regalia and Blossom barely move.

Cost of going faster. Feed fetches are plain HTTP against Shopify; 20 feeds are 18.7 MB per full cycle, and Shopify's storefront endpoints have not rate-limited the hourly crawl. At 15 minutes for six roasters and 60 for the rest, that is 6×96 + 14×24 = 912 crawls/day instead of 480. Convex function calls and bandwidth scale the same way; still small. `rawCaptures` is the thing that grows: 11 of 20 page-1 bodies are under the 512 KB cap and get stored, 2.9 MB per cycle, so ~69 MB/day today, ~277 MB/day if everything went to 15 minutes, ~830 MB retained over 3 days. Storing only captures whose extraction failed (the diagnostic they exist for) plus one success per day per roaster would cut that to a few MB and make cadence a non-issue for storage.

Proposal, as a table to seed into `crawlSources.cadenceMinutes` (the column exists; only the default is used):

| cadence | roasters | reason |
| --- | --- | --- |
| 15 | proud mary, verve, pt's, onyx, ruby, sey, passenger | sharp weekly drop windows on dev, or the demo names them |
| 30 | intelligentsia, merit, blossom, regalia, madcap, counter culture | moderate movement |
| 60 | the other 7 | catalog barely changes |

A "drop window" cadence (faster during a roaster's historical hour) is a nice second step: a `dropWindows: [{ weekday, hourStart, hourEnd }]` column, learned from `dropEvents` by a weekly job. Not for this week.

`sweepStale` uses `max(2 × cadence, 60 min)`, so a 15-minute source flips to stale after an hour of silence, which is the right bar.

## 9. User-started scrapes ("Check now"), design

Same code path as the scheduler; the only new thing is who asks and how often.

- **Backend.** `crawlNow` internal mutation (operator, no quota): if the source has no crawl in flight (`nextCrawlDueAt` is in the future by less than cadence means the tick claimed it; simpler: add `runningSince?: number` set by `crawlSource` and cleared by `finalizeCrawl`), set `nextCrawlDueAt = now` and schedule `internal.crawler.crawlSource` directly. `requestCheck` public mutation: `requireIdentity`, then `@convex-dev/rate-limiter` with two limits, `checkNow:user` (token bucket, 3 per 10 minutes) and `checkNow:source` (fixed window, 1 per 2 minutes per source key), then the same body as `crawlNow`. If the source's `lastSuccessAt` is younger than 2 minutes, return `{ status: "fresh", lastSuccessAt }` without crawling.
- **Signed-in only.** Yes. The per-user limit needs an identity, and an anonymous button is a free DoS on Onyx at noon Friday.
- **Fires events and emails like any crawl.** Yes. `isBaseline` is decided by `lastSuccessAt === undefined` and nothing else changes. A check is a check.
- **50 users at once.** The per-source window makes them share one crawl: the first request starts it, the other 49 get `{ status: "running" }` and the status chip flips to "checking…" for everyone because `crawlSources` is reactive. Nobody needs a subscription mechanism beyond the existing query.
- **UI.** A small "Check now" beside the status chip on `/roasters/$slug`. States from the source row: `checking…` while `runningSince` is set, `checked 40 seconds ago` from `lastSuccessAt`, `try again in 1:40` from the rate-limit response. The watches page can reuse it per row later.
- **Tests.** convex-test: second request within the window does not schedule a second crawl; anonymous request throws; `crawlNow` bypasses the limiter; a running source is not double-started.

## 10. Ranked defect list, with fixtures

Each fixture is copied from the live feed on 2026-09-15.

**D1. `grams` from shipping weight.** `eastpole`, "Cipres": variants `12 oz.` → 397, `2 lb.` → 1134, `5 lb.` → 2722. `blossomcoffeeroasters`, "Rwanda - Rulindo Murambi - Washed": `12oz` → 0, `1lb` → 0, `2lb` → 0. `seycoffee`, "2023 La Familia Morales Rivera": `125g` → 454. `sightglasscoffee`, "Costa Rica, Aquiares Estate Red Honey": `2lb / Whole Bean` → 340. `vervecoffee`, "Long Play Decaf": `10 OZ / Whole Bean` → 340. `proudmarycoffee`: `250gms / Whole Bean` (note `gms`). Parse order: `kg`, `lb|lbs|pound`, `oz`, `g|gm|gms|gr|grams`; take the first size token in the variant name or any option value; fall back to Shopify `grams` when none.

**D2. Passenger on `www.`** `curl -s -o /dev/null -w '%{http_code}' https://drinkpassenger.com/products.json` → 404; same on `https://www.drinkpassenger.com/products.json` → 200 with `{"products":[{"id":8991332073662,"title":"Red Jasmine - 2026",...`. Three pages (250, 250, 65).

**D3. `roasterNotes` clause swallow.** `drinkpassenger`, "Necessary Dark Roast", body: `With comforting flavors of bittersweet chocolate and graham cracker, this classic Dark Roast tastes great on its own or with the addition of cream and sugar.` Stored: the whole tail. Expected: `bittersweet chocolate and graham cracker`. Rule: a descriptor list is `A(, B)*(,? and C)?`; cut at the first `, <function or participle word>` after the conjunction, or at the first comma that follows an `and`-item.

**D4. `we taste` line-bounded.** `blossomcoffeeroasters`, "Dark Side of the Moon", `body_html`: `<p><strong>We taste dark chocolate and stewed blueberries, a perfect balance of refreshing and sweet</strong><span>. 🌑</span></p>`. Stored: `...and sweet . 🌑`. Ruby's dash list must keep working: `We Taste: Cherry Cola - Dried Fig - Brown Sugar - Cocoa Nib\nMedium-light Roast`.

**D5. Bullet-line notes missed.** `meritcoffee`, "Kiamugumo AB", block text starts `Prunes • Fig Danish • Nutmeg\nKiamugumo Factory sits in...`. Stored notes (from a later `notes of`): `Prunes, Fig Danish, and Nutmeg , reflecting the rich character of coffees grown in this region`. Expected: the first line. 51 lots open with a `A • B • C` or `A - B - C` line and have no notes.

**D6. Origin from title, bare tag, `origin__`, vendor.** `stumptowncoffee` "Kenya Karumandi" (no origin tag); `seycoffee` "2026 Demeka Becha - Ethiopia"; `blossomcoffeeroasters` tags `['Bottomless','Coffee','Light roast','Mexico','Natural']`; `counterculturecoffee` tags `['origin__colombia','roastlevel__dark-roast']`; `coavacoffee` tag `El-Salvador`; `regaliacoffee` `vendor: "Huila, Colombia"`. Order: origin tag → `origin__` tag → bare country tag → country in title → country in the first sentence of the body. Blends: store all distinct countries (`origin: string[]` or a joined `Brazil, Honduras`), not the first.

**D7. Process from multiple tags and title.** `proudmarycoffee` "LIMITED | HONDURAS | Benjamin Paz | Geisha | Anaerobic Washed", tags `Process: Anaerobic`, `Process: Washed`; stored `Anaerobic`. `drinkpassenger` "Kerehaklu - Washed Process - 2026", no process tag. `heartroasters` body `Process: Fully washed`. `eastpole` table `PROCESS Washed`.

**D8. Roast level from bare tags and body.** `blossomcoffeeroasters` tag `Light roast`; `sightglasscoffee` tag `Medium Dark`; `rubycoffeeroasters` tag `Light Roast` and body line `Medium-light Roast`; `counterculturecoffee` tag `roastlevel__medium-light-roast`; `lacolombe` body `Roast Level: Medium` and tag `medium roast`. Intelligentsia `Roast Level: Comforting` must still be rejected.

**D9. Passenger Archival Release rejected.** `{"title":"Archival Release #62 - Valdeir Cezati - 2023","product_type":"Archival Release","tags":["Freezer Friday"],"variants":[{"title":"125 g","price":"25.00","available":false}]}`. 35 items. Also `{"title":"Gaharo Experiments Wet Process","product_type":"","tags":[]}`.

**D10. Merit vendor duplicates.** Five "Sugarcane Decaf" rows: ids 768617578540 (`vendor: Ecommerce`), 1870384463916 (`Merit`), 1868654280748 (`Wholesale`, tag `Normal Wholesale`), 7040242188373 (`Wholesale`, tag `Airport`), 6923885215829 (`Wholesale`, tag `tier2`). Add `vendor` to `isWholesale`'s inputs with the same `WHOLESALE_TEXT` test.

**D11. Small classifier leaks.** Passenger `{"title":"Necessary Coffee Pot Tags","product_type":"Collateral","vendor":"Necessary Coffee","tags":[],"variants":[{"price":"0.00"}]}`; Ruby `{"title":"Quick Release Seasonal Blend","product_type":"","tags":["Wholesale"]}`; Counter Culture `{"title":"12oz Year-Round Blends","product_type":"Coffee","tags":["hidden"]}`; Proud Mary `{"title":"The Duet","product_type":"coffee-archive","vendor":"Onyx Coffee Lab","variants":[{"grams":172365}]}`.

**D12. Description noise.** Heart "Colombia Decaf": `Colombia Decaf San Agustín *subject to change at any time FOB cost: $4.78lb / $10.53kg Landed cost at our warehouse: $5.47lb / $12.05kg *FOB cost is the price...`. `UNSUITABLE_PROSE` already drops `$` lines from passages, so this is card-only. Low priority; a per-roaster strip is not worth building. Leave.

**D13. Page facts get cleared by the next feed crawl.** Not a live bug yet (nothing writes page facts to `products`), but the design in §5 must land before crawl-time enrichment does, or the first hourly crawl erases it.

**D14. html-mode `externalId` carries query strings and skips the classifier.** Dev rows: `https://drinkpassenger.com/products/agaro?Size=250%20g`, `https://drinkpassenger.com/products/foundational-subscription` ("Foundational Subscription", a lot on dev). Moot for Passenger after D2; fix before html mode is used for a user-submitted shop.

## 11. Proposed change list, ordered by demo visibility

Each is one commit with tests from the fixtures above. Nothing deploys to prod without the owner; every extractor change is a catalog correction and needs `rebaselineSource` on affected roasters before the next crawl lands.

1. **Passenger to `products_json` on `www.`** (D2, #27). Change the seed and the dev/prod roaster row's `websiteUrl`, flip mode, rebaseline. Also give `shopifyProductsUrl`/`crawlProductsJson` a `www.` retry after an apex 404 so a user-submitted headless shop gets the same treatment. Closes #25 in place of the html-mode plan; `setSourceMode` is still worth its fifteen minutes. Visible: Passenger's 260 lots get copy, images and notes; recommendation eligibility returns.
2. **Bag size from the variant name** (D1, #28). `parseVariantGrams(name, optionValues, shopifyGrams)` in `extraction.ts`. Visible on every result card and in which lots qualify at all (Blossom).
3. **`roasterNotes` fixes** (D3, D4, D5, #29) plus the parked `cutValue` seam from Task 6. Visible on lot pages and cards.
4. **Origin, process, roast level coverage** (D6, D7, D8, #30) with the shape checks from §4 applied to feed values too. Turn `origin` and `process` multi-valued (join with `, ` if a schema change is unwanted this week). Visible on lot page attributes.
5. **Classifier** (D9, D10, D11, #31) with `vendor` as a new input. Visible: Passenger's Freezer Friday lots in the feed; Merit stops tripling cards.
6. **Schema additions** (§5, decided in #32 / ADR-0005): `roasterNotes: string[]` via a migration, `variety`/`region`/`elevation`/`producer`/`productType`, `pageFacts` + `copyFetchedAt`. No visible change alone; unblocks 7.
7. **Crawl-time page enrichment for six roasters** (Onyx, Sey, Intelligentsia, Merit, Counter Culture, Stumptown): on a lot's first sighting only, one json scrape, verifier from §4, write to `pageFacts`. ~120 pages once, then ~100 credits a week. The recommendation path reads `pageFacts` first and scrapes only when empty, so its per-request Firecrawl calls mostly disappear.
8. **Cadence table** (§8, #33) plus `rawCaptures` retention rule (failures + one success per roaster per day). Visible only as faster alerts.
9. **Check now** (§9, #34). Visible, demo-friendly, and the only new UI.
10. **html-mode hygiene** (D14, #35) only if a user-submitted non-Shopify shop is in scope this week.

Items 1 to 5 are the demo-visible batch and each is under a day. 6 and 7 are the "unify" question and get an ADR draft (`adr/0005-one-extraction-pipeline.md`) rather than a decision here.

## 12. What I did not do

- No hand check against the rendered page for `available` beyond six lots.
- No check of prod data (read-only would have been fine, but the dev export answers the same questions and the task said nothing on prod).
- Firecrawl determinism on five pages, not fifty. The pattern (shaped fields stable, prose fields drift) was consistent enough that more runs would cost credits without changing the conclusion.
- Did not measure Shopify rate limits at 15 minutes. Five sequential curl fetches of Sey page 2 returned 200 in 0.15 s each; the storefront endpoint is CDN-cached and has shown no throttling at hourly.
