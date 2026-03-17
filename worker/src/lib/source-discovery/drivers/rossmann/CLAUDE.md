# Rossmann Driver — Scraping Reference

German drugstore chain. Playwright-based driver using pure DOM scraping. No API access, no RSC JSON — all data comes from the rendered page.

## Data Sources

Each `scrapeProduct()` call uses **one browser page load**. Data is extracted from DOM elements and embedded data attributes:

| Source | What it provides |
|--------|-----------------|
| DOM elements | Product name, brand, DAN, description, ingredients, price, amount, images, variants, rating |
| Data attributes | GTIN (`data-item-ean`), DAN (`data-jsevent="obj:product__dan"` with `data-value`) |
| Meta tags | Price (`meta[itemprop="price"]`), currency (`meta[itemprop="priceCurrency"]`) |
| BazaarVoice widget | Rating (`.bv_avgRating_component_container`), review count (`.bv_numReviews_component_container`) |
| `window.dataLayer` | Category path (`view_item.items[0].item_category`, slash-separated) |

## Scrape Flow (`scrapeProduct`)

```
1. Launch Playwright browser (stealth-enabled)
2. Navigate to product URL, wait for .rm-product__title
3. Wait for BazaarVoice rating widget to load (async, up to 15s)
4. Single page.evaluate() call that extracts everything from the DOM
5. Post-process outside browser: GTIN fallback from URL, ingredients
6. Close browser, return ScrapedProductData
```

## Field Extraction Details

### Name

From `.rm-product__title` text content.

### Brand, Brand URL

- **Brand name**: from `.rm-product__brand` text content.
- **Brand URL**: from `a.rm-product__brand[href]` — the brand name element is a link. The `href` is a relative path (e.g. `/de/alle-marken/essence/c/online-dachmarke_4455255`), prefixed with `https://www.rossmann.de`. Used to create `source-brands` records during persist.

### Description

From all `h2` elements on the page:
- Each h2 becomes a `## Heading` section
- The first sibling `<div>` after the h2's parent provides the body text (`innerText`)
- All sections merged as `## Heading\n\nBody`

### Ingredients

From `#GRP_INHALTSSTOFFE .rm-cms` text content. This is Rossmann's dedicated ingredients section identified by a fixed element ID. Stored as raw INCI text (parsed during aggregation).

### Labels

Not currently extracted. Rossmann doesn't have an obvious label/badge system that's been mapped.

### Price

From `meta[itemprop="price"]` content attribute (float string → cents).
Currency from `meta[itemprop="priceCurrency"]` content attribute (default "EUR").

### Per-Unit Price

No dedicated per-unit price element on the page. The persist layer's `computePerUnitPrice()` computes it from `price + amount` as a fallback.

### Amount / Unit

From `.rm-product__units` text content. Regex matches leading `N unit` pattern (e.g. "200 ml", "0,5 l").
Decimal commas are converted to dots.

### Images

From `.rm-product__image-main .swiper-slide .rm-product__lens[data-image]`:
- `data-image` attribute provides the full-resolution URL
- Alt text from nested `img[itemprop="image"]`
- Only non-duplicate swiper slides (excludes `.swiper-slide-duplicate`)

### GTIN / Barcode

From `[data-item-ean]` attribute on the page. Falls back to extracting from the URL pattern `/p/{GTIN}`.

### Variants

From `.rm-variations__list`:
- **Dimension**: inferred from CSS class (e.g. `rm-variations__color` → "Color", `rm-variations__size` → "Size"), defaults to "Variant"
- **Options**: from `li.rm-input__option` elements:
  - `label`: link text content
  - `value`: full URL resolved from `a[href]` (relative → absolute)
  - `gtin`: extracted from href pattern `/p/{GTIN}`
  - `isSelected`: `li` has class `active`

**Important**: Rossmann only shows available variants on the page. Disappeared/unavailable variants are not listed. The persist layer handles marking them as unavailable by comparing the scraped variant set against existing DB variants.

### Availability

Not explicitly extracted from the page. Rossmann doesn't show stock/availability status.
The persist layer infers availability: if a variant is present on the page, it's available; if it previously existed but is no longer in the scraped set, it gets marked unavailable.

### Source Article Number (DAN)

From `[data-jsevent="obj:product__dan"]` element's `data-value` attribute.

### Category Breadcrumbs

From `window.dataLayer` (Google Tag Manager):
- Finds the `view_item` event entry
- Extracts `items[0].item_category` (slash-separated string, e.g. "Pflege/Körperpflege/Handcreme")
- Splits into array of path segments

### Rating

From BazaarVoice widgets (loaded asynchronously):
- **Rating value**: `.bv_avgRating_component_container` innerText (float, e.g. "4.3")
- **Review count**: `.bv_numReviews_component_container` innerText (regex extracts digits)

The driver waits up to 15 seconds for the BazaarVoice widget to render before scraping.

### Reviews (BazaarVoice)

Fetched from BazaarVoice API after DOM scraping (outside browser context):
- **API**: `apps.bazaarvoice.com/bfd/v1/clients/rossmann-de/api-products/cv2/resources/data/reviews.json`
- **Auth**: `bv-bfd-token: 16671,main_site,de_DE` header + rossmann.de origin/referer
- **Key param**: `filter=productid:eq:{GTIN}` — keyed by GTIN (not DAN like DM)
- **Extra params**: `apiversion=5.5`, `displaycode=16671-de_de`, `resource=reviews`, `action=REVIEWS_N_STATS`, content locale filter for DE/AT/CH variants, `isratingsonly:eq:false` to exclude rating-only entries
- **Pagination**: `limit=100`, paginated with `offset`, sorted by `submissiontime:desc`
- **Rating normalization**: BazaarVoice ratings (1-5 stars) are normalized to 0-10 scale (`rating * 2`)
- **Failure handling**: wrapped in try/catch — returns `[]` on failure, never fails the scrape
- **Dedup**: reviews are persisted by `externalId` (BazaarVoice review ID, globally unique)

## Discovery (`discoverProducts`)

Playwright-based BFS category tree traversal:

1. Start from the given URL (e.g. `rossmann.de/de/pflege/c/pflege`)
2. Navigate to page, wait for product cards or category nav
3. **Leaf detection**: any link in `nav[data-testid="category-nav-desktop"]` has class `font-bold`
4. **Leaf pages**: scrape product cards (`[data-testid="product-card"]`), then paginate via `?pageIndex=N` (0-based, page numbers from `a[data-testid^="search-page-"]`)
5. **Non-leaf pages**: extract child category links from the nav and add to BFS queue

Product cards provide rich data from data attributes:
- `data-item-ean` → GTIN
- `data-item-name` → product name
- `data-item-brand` → brand name
- Product URL from `figure[data-testid="product-image"] a[href]`
- Rating from filled star SVGs (`svg.text-red`), with partial star support via `[style*="width"]` percentage
- Rating count from last `span` in ratings container

Category breadcrumbs built from URL path (e.g. `/de/pflege/koerperpflege/c/...` → "Pflege -> Koerperpflege").

Progress stored as `RossmannProductDiscoveryProgress`: `{ queue[], visitedUrls[], currentLeaf? }`.

## Search (`searchProducts`)

Playwright-based browser scraping:

1. Navigate to `rossmann.de/de/search?text={query}`
2. Wait for product cards or no-results indicator
3. Scrape product cards (same `[data-testid="product-card"]` elements as discovery)
4. Paginate via `?pageIndex=N` (0-based) until `maxResults` reached or no more pages

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product page | `www.rossmann.de/de/{slug}/p/{GTIN}` | `www.rossmann.de/de/pflege-alverde-tagescreme/p/4058172936791` |
| Category page | `www.rossmann.de/de/{path}/c/{slug}` | `www.rossmann.de/de/pflege/koerperpflege/c/koerperpflege` |
| Search page | `www.rossmann.de/de/search?text={query}` | `www.rossmann.de/de/search?text=tagescreme` |

- `sourceUrl` on source-products: product page URL (normalized, used as dedup key)
- `sourceUrl` on source-variants: same as source-products URL (Rossmann product URL = variant URL; variants are essentially separate product pages linked via the variant list)
- Both normalized via `normalizeProductUrl()`

## Key Implementation Details

- **Browser required** — uses `playwright-extra` with stealth plugin via `launchBrowser()`
- **No bot check handling** — unlike Mueller, Rossmann doesn't use Cloudflare bot verification (as of current implementation)
- **BazaarVoice async loading** — rating data loads via a third-party widget after initial page render. The driver waits up to 15 seconds for `.bv_avgRating_component_container` to appear
- **Only available variants shown** — Rossmann pages only list variants that are currently available. The persist layer detects disappeared variants by comparing the scraped set against existing DB records and marks missing ones as unavailable
- **GTIN in URL** — Rossmann embeds the GTIN directly in the product URL path (`/p/{GTIN}`), making it extractable even when `data-item-ean` is missing
- **Partial star ratings** — Discovery cards support fractional ratings via CSS `width` percentage on the last star container (e.g. `width: 50%` = half star)
- **No labels, no per-unit price element** — Rossmann doesn't provide these in an easily extractable format. Per-unit price is computed by the persist layer from price + amount
- **Random delays** between page navigations: `randomDelay(1000, 2000)` ms for search, `jitteredDelay(baseMs)` for discovery
