# PURISH Driver — Scraping Reference

Online beauty retailer built on Shopify. The driver uses a hybrid approach: the Shopify `.json` API for structured product data and the rendered product page HTML for data that Shopify doesn't expose via API (ingredients, labels, availability of unpublished variants, tab-structured description).

## Data Sources

Each `scrapeProduct()` call makes **two HTTP requests** (no browser needed):

| Request | URL | Returns |
|---------|-----|---------|
| Shopify JSON API | `/products/{handle}.json` | Product metadata, variants, images, options, body_html |
| Product page HTML | `/products/{handle}` | Ingredients, labels, variant availability (productJson), tab description |

The page HTML fetch is handled by `fetchProductPageData(handle)`, which extracts multiple pieces of data from a single HTML response.

## Scrape Flow (`scrapeProduct`)

```
1. Parse URL → extract handle + optional ?variant=ID
2. Fetch /products/{handle}.json → ShopifyProduct (name, brand, variants, images, options, body_html)
3. Select variant: match by ?variant= param or fall back to first variant
4. Parse amount/unit from variant title, then from body_html as fallback
5. Extract per-unit price from Shopify unit_price_measurement (if available)
6. fetchProductPageData(handle) → ingredients, labels, availability, tab description
7. Build description from tab structure (fallback: body_html → markdown)
8. Group images by variant (position-based block grouping)
9. Build variant list from productJson (includes unavailable variants)
10. Return ScrapedProductData
```

## Field Extraction Details

### Name, Brand, Brand URL, Category

From the Shopify JSON API:
- **name**: `product.title`
- **brand**: `product.vendor`
- **brandUrl**: constructed as `https://purish.com/collections/{vendor-slug}` where vendor-slug is the vendor name lowercased with spaces replaced by hyphens (e.g. `https://purish.com/collections/essence`). Used to create `source-brands` records during persist.
- **category**: `product.product_type` (single-level, e.g. "Serum & Booster")

### Description

Extracted from the `<tabs-desktop>` custom element in the product page HTML. PURISH's Shopify theme organizes product info into tabs:

```html
<tabs-desktop class="tabs product-template-box">
  <div class="tabs-navbar">
    <button class="tab-navigate">✍🏼 Beschreibung</button>
    <button class="tab-navigate">🌱 Inhaltsstoffe</button>
    <button class="tab-navigate">🙌🏼 Anwendung</button>
    <button class="tab-navigate">❗️Warnhinweise</button>
  </div>
  <div class="tabs-content">
    <div class="tab-item"><!-- tab 1 content --></div>
    <div class="tab-item"><!-- tab 2 content --></div>
    <div class="tab-item"><!-- tab 3 content --></div>
    <div class="tab-item"><!-- tab 4 content --></div>
  </div>
</tabs-desktop>
```

The driver:
1. Extracts tab titles from `<button class="tab-navigate">` elements (text content, stripped of HTML)
2. Splits tab content by `<div ... class="tab-item">` markers
3. Converts each tab's inner HTML to text via `tabContentToText()` (PURISH-specific converter — headings become `###`, lists become `- `, HTML stripped, entities decoded)
4. Merges into a single text: `## Tab Title\n\nTab content` for each tab

All tabs are included — nothing is filtered out. The result contains the full product description, ingredients, application instructions, warnings, etc. in a single text block.

Falls back to `bodyHtmlToMarkdown(body_html)` from the JSON API only if the page has no `<tabs-desktop>` element.

### Ingredients

Extracted from `<span class="metafield-multi_line_text_field">` elements in the page HTML. PURISH's theme renders Shopify metafields in these spans inside the Inhaltsstoffe tab. The driver scans all such spans and picks the first one that looks like an INCI list (4+ commas, 30+ characters).

### Labels

Scraped directly from the product page HTML — **not** from Shopify tags. Two sources, merged and deduplicated:

1. **`<span class="product-tag">`** inside `.porduct-tags-wrap` (note: the typo "porduct" is in the actual HTML) — "free-from" claims:
   - Examples: "Paraben-free", "Sulfate-free", "Dye-free", "Cruelty-free", "Made in the USA"

2. **`<span>` inside `.product-badge-custom` divs** — store badges with SVG icons:
   - Examples: "Bestseller", "Last Chance", "Kostenloser Versand"
   - Badge divs may be conditionally hidden via `class="... hide"` and `data-product-price` — the driver extracts the `<span>` text regardless of visibility

Labels are taken as-is: no filtering, no normalization, no allowlist.

### Price

From the selected Shopify variant:
- **priceCents**: `variant.price` (string like "23.82") → converted to cents (2382)
- **currency**: always "EUR"

### Per-Unit Price

From Shopify's `unit_price_measurement` on the selected variant (rarely populated on PURISH) — contains `reference_value`, `reference_unit`.
When not available, the persist layer's `computePerUnitPrice()` computes a fallback from `price + amount`.

### Amount / Unit

Two-tier fallback:
1. `parseAmountFromVariant()` — regex on `variant.option1` or `variant.title` for patterns like "100 ml", "0.22 g"
2. `parseAmountFromDescription()` — regex on `body_html` for "Size: X unit" or "Größe: X unit" patterns

### Images

From the Shopify JSON API's `product.images` array, grouped by variant using **position-based block grouping** (`getVariantImages()`):

- Images are sorted by `position` field
- Each variant has one "tagged" image (`variant_ids` contains the variant's ID) — this is the hero/start of its block
- Untagged images (`variant_ids: []`) immediately after a tagged image belong to that variant's block
- Images after the last variant's block are shared/product-level images, appended to every variant's gallery
- Block size is estimated from the gap between the first two tagged images

Example: 6 variants × 6 images each + 2 shared = 38 total images. Each variant gets 6 own + 2 shared = 8 images.

Fallback: if no variant tagging exists or the selected variant has no tagged image, all images are returned.

### GTIN / Barcode

From `selectedVariant.barcode` in the Shopify JSON API.

### Variants

The driver uses **productJson from the page HTML** as the primary variant source (includes ALL variants — available + unavailable). The Shopify `.json` API may omit unavailable variants.

- Parses `var productJson = {...}` from the page HTML via bracket-matching
- Falls back to `.json` API variants if productJson yields nothing
- SKU backfill: productJson SKUs may be null; the driver backfills from the `.json` API variant SKUs

Each variant produces:
- `label`: option value (e.g. "100 ml") from the relevant option position
- `value`: full variant URL (`/products/{handle}?variant={id}`)
- `gtin`: barcode from productJson or .json API
- `isSelected`: true for the currently crawled variant
- `availability`: from productJson's `available` boolean
- `sourceArticleNumber`: Shopify variant ID (numeric, used in `?variant=` URLs)

Variant options with `name === "Title"` and single value `"Default Title"` are skipped (Shopify pseudo-option for single-variant products). Duplicate labels within an option are deduplicated.

### Availability

From the embedded `productJson` in the page HTML:
- Per-variant: `productJson.variants[].available` boolean → `Map<variantId, boolean>`
- Product-level: `productJson.available` boolean (fallback when variant-specific data unavailable)

### Rating

From the Yotpo reviews API bottomline (first page response):
- **averageScore**: `bottomline.averageScore` (float, e.g. 4.873418) — stored as-is (0-5 scale) on `source-products.averageRating`
- **totalReview**: `bottomline.totalReview` (integer) — stored on `source-products.ratingCount`

### Reviews (Yotpo)

Fetched from Yotpo storefront API after product data scraping:
- **API**: `api-cdn.yotpo.com/v3/storefront/store/{storeKey}/product/{productId}/reviews`
- **Store key**: `EDc1vj8PTmjuHuo0cUBNf3lXQbrV6sAyTLXRuqBM`
- **Key param**: `productId` = Shopify product ID (from `product.id`)
- **Pagination**: `page=N&perPage=100`, sorted by `date`, `lang=de`
- **Headers**: Origin/Referer from `purish.com`
- **Rating normalization**: Yotpo scores (1-5) are normalized to 0-10 scale (`score * 2`)
- **Failure handling**: wrapped in try/catch — returns empty reviews on failure, never fails the scrape
- **Dedup**: reviews are persisted by `externalId` (Yotpo review ID, globally unique)

### Source Article Number

Shopify variant ID from the selected variant (`String(variant.id)`) — the numeric ID used in `?variant=` URLs, not the SKU.

### Source Product Article Number

Shopify product ID (`String(product.id)`) — stored on `source-products.sourceArticleNumber`. Used as the key for Yotpo review API requests.

## Discovery (`discoverProducts`)

Uses the Shopify collections JSON API:

1. If URL points to a specific collection (`/collections/{handle}`), discover only that collection
2. Otherwise, fetch all collections via `/collections.json?limit=250&page=N`
3. For each collection, paginate through `/collections/{handle}/products.json?limit=250&page=N`
4. Each product yields a `DiscoveredProduct` with: `productUrl` (normalized), `gtin` (first variant barcode), `brandName`, `name`, `category`

Progress is stored as `PurishDiscoveryProgress`: `{ collectionHandles[], currentIndex, currentPage }`.

## Search (`searchProducts`)

Uses the full search page (not the suggest API — suggest doesn't support GTIN searches):

1. Fetch `/search?q={query}&type=product&page=N`
2. Extract `var searchResultsJson = [...]` from the page HTML via bracket-matching
3. Each result yields a `DiscoveredProduct` (same fields as discovery)
4. Paginate until fewer than 24 results (typical page size) or `maxResults` reached

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product (base) | `purish.com/products/{handle}` | `purish.com/products/essence-satin-blend-gel-eyeliner` |
| Product (variant) | `purish.com/products/{handle}?variant={id}` | `purish.com/products/essence-satin-blend-gel-eyeliner?variant=44576251764918` |
| Collection | `purish.com/collections/{handle}` | `purish.com/collections/skincare` |

- `sourceUrl` on source-products: base product URL (no query params), used as dedup key
- `sourceUrl` on source-variants: variant URL with `?variant={id}` query param
- Both are normalized (`normalizeProductUrl` / `normalizeVariantUrl`)

## Key Implementation Details

- **No browser required** — all requests use `stealthFetch()` (HTTP with anti-bot headers)
- **Two type systems for variants**: `ShopifyVariant` (from .json API, has `price`, `sku`, `unit_price_measurement`) vs `PageJsonVariant` (from page HTML productJson, has `available` but may lack `sku`)
- **`tabContentToText()`** is a PURISH-specific HTML-to-text converter, separate from the generic `bodyHtmlToMarkdown()`. It handles the tab content's nested div structure and sub-headings (h4 → `###`)
- **Jittered delays** between requests: `baseMs ± 25%` randomization to avoid rate limiting
