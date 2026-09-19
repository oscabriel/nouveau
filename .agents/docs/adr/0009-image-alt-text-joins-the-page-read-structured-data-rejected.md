# Labelled image alt text joins the page read; JSON-LD, the SEO description and the product JSON are rejected as page sources

Decided 2026-09-18 (owner asked for the design; agent proposed it from a survey of every roaster). Extends ADR-0008, which reads a thin lot's page as block text. The handoff after ADR-0008 named four structured sources the read never sees (Shopify's per-product JSON, JSON-LD, `og:description`, image `alt`) and asked whether any of them closes the remaining gap. This record is the answer, with the evidence.

## Evidence (2026-09-18, one current coffee per roaster, all 20 crawl sources)

Every crawl source is a Shopify `products_json` feed. For each roaster the feed entry, the page, and the per-product JSON (`/products/<handle>.json`) were compared.

- **The per-product JSON is the feed entry plus `images[].alt`.** Its `body_html`, `tags`, `variants` and `options` are the same document the crawl already parsed. The storefront feed (`/products.json`) omits `alt` from its image objects; the per-product endpoint includes it. So the only fact the endpoint adds is the alt text, and the page's own `<img alt>` attributes carry the same strings.
- **JSON-LD `Product.description` equals `body_html`** on every page that carries one (East Pole, Counter Culture, Sweet Bloom, Stumptown, Sightglass, Verve, Blossom) or is the shop's SEO description (Madcap, Proud Mary, Heart). Nine roasters serve no JSON-LD product at all.
- **`og:description` is Shopify's SEO description field**, which is not in the feed and is not rendered on the page. On two of nineteen pages it described another coffee: Sightglass's Costa Rica Aquiares page carried "Limited release from Gatina washing station in Kenya's Nyeri county", and Stumptown's Kenya Karumandi page carried "notes of sparkling peach and sweet cranberry" while the rendered flavor profile says red currant, blackberry and dark chocolate. Sey's is site-wide boilerplate. Where it did name the coffee's notes (PT's), the same notes were already in the page text.
- **Image alt text is where Verve keeps the whole spec line.** Verve's product image alt reads "Verve Coffee Roasters - Jose Martinez - 12oz - Single Origin - Huila, Colombia - Process: Washed - Variety: Pink Bourbon - Tasting Notes: Pear, Nectarine, Brown Sugar - Layered Elegance - Latin America - Seasonal - Direct Trade - Light Roast - Whole Bean Coffee". The rendered page text has no notes at all, so ADR-0008's read finds none. On dev, 20 of Verve's 115 current lots have notes. No other roaster's page carried a labelled alt.
- **Sey's page is readable after all.** The www-host fix in ADR-0008's amendment made the plain fetch accept Sey's redirect; the page text is 2,300 characters and carries the "we find" line and the labelled Varietal, Region, Altitude and Processing blocks. The client-render premise for a product-JSON path is gone.
- **Passenger's page is a script shell** (no `<main>`, under 200 characters of text) and serves no JSON-LD or `og:description`. Nothing structured helps it; the Firecrawl fallback stays.

## Decision

- **Labelled alt text joins the page text.** `pageTextFromHtml` collects the `alt` attribute of every `<img>` in the reduced HTML (chrome, upsell blocks and menus already cut, so a related-product image's alt is never seen), splits each on the dash and pipe separators themes use, and keeps only the segments shaped `Label: value` whose label the page router already reads (process, variety, region, elevation, producer, roast, notes). Those lines are placed after the theme-notes line and before the page text, so they lead the candidates. An unlabelled segment ("Layered Elegance", "Menu - Best Sellers - Sermon, Streetlevel") is dropped and can never become a note candidate. The lines are capped (`MAX_ALT_LINES`) and deduplicated.
- **Nothing else is read.** JSON-LD, `og:description` and the meta description are not page sources: they duplicate the feed or, twice in nineteen, another coffee's copy, and they are not on the page a viewer reads. The per-product JSON is not fetched: it would be a second request per lot for the alt text the page already carries.
- **The feed path does not change.** The storefront feed omits alt, so there is nothing new to read at crawl time.
- **Jev still verifies every candidate**, and the alt lines are part of the state it sees, the same as the theme-notes line.

## Consequences

- Verve's lots get process, variety, notes and roast level on their next page read, no credit spent. On dev that is roughly 95 lots, at 25 per crawl.
- A theme whose product image alt is a marketing sentence adds nothing: no labelled segment, no line.
- A theme that labels another product's image inside a block the read does not recognise as upsell would lead the candidates with that coffee's facts. The guard is the same as ADR-0008's: the block cut first, then Jev's per-note question, which now names the coffee (ADR-0008, second amendment).
- The per-product JSON stays available as a future source for a `product_pages` or WooCommerce lot whose page alt text carries facts the page text does not. None exists today.
