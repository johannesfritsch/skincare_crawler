# DM Driver — Scraping Reference

German drugstore chain (dm-drogerie markt). Fully API-based driver — no browser required. All requests use `stealthFetch()` with a `Referer: https://www.dm.de/` header.

## Data Sources

Each `scrapeProduct()` call makes **three API requests + one browser page load** (hybrid approach):

| Request | URL | Returns |
|---------|-----|---------|
| Product detail API | `products.dm.de/product/products/detail/DE/gtin/{gtin}` | Full product data (name, brand with image, price, description, images, variants, pills/labels, breadcrumbs) |
| Availability API | `products.dm.de/availability/api/v1/tiles/DE/{dan1},{dan2},...` | Per-DAN availability (`isPurchasable` boolean) |
| BazaarVoice reviews API | `apps.bazaarvoice.com/bfd/v1/clients/dm-de/api-products/cv2/resources/data/reviews.json?filter=productid:eq:{dan}` | Individual reviews (rating, text, reviewer info) |
| Browser page load | `www.dm.de{canonicalPath}` (via Playwright) | Brand page URL (from rendered `h1 > span > a` link) |

The GTIN is extracted from the product URL pattern: `/produkt-name-p{GTIN}.html`.

## Scrape Flow (`scrapeProduct`)

```
1. Extract GTIN from URL (regex: /-p(\d+)\.html/)
2. Fetch product detail API → DmProductDetail
3. Extract name, brand (with image URL), description, ingredients, price, images, labels, variants
4. Collect all DANs (product + variant DANs)
5. Batch-fetch availability for all DANs
6. Assign availability to product and each variant option
7. Launch Playwright browser → navigate to product page → extract brand URL from rendered h1 > span > a
8. Return ScrapedProductData
```

## Field Extraction Details

### Name, Brand, Brand URL

From the product detail API:
- **name**: `data.title.headline`
- **brand**: `data.brand.name`

**Brand URL**: extracted from the rendered product page via Playwright. DM product pages are SPAs — `stealthFetch` only returns the shell HTML, so a browser is required. The brand link is in `h1[data-dmid="detail-page-headline-product-title"] span:first-child a[href]` and uses a search URL pattern: `/search?query={brand}&brandName={brand}&searchType=brand-search`. Prefixed with `https://www.dm.de`. Wrapped in try/catch — failure does not fail the scrape.

**Brand Image**: from the API response `data.brand.image.src` — a static CDN URL for the brand logo.

### Description

From `data.descriptionGroups[]` — an array of section groups, each with a `header` and `contentBlock[]`. Converted to markdown via `descriptionGroupsToMarkdown()`:
- Each group becomes `## {header}` + content
- Content blocks can contain `bulletpoints` (→ `- item`), `texts` (→ plain paragraphs), or `descriptionList` (→ `**title:** description`)
- All groups are included — description, application, ingredients, warnings, etc.

### Ingredients

Extracted from the description group with `header === 'Inhaltsstoffe'`:
- Pulls the `texts[]` from `contentBlock[]` and joins them
- Stored as raw INCI text (parsed during aggregation)

### Labels

From `data.pills[]` — an array of strings. Taken directly as-is.
- Examples: "Neu", "dm-Marke", "Limitiert", "Bestseller"

### Price

From `data.metadata.price` (float, e.g. `14.95`) → converted to cents.
Currency from `data.metadata.currency` (default "EUR").

### Per-Unit Price

Parsed from `data.price.infos[]` via `parsePerUnitPrice()`. Entries look like:
- `"0,3 l (2,17 € je 1 l)"`
- Regex extracts: amount in €, quantity, unit

When the API string doesn't match the regex (returns `null`), the persist layer's `computePerUnitPrice()` computes a fallback from `price + amount`.

### Amount / Unit

Parsed from `data.price.infos[]` via `parseProductAmount()`. Entries look like:
- `"0,055 l (271,82 € je 1 l)"`
- Extracts the leading amount + unit
- Normalizes sub-unit amounts: `0.055 l` → `55 ml`, `0.25 kg` → `250 g`

### Images

From `data.images[]` — uses `zoomSrc` (highest resolution) for URL, `alt` for alt text.
Images without `zoomSrc` are filtered out.

### GTIN / Barcode

From `data.gtin` (number) in the API response. Converted to string.

### Variants

From `data.variants.colors[]` — each group has:
- `heading`: dimension name (e.g. "Color"), defaults to "Color" if missing
- `options[]`: each with `label`/`colorLabel`, `href` (relative path → full URL), `gtin`, `isSelected`, `dan`

Variant URLs are constructed from `opt.href` prefixed with `https://www.dm.de`.
Each variant option gets a `sourceArticleNumber` from its DAN.

### Availability

From the DM availability API (`/availability/api/v1/tiles/DE/{dans}`):
- Takes comma-separated list of DANs
- Returns `{ [dan]: { isPurchasable: boolean, rows?: [...] } }`
- `isPurchasable` → `available` / `unavailable`
- Applied to both the top-level product and each variant option

### Source Article Number (DAN)

From `data.dan` (number). The DAN (Drogerieartikelnummer) is DM's internal article number.
Also extracted per-variant from `opt.dan` in the variants data.

### Category Breadcrumbs

From `data.breadcrumbs[]` — array of strings (e.g. `["Pflege", "Körperpflege", "Handcreme"]`).

### Canonical URL

Built from `data.self` (relative path from API response) → `https://www.dm.de{self}`, normalized.
Falls back to the input `sourceUrl`.

### Reviews (BazaarVoice)

Fetched from BazaarVoice API after the main product scrape:
- **API**: `apps.bazaarvoice.com/bfd/v1/clients/dm-de/api-products/cv2/resources/data/reviews.json`
- **Auth**: `bv-bfd-token: 18357,main_site,de_DE` header + dm.de origin/referer
- **Key params**: `apiVersion=5.4` (required), `filter=productid:eq:{DAN}` — keyed by DM article number (DAN), not GTIN
- **Pagination**: `limit=100`, `offset=0`, sorted by `submissiontime:desc`. Single request captures most products.
- **Response**: `Results[]` array of review objects with `Id`, `Rating`, `Title`, `ReviewText`, `UserNickname`, `SubmissionTime`, `IsRecommended`, `TotalPositiveFeedbackCount`, `TotalNegativeFeedbackCount`, `ContextDataValues` (contains `Age.Value`, `Gender.Value`)
- **Failure handling**: wrapped in try/catch — returns `[]` on failure, never fails the scrape
- **Rating normalization**: BazaarVoice ratings (1-5 stars) are normalized to 0-10 scale (`rating * 2`) before persistence. All source-reviews use a unified 0-10 scale regardless of source store.
- **Dedup**: reviews are persisted by `externalId` (BazaarVoice review ID, globally unique)

## Discovery (`discoverProducts`)

API-based category tree traversal:

1. Fetch nav tree from `content.services.dmtech.com/rootpage-dm-shop-de-de?view=navigation`
2. Find the subtree matching the target URL path (e.g. `/make-up/augen`)
3. Collect all leaf categories (nodes with no children, not hidden)
4. For each leaf:
   a. Resolve `categoryId` via content page API (`content.services.dmtech.com/rootpage-dm-shop-de-de{link}?view=category`) — extracts `allCategories.id` from `DMSearchProductGrid` entry
   b. Paginate through products via search API (`product-search.services.dmtech.com/de/search/static?allCategories.id={id}&pageSize=60&currentPage={page}`)
5. Each product yields a `DiscoveredProduct` with: `productUrl` (from `tileData.self` or GTIN fallback), `gtin`, `brandName`, `name`, `rating`, `ratingCount`, `category` (breadcrumb from nav tree), `categoryUrl`

Progress is stored as `DmProductDiscoveryProgress`: `{ categoryLeaves[], currentLeafIndex, currentProductPage, totalProductPages }`.

### Search API Headers

The product search API requires specific headers:
- `Referer: https://www.dm.de/`
- `x-dm-product-search-tags`: static tag string
- `x-dm-product-search-token`: random 14-digit numeric ID (generated once per worker process)

## Search (`searchProducts`)

Uses the product search API directly:

1. Fetch `product-search.services.dmtech.com/de/search?query={query}&pageSize=60&currentPage={page}`
2. Same product extraction as discovery
3. Paginate until `maxResults` reached or no more pages

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product page | `www.dm.de/produktname-p{GTIN}.html` | `www.dm.de/alverde-naturkosmetik-tagescreme-p4058172936791.html` |
| Product API | `products.dm.de/product/products/detail/DE/gtin/{GTIN}` | `products.dm.de/product/products/detail/DE/gtin/4058172936791` |
| Category page | `www.dm.de/pflege/koerperpflege` | `www.dm.de/make-up/augen` |

- `sourceUrl` on source-products: product page URL (normalized, used as dedup key)
- `sourceUrl` on source-variants: same as source-products URL (DM product URL = variant URL, since variants are separate products with separate GTINs/DANs)
- Both normalized via `normalizeProductUrl()`

## Key Implementation Details

- **Hybrid approach** — API requests use `stealthFetch()` (HTTP with `Referer` header), brand URL extraction uses Playwright (DM product pages are SPAs that require JS rendering)
- **DAN (Drogerieartikelnummer)** is DM's internal article number, distinct from GTIN. Used for availability lookups and variant identification
- **Color variants on DM are separate products** — each color has its own GTIN, DAN, and product page URL. The `variants.colors[].options[].href` points to a different product page
- **Jittered delays** between API requests: `baseMs ± 25%` randomization
- **Per-process search token**: the `x-dm-product-search-token` header uses a random numeric ID generated once when the worker process starts, staying consistent across all search requests within a session
