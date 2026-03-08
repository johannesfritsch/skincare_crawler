# Mueller Driver — Scraping Reference

German drugstore chain (Müller). Playwright-based driver using a hybrid RSC JSON + DOM scraping approach. Requires a browser because Mueller uses Cloudflare bot verification.

## Data Sources

Each `scrapeProduct()` call uses **one browser page load**. Data is extracted from multiple sources within the page:

| Source | What it provides | Priority |
|--------|-----------------|----------|
| RSC JSON (`self.__next_f.push()`) | Product name, EAN, brand, price, images, category tree, siblings (variants) with availability, capacity, article code | Primary |
| JSON-LD (`<script type="application/ld+json">`) | Product name, brand, GTIN, price, images, category breadcrumbs | Fallback |
| DOM elements | Product name (h1), brand (img alt), article number, price, per-unit price, rating, description, ingredients, images, variants | Fallback |

The driver always tries RSC JSON first, then JSON-LD, then DOM — for each field independently.

## Scrape Flow (`scrapeProduct`)

```
1. Launch Playwright browser (stealth-enabled)
2. Navigate to product URL, wait for h1 or product-info
3. Wait for bot check to clear (if present)
4. Single page.evaluate() call that extracts everything:
   a. Collect RSC payload from self.__next_f.push() script tags
   b. Find "product" object with "ean" and "siblings" via bracket-matching
   c. Parse JSON-LD Product schema as fallback
   d. Extract all fields with RSC → JSON-LD → DOM priority chain
5. Post-process outside browser: ingredients
6. Close browser, return ScrapedProductData
```

## RSC JSON Extraction

Mueller uses Next.js with React Server Components. Product data is embedded in `<script>` tags as `self.__next_f.push([1, "..."])` calls:

1. Collect all script tags containing `self.__next_f`
2. Extract and unescape the string payloads
3. Concatenate all chunks into one large string
4. Search for `"product":{` to locate the product object
5. Walk backwards to find the parent object's opening `{`
6. Walk forwards with bracket-matching to find the closing `}`
7. Parse the extracted JSON substring

The resulting `RscProduct` contains: `name`, `ean`, `code`, `brand.name`, `currentPrice`, `capacityValue`, `capacityUnitCode`, `images[]`, `categoryWithParents[]`, `siblings[]`, `stockLevel`, `manufacturerColor`, `manufacturerColorNumber`, `colorTile`.

## Field Extraction Details

### Name

Priority: `h1` text → RSC `product.name` → JSON-LD `name`

### Brand

Priority: RSC `product.brand.name` → DOM brand image alt text (strips "Markenbild von " prefix) → JSON-LD `brand.name`

### Description

From DOM accordion sections (`section[class*="accordion_component_accordion-entry"]`):
- Each section has a `span[role="heading"]` title and `[class*="accordion-entry__contents"]` body
- **Specs table**: if the accordion contains a `table[class*="specifications-table"]`, each row becomes `### Label\nValue` (also extracts amount/unit from "Inhalt" row and ingredients from "Inhaltsstoffe" row)
- **Plain text**: otherwise, the `innerText` of the content area
- All sections merged as `## Heading\n\nContent`

### Ingredients

From the specs table within accordion sections: the row where the label is `"Inhaltsstoffe"`. Stored as raw text (parsed during aggregation).

### Labels

Not currently extracted. Mueller doesn't have an obvious label/badge system.

### Price

Priority: RSC `currentPrice.valueWithTax` (float → cents) → JSON-LD `offers[0].price` → DOM `[data-track-id="priceContainer"]` text (regex for `X,XX €`)

Currency: RSC `currentPrice.currencyIso` → JSON-LD `offers[0].priceCurrency` → default "EUR"

### Per-Unit Price

From DOM: `[class*="product-price__base-price"] span` text. Regex matches `X,XX € / N unit` pattern.
When DOM extraction finds nothing, the persist layer's `computePerUnitPrice()` computes a fallback from `price + amount`.

### Amount / Unit

Priority: RSC `capacityValue` + `capacityUnitCode` (mapped via lookup: MILLILITER→ml, GRAM→g, etc.) → specs table "Inhalt" row (regex for `N unit`)

### Images

Priority: RSC `product.images[].url` → JSON-LD `image[]` → DOM carousel images (`[class*="carousel_component_carousel__item"] img[class*="image-section"]`, with inner URL extraction from Next.js image proxy params)

### GTIN / Barcode

Priority: RSC `product.ean` → JSON-LD `gtin` → image URL extraction (regex for `/products/{GTIN}/`, `_default_upload_bucket/{GTIN}`, or `Markant_{GTIN}_` patterns in any `<img>` on the page)

### Variants

**RSC siblings (primary)**: From `product.siblings[]`. Each sibling has:
- `code`: Mueller's internal article number
- `path`: relative URL path for the variant page
- `manufacturerColor` / `manufacturerColorNumber` / `clothingSize`: used for label construction
- `stockLevel`: availability (`> 0` = available)
- `colorTile.source`: image URL for GTIN extraction (same regex patterns)

Dimension is inferred: `"Farbe"` if any sibling has `manufacturerColor`, `"Größe"` if `clothingSize`/`sizeRange`, else `"Variante"`.

Variant label: color number + color name (e.g. "010 Charming Champagne"), or clothing size, or code.

**DOM tile fallback**: `[class*="product-attribute-list__attribute-wrapper"]` containing tile lists with images. Dimension from heading text, GTIN from image URLs, isSelected from CSS class `--selected`.

### Availability

From RSC `product.stockLevel`: `> 0` → available, `0` → unavailable. Also set per-variant from `sibling.stockLevel`.

### Source Article Number

Priority: RSC `product.code` → DOM `[class*="product-info__article-nr"]` text → `button[data-product-id]` attribute → JSON-LD `sku`

### Category Breadcrumbs

Priority: RSC `product.categoryWithParents[].name` (array of names) → JSON-LD BreadcrumbList `itemListElement[].name` (skips first and last entries — "Home" and product name)

### Rating

From DOM only: star images in `[class*="product-rating"]` — counts filled (non-empty) star images.
Rating count (`ratingNum`) is not currently extracted for Mueller.

## Discovery (`discoverProducts`)

Playwright-based BFS category tree traversal:

1. Start from the given URL (e.g. `mueller.de/c/drogerie/pflege/`)
2. Navigate to page, wait for product tiles or category nav
3. Wait for bot check to clear
4. **Leaf detection**: presence of `[class*="category-navigation__option--selected"]`
5. **Leaf pages**: scrape product tiles (`article[class*="product-tile"]` or elements with `a[data-track-id="product"]`), then paginate via `?page=N` (page numbers from `[data-testid^="pageLink-"]`)
6. **Non-leaf pages**: extract child category links from `[class*="category-navigation__list"] a[href]` and add to BFS queue

Product tiles yield: `href` (product URL), `name` (product name text), `rating` (filled star count), `gtin` (from image URL `Markant_{GTIN}_` pattern).

Category breadcrumbs built from URL path segments (e.g. `/c/drogerie/pflege/koerperpflege/deodorants/spray/` → "Drogerie -> Pflege -> Koerperpflege -> Deodorants -> Spray").

Progress stored as `MuellerProductDiscoveryProgress`: `{ queue[], visitedUrls[], currentLeaf? }`.

## Search (`searchProducts`)

Playwright-based browser scraping:

1. Navigate to `mueller.de/search/?q={query}`
2. Wait for product tiles or no-results indicator
3. Wait for bot check
4. Scrape `a[data-track-id="product"]` links (name from `aria-label`, GTIN from image URLs, rating from star images)
5. Paginate via `?page=N` until `maxResults` reached or no more pages

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product page | `www.mueller.de/p/{slug}-{code}/` | `www.mueller.de/p/essence-lash-princess-false-lash-effect-mascara-2487729/` |
| Product variant | `www.mueller.de/p/{slug}-{code}/?itemId={id}` | `www.mueller.de/p/maybelline-superstay-lip-2687429/?itemId=2687430` |
| Category page | `www.mueller.de/c/{path}/` | `www.mueller.de/c/drogerie/pflege/koerperpflege/` |

- `sourceUrl` on source-products: base product URL without `?itemId=` (normalized)
- `sourceUrl` on source-variants: variant URL with `?itemId=` (only `?itemId=` URLs become variants; the base URL stays on source-products)
- Both normalized via `normalizeProductUrl()` / `normalizeVariantUrl()`

## Bot Check Handling

Mueller uses Cloudflare bot verification ("Verifying that you're not a bot..."). The driver:
1. Detects by checking `document.body.innerText` for "Verifying that you" or "not a bot"
2. Polls every 1 second for up to 30 seconds
3. Emits events when detected and when cleared/timed out
4. On timeout: skips the page (discovery) or returns null (scrape)

## Key Implementation Details

- **Browser required** — uses `playwright-extra` with stealth plugin via `launchBrowser()`
- **Hybrid extraction**: RSC JSON for structured data, DOM for ingredients/description/rating/per-unit price
- **RSC payload reassembly**: multiple `self.__next_f.push()` chunks are concatenated, then the product JSON is located via string search + bracket matching
- **GTIN from image URLs**: Mueller embeds GTINs in product image URLs (`Markant_{GTIN}_`, `/products/{GTIN}/`, `_default_upload_bucket/{GTIN}`) — used as fallback for both product-level and per-variant GTIN extraction
- **No labels**: Mueller doesn't currently have a label/badge system that's extracted
- **Jittered delays** between page navigations: `baseMs ± 25%` randomization
