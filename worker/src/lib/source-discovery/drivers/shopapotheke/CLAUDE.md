# Shop Apotheke Driver — Scraping Reference

German online pharmacy and beauty retailer. Pure HTTP driver — no Playwright needed.
Data comes from JSON-LD embedded in the product page HTML plus additional HTML extraction.

## Overview

- **URL**: `www.shop-apotheke.com`
- **Driver type**: Pure HTTP (`stealthFetch`) — no browser required
- **Data sources**: JSON-LD `Product` (in a `WebPage` wrapper), `BreadcrumbList`, HTML data attributes
- **Bot protection**: None observed — plain HTTP works

## Data Sources

Each `scrapeProduct()` call makes **one HTTP request**:

| Request | URL | Returns |
|---------|-----|---------|
| Product page HTML | `/{category}/{sku}/{slug}.htm` (optional `?offerId=...`) | Full HTML with embedded JSON-LD and data-qa-id attributes |

## Scrape Flow (`scrapeProduct`)

```
1. Fetch product page HTML with stealthFetch(url)
2. Extract all <script type="application/ld+json"> blocks with regex
3. Find Product: WebPage.mainEntity where mainEntity['@type'] === 'Product'
   (fallback: top-level block with '@type' === 'Product')
4. Find BreadcrumbList: block with '@type' === 'BreadcrumbList'
5. Strip ?offerId= from URL to get canonical URL
6. Extract GTIN from HTML data-qa-id="product-attribute-pzn" (despite the name, contains EAN)
7. Extract extra images from data-qa-id="product-image-N" img tags (CDN URLs)
8. Extract description from "Produktdetails" HTML section
9. Extract ingredients from "Inhaltsstoffe" section or AQUA block
10. Parse amount/unit from offers.eligibleQuantity.name
11. Build categoryBreadcrumbs from BreadcrumbList (skip "Home", skip last element = product name)
12. Build variants from product.isSimilarTo[] (sibling color/size variants)
13. Return ScrapedProductData
```

## Field Extraction Details

### Name, Brand

- **name**: `product.name` (from JSON-LD)
- **brand**: `product.brand` — a plain string (not an object like in Schema.org spec)

### GTIN

From HTML attribute:
```
data-qa-id="product-attribute-pzn">12345678<
```
Regex: `data-qa-id="product-attribute-pzn">(\d{8,13})<`

Despite the attribute name "pzn" (Pharmazentralnummer), the value is the EAN/GTIN barcode.

### Price

- **priceCents**: `product.offers.price` × 100 (rounded)
- **currency**: `product.offers.priceCurrency` (default: "EUR")

### Availability

From `product.offers.availability` URL:
- Contains "InStock" → `available`
- Contains "OutOfStock" → `unavailable`
- Otherwise → `unknown`

### Images

Two sources, deduplicated:
1. `product.image` (single URL string from JSON-LD)
2. HTML regex: `data-qa-id="product-image-N"` followed by `src="...cdn.shop-apotheke.com..."`

### Description

Extracted from accordion sections inside the **first** `<div class="accordion-stack">` within `[data-qa-id="product-description"]`. The page has two accordion-stacks — the first contains product content, the second contains footer links (Versandarten, Zahlungsarten, etc.).

Each accordion has:
- Title: `<div class="accordion-summary__content">Title</div>`
- Content: `<div class="accordion-details"><div class="prose ...">HTML content</div></div>`

Typical product sections: "USP / Key Facts", "Anwendung", "Herstellerdaten".

The driver formats each section as markdown: `## Title\n\nContent` (HTML stripped to plain text), then joins all sections with double newlines. This follows the same pattern as PURISH's tab-to-markdown extraction and Douglas's `htmlToText()`.

Fallback: `product.description` from JSON-LD (only if it's more than just the product name — the JSON-LD description is often just the name repeated).

### Ingredients

Two strategies:
1. Look for "Inhaltsstoffe" section in HTML → extract content, strip HTML
2. Look for block starting with "AQUA" (standard INCI list opening)

### Amount / Unit

Two sources:
1. `product.offers.eligibleQuantity.name` from JSON-LD (e.g. "9.5 g") — often missing for the main product
2. Fallback: HTML `data-qa-id="product-attribute-package_size"` → `<span>9,5 g</span>` inside the container

Parsed with regex `([\d.,]+)\s*(mg|g|kg|ml|l|Stück)/i`. Comma converted to dot for decimal parsing.

### Per-Unit Price

From HTML `data-qa-id="current-variant-price-per-unit"` (e.g. "65,68 € / 100 g").
Parsed into `perUnitAmount` (65.68), `perUnitQuantity` (100), `perUnitUnit` ("g").

### Category Breadcrumbs

From `BreadcrumbList.itemListElement`:
- Skip items with name === "Home" (case-insensitive)
- Skip the last element (product name itself)
- Returns intermediate category names

### Source Article Number

`product.sku` from JSON-LD (e.g. "upm3ZWKHA") — internal Shop Apotheke product code.

### Canonical URL

Input URL with query string stripped (removes `?offerId=...` and similar params).
Then normalized via `normalizeProductUrl()`.

## Variants

Shop Apotheke exposes sibling variants (e.g. different shades) via `product.isSimilarTo[]` in the JSON-LD.

Each `isSimilarTo` entry has:
- `sku`: variant SKU (used as label)
- `url`: full absolute URL for that variant
- `name`: product name (same for all)
- `offers.price`: price for that variant
- `offers.eligibleQuantity.name`: amount string
- `offers.availability`: stock URL

Variant dimension is always `"Farbe"` (color) — the isSimilarTo pattern is used for color/shade variants.

**Color label extraction**: The page may contain text like `"Farbe: 35 Universal Bronze"`.
The driver extracts this with regex `Farbe:\s*([^\n<]+)` and uses it as the label for the currently
selected variant. Sibling variant labels fall back to their SKU.

**GTINs**: Not available in the isSimilarTo JSON-LD. Each variant must be crawled individually to get its GTIN.

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Product | `/{category}/{sku}/{slug}.htm` | `/beauty/upm3ZWKHA/essence-skin-tint-foundation.htm` |
| Product with offer | `/{category}/{sku}/{slug}.htm?offerId=...` | same + `?offerId=abc123` |

- `sourceUrl` on source-products: canonical URL (no query params) — dedup key
- Each `isSimilarTo` entry has its own distinct URL path (not a query-param variant)
- Variant URLs are full absolute URLs from the JSON-LD

## Not Yet Implemented

- **`discoverProducts()`** — throws "Shop Apotheke discovery not yet implemented"
- **`searchProducts()`** — throws "Shop Apotheke search not yet implemented"
- **Reviews** — no review API integration yet

## Key Implementation Notes

- No Playwright, no `launchBrowser` — all requests via `stealthFetch()`
- HTML parsing uses regex only (no cheerio/jsdom dependency)
- JSON-LD parsing uses `JSON.parse()` on extracted script tag content
- `normalizeProductUrl()` is called on the canonical URL before returning
