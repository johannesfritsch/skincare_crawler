# Douglas Driver — Scraping Reference

German beauty/perfume retailer. The driver uses a **Playwright-based hybrid approach** — Douglas.de uses Akamai bot management which requires a real browser session. Product data comes from two sources: the search API (structured data) and the product page DOM (ingredients, variant codes).

## Data Sources

Each `scrapeProduct()` call uses **up to three navigations**:

| Step | URL | Returns |
|------|-----|---------|
| 1. Homepage + Search API | `douglas.de/de` then `fetch(/jsapi/v2/products/search?query={code})` | Structured product data: name, brand, price, images, rating, description, amount, per-unit price, availability, flags, ean (GTIN) |
| 2. Product page DOM | `douglas.de/de/p/{baseProduct}?variant={code}` | INCI ingredients (from body text), variant codes (from `data-code` attributes), breadcrumbs, availability status |
| 3. Homepage (again) + Search API per variant | `douglas.de/de` then `fetch(/jsapi/v2/products/search?query={variantCode})` per sibling | EAN/GTIN for each sibling variant (only when there are sibling variants whose GTINs are not yet known) |

**Why multiple steps?** The search API only works from the homepage context — Akamai's sensor intercepts `fetch()` and `XMLHttpRequest` on product pages. The product page DOM provides ingredients and variant codes that the search API doesn't return. Step 3 navigates back to the homepage to fetch GTINs for sibling variants discovered from the DOM.

**No product detail API exists** — Douglas does not expose a `/jsapi/v2/products/{code}` endpoint. The search API is the only structured data source.

## Search API

### Endpoint

`/jsapi/v2/products/search?fields=FULL&query={query}&pageSize={pageSize}&currentPage={page}`

Same-origin JSON endpoint. Requires Akamai session cookies (obtained by navigating to `douglas.de/de` first). Plain HTTP requests without cookies return `400 Bad Request`.

### Response Shape

```json
{
  "products": [{
    "code": "1166241",            // variant code
    "name": "Nr. 100",            // variant name (shade/size)
    "url": "/de/p/5011358006?variant=1166241",
    "description": "<h2>essence Skin Tint...</h2><p>...</p>",
    "baseProduct": "5011358006",  // product code (shared across variants)
    "baseProductName": "SKIN Tint",
    "brand": { "code": "b5590", "name": "Essence" },
    "averageRating": 4.4,         // 0-5 scale
    "numberOfReviews": 234,
    "price": {
      "currencyIso": "EUR",
      "value": 3.19,
      "originalValue": 3.99,
      "discountPercentage": 20.05
    },
    "baseContentPrice": { "value": 106.33 },
    "numberContentUnits": 30,
    "contentUnit": "ml",
    "baseNumberContentUnits": 1,
    "contentUnitOfBaseNumberContentUnits": "l",
    "images": [{ "url": "https://media.douglas.de/medias/..." }],
    "classifications": [{ "name": "Foundation" }],
    "productFamily": { "code": "foundation", "name": "Foundation" },
    "stock": { "stockLevelStatus": "inStock" },
    "flags": [{ "code": "discountFlag" }],
    "availability": { "code": "AVAILABLE" },
    "availableColorsAmount": 12,
    "ean": "4059729447586"
  }],
  "pagination": { "pageSize": 48, "currentPage": 0, "totalPages": 1, "totalResults": 1 }
}
```

Key observations:
- Returns **variant-level** results — same `baseProduct` may appear multiple times (one per shade)
- `baseProduct` is the product code; `code` is the variant code
- Rating is 0-5 scale (Douglas stores as-is; normalization happens during persist)
- `numberContentUnits` + `contentUnit` give the product amount (e.g. 30 ml)
- `baseContentPrice` gives per-unit price (e.g. 106.33 €/l)
- `description` contains HTML (converted to text by the driver via `htmlToText()`)
- `ean` field contains the EAN/GTIN for the variant (e.g. "4059729447586") — used to extract GTINs
- `keywordRedirectUrl` field present when searching by GTIN — direct product URL
- Search by base product code (e.g. "5011358006") or variant code (e.g. "1166241") both work

## Scrape Flow (`scrapeProduct`)

```
1. Parse URL → extract baseProduct code + optional ?variant= code
2. Launch browser → navigate to douglas.de/de (homepage)
3. Wait 2-3s for Akamai cookies to settle
4. Call search API via page.evaluate(fetch) → query by variant code (or base product code)
5. Extract structured data: name, brand, price, images, rating, description, availability, flags, amount, ean
6. Navigate to product page → /de/p/{baseProduct}?variant={code}
7. Wait 3-5s for render, scroll down to trigger lazy content
8. Extract from DOM: INCI ingredients, variant codes, breadcrumbs, availability
9. Fetch GTINs for sibling variants: navigate back to homepage, call search API per variant code to get ean
10. Combine search API + DOM data → return ScrapedProductData
```

## Field Extraction Details

### Name, Brand, Brand URL

- **name**: search API `baseProductName` (fallback: DOM `h1`)
- **brand**: search API `brand.name`
- **brandUrl**: constructed from `brand.code` + `brand.name` → `https://www.douglas.de/de/b/{slug}/{code}`

### Description

From search API `description` field (HTML). Converted to plain text via `htmlToText()` which:
- Converts `<br>`, `</p>`, `</h*>` to newlines
- Converts `<li>` to `- ` list items
- Strips all other HTML tags
- Decodes HTML entities (`&nbsp;`, `&amp;`, `&bdquo;`, `&ldquo;`, etc.)

### Ingredients

Extracted from the product page `document.body.innerText`. Searches for the first occurrence of `"AQUA"` (standard INCI list opening) and captures text until the next period-followed-by-newline. This works because Douglas renders the INCI list as a continuous block in the page text, after the description and usage sections.

Not all products have INCI ingredients (e.g. perfumes). The driver returns `undefined` if no AQUA is found.

### Price

From search API:
- **priceCents**: `price.value` × 100 (e.g. 3.19 → 319)
- **currency**: `price.currencyIso` (default "EUR")

### Per-Unit Price

From search API:
- **perUnitAmount**: `baseContentPrice.value` (e.g. 106.33 = €106.33/l)
- **perUnitQuantity**: `baseNumberContentUnits` (e.g. 1)
- **perUnitUnit**: `contentUnitOfBaseNumberContentUnits` (e.g. "l")

### Amount / Unit

From search API:
- **amount**: `numberContentUnits` (e.g. 30)
- **amountUnit**: `contentUnit` (e.g. "ml")

### Images

From search API `images[]` array. The `&grid=true` param is stripped from URLs to get full-size images. Fallback to DOM carousel images if the API returns none.

### Variants

Douglas has **two variant UI types** depending on the product. The driver tries color swatches first, then falls back to size radio buttons.

#### Color variants (swatches)

Extracted from `<li>` elements with `data-testid="variant-blobs-scrollable-blob"`:
- **code**: `data-code` attribute (e.g. "1166215") — the Douglas variant code used in `?variant=` URLs
- **label**: `aria-label` attribute with trailing badge text stripped (e.g. "Nr. 100. DEAL" → "Nr. 100")
- **isSelected**: `aria-selected="true"` attribute OR matching the `?variant=` code from the URL
- **dimension**: "Farbe"

Douglas renders variant swatches twice (mobile + desktop) — the driver deduplicates by `data-code`.

#### Size variants (radio buttons)

Used for products with size/volume options (e.g. perfumes: 30 ml, 50 ml, 90 ml). Only extracted when no color swatches are found.

The radio input and the variant content are in **sibling spans** inside a shared `<label>` under `[data-testid="RadioButton"]`:

```
div[data-testid="RadioButton"]
  label
    span → input[name="sizeVariants" value="1273971"]
    span → div[data-testid="size-variants-radio"]
             div[data-testid="variant-name"]  →  "30 ml"
```

Extraction: query `input[name="sizeVariants"]`, then `.closest('[data-testid="RadioButton"]')` to find the common ancestor, then `querySelector('[data-testid="variant-name"]')` for the label.

- **code**: radio input `value` attribute (e.g. "1273971")
- **label**: `[data-testid="variant-name"]` text content (e.g. "30 ml")
- **isSelected**: `input.checked` property
- **dimension**: "Größe"

No `data-code` attributes — the variant code is in the radio button's `value`.

#### Shared

Variant URLs are constructed as: `https://www.douglas.de/de/p/{baseProduct}?variant={code}`

**GTINs come from two sources** (search API `ean` field, with React state fallback):

1. **Search API** (primary): The initial search API call returns `ean` for some products. For sibling variants, the driver navigates back to the homepage and makes one search API call per variant code.
2. **React product state** (fallback): Not all products have EANs in the search API (e.g. perfumes with size variants). The decoded `__INITIAL_DATA_CACHE__` is accessible via the React fiber tree on the product page as `memoizedProps.product.ean`. This gives the EAN for the currently selected variant only. The driver walks the fiber tree from the `<h1>` element to find this. Sibling variants get their EANs when crawled individually.

GTINs are set on both the top-level `gtin` field (for the crawled variant) and on each variant option's `gtin` field.

### Labels

From search API `flags[]` array — each flag has a `code` field (e.g. "discountFlag", "newFlag").

### Rating

From search API:
- **averageRating**: 0-5 scale (stored as-is)
- **numberOfReviews**: review count

### Availability

Two sources, combined:
- Search API: `stock.stockLevelStatus` — "inStock" / "outOfStock"
- DOM: `[data-testid="availability-online-stock-status"]` text — "Online: auf Lager"

### Category Breadcrumbs

From DOM `[data-testid="breadcrumb-name"]` elements. Douglas renders breadcrumbs twice (mobile + desktop) — the driver deduplicates and strips "Homepage" and the product name (last element). Example: `["Make-up", "Teint", "Foundation"]`.

### Source Article Number

The Douglas variant code (from `?variant=` URL param or search API `code` field). Used as the `sourceArticleNumber` on source-variants.

### Canonical URL

Constructed as `https://www.douglas.de/de/p/{baseProduct}` (no variant param).

## Search (`searchProducts`)

Uses Playwright to establish an Akamai session, then calls the JSON API via `page.evaluate`:

1. Launch browser, navigate to `https://www.douglas.de/de` to get Akamai cookies
2. Wait 2-3s for cookies to settle
3. Call `/jsapi/v2/products/search` via `fetch()` inside the page context
4. Deduplicate results by `baseProduct` code (since API returns variant-level results)
5. Map to `DiscoveredProduct[]` with `productUrl`, `name`, `brandName`, `rating`, `ratingCount`, `category`
6. Paginate via `currentPage` param until `maxResults` or `totalPages` reached

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product (base) | `douglas.de/de/p/{baseProduct}` | `douglas.de/de/p/5011358006` |
| Product (variant) | `douglas.de/de/p/{baseProduct}?variant={code}` | `douglas.de/de/p/5011358006?variant=1166241` |
| Search page | `douglas.de/de/search?q={query}` | `douglas.de/de/search?q=hyaluron` |
| Brand page | `douglas.de/de/b/{slug}/{brandCode}` | `douglas.de/de/b/essence/b5590` |

- `sourceUrl` on source-products: base product URL (no query params), used as dedup key
- `sourceUrl` on source-variants: variant URL with `?variant={code}` query param
- Both normalized via `normalizeProductUrl()` / `normalizeVariantUrl()`

## Bot Protection

Douglas uses **Akamai Bot Manager**. Key details:
- Cookie `_abck` is the Akamai bot management cookie — required for API access
- Cookie `ak_bmsc` is the Akamai session cookie
- Plain HTTP requests (curl/stealthFetch) without these cookies get `400 Bad Request`
- Playwright with stealth plugin successfully obtains cookies via normal page navigation
- No interactive challenge observed (unlike Mueller's Cloudflare verification) — just cookie-based
- **Akamai sensor intercepts `fetch()` and `XMLHttpRequest` on product pages** — API calls only work from the homepage context (before the sensor fully initializes)

## Product Detail Page

The product detail page embeds two large JavaScript objects:
- `window.__INITIAL_APP_CACHE__` — app-level configuration
- `window.__INITIAL_DATA_CACHE__` — SSR cache (~15K entries in a custom serialization format)

The `__INITIAL_DATA_CACHE__` uses a proprietary serialization format (string references like `a|1|2|3` for arrays, `o|A|B|C` for objects) that is impractical to decode. The driver extracts data from the rendered DOM instead.

Key `data-testid` selectors on the product page:
- `variant-blobs-scrollable-blob` — variant color swatches (with `data-code`)
- `breadcrumb-name` — breadcrumb links
- `availability-online-stock-status` — availability text
- `accordion-panels__panel__header` — accordion section headers (Produktdetails, Anwendung, Inhaltsstoffe)
- `bazaarvoice-mobile` — BazaarVoice reviews container
- `carousel-productpage` — product image carousel

## Reviews (BazaarVoice Direct API)

Reviews are fetched directly from BazaarVoice's API, **bypassing Douglas's Akamai-protected proxy** entirely. No browser needed.

- **API**: `apps.bazaarvoice.com/bfd/v1/clients/douglas-de/api-products/cv2/resources/data/reviews.json`
- **Auth**: `Bv-Bfd-Token: 15804,main_site,de_DE` header + `douglas.de` origin/referer
- **Token source**: `displayCode` field extracted from the BV loader script at `apps.bazaarvoice.com/deployments/douglas-de/main_site/production/de_DE/bv.js`
- **Key params**: `apiVersion=5.4`, `filter=productid:eq:{baseProduct}` — keyed by Douglas base product code (e.g. `5011358006`)
- **Pagination**: `limit=100`, `offset=0`, sorted by `submissiontime:desc`. Loops until all reviews fetched.
- **Response nesting**: Unlike DM's BV response, Douglas's response is nested under `response.Results` (not top-level `Results`)
- **Rating normalization**: BazaarVoice ratings (1-5 stars) are normalized to 0-10 scale (`rating * 2`)
- **Reviewer metadata**: `ContextDataValues` contains `Age.Value` (e.g. "18to24"), `Gender.Value` (e.g. "Female"), `SkinType.Value`, `HairColor.Value`
- **Syndication**: `SyndicationSource.Name` present when review is syndicated from another source
- **Failure handling**: Wrapped in try/catch — returns undefined on failure, never fails the scrape

### Why direct API instead of Douglas proxy

Douglas proxies BV requests through `/jsapi/v2/products/bazaarvoice/reviews`, but Akamai Bot Manager blocks this endpoint for Playwright browsers:
- Page's `fetch()`/`XMLHttpRequest` → `net::ERR_HTTP2_PROTOCOL_ERROR` (Akamai sensor aborts)
- Playwright `context.request` → `403 Access Denied`
- Even non-headless mode fails — Akamai detects Playwright stealth plugin

The direct BV API at `apps.bazaarvoice.com` has no Akamai protection and works with plain `stealthFetch()`.

## Not Yet Implemented

- **Discovery** (`discoverProducts`): Category tree traversal. Douglas has a navigation structure but no known API for category enumeration.
