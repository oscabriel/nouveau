# Shopify /products.json as the primary extraction target

Nouveau's crawler needs product name, price, size, and stock status from roaster shops. The seed-list research (issue #3) found every seed roaster runs Shopify, which exposes a paginated `products.json` endpoint with those fields as clean structured data per variant. We decided the crawler reads `/products.json` as the primary source and falls back to HTML grid parsing only for what the JSON lacks (sold-out badges, marketing copy).

Considered alternatives: full HTML scraping with structured extraction (Firecrawl), which gets badges and copy but is slower, costlier in Firecrawl credits, and brittle against roaster redesigns; or per-roaster custom parsers, which don't scale to user-submitted shops. `/products.json` wins on reliability — the property the product's reputation depends on — with the HTML pass as an enrichment, not a dependency.

Consequences: extraction quality no longer depends on page rendering, so the 15-minute detection bar and degraded-alert path apply mainly to non-Shopify user-submitted sources. Shops that leave Shopify or render products.json empty are flagged crawl-failed and fall back to HTML mode.
