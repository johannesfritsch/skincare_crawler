# Kaufland Driver — Scraping Reference

German supermarket chain with an online shop. Playwright-based driver. Phase 1 implements discovery only — search and scrape are mocked.

## URL Patterns

| Type | Pattern | Example |
|------|---------|---------|
| Category (non-leaf) | `/c/{slug}/~{id}/` | `/c/koerperpflege/~c52300/` |
| Category (leaf) | `/c/{slug}/~{id}/` | `/c/gesichtspflege/~c52301/` |
| Product page | `/product/{id}/` | `/product/344954401/` |
| Search | `/s/?search_value={query}` | `/s/?search_value=lippenpflege` |

## Page Types

Kaufland category pages come in two types:

### Non-Leaf (has `.rd-category-tree`)
- Contains a category navigation tree listing subcategories
- Driver extracts links from the **first** `.rd-category-tree__nav` only
- Subsequent `__nav` sections (e.g. "Häufig gesucht", "Hersteller") are skipped — detected by presence of `.rd-category-tree__list-headline` child

### Leaf (has product tiles, no `.rd-category-tree`)
- Contains `a[data-testid*="product-tile"]` product links
- Category name extracted from `h1.title`
- Pagination via `?page=N`

## Key Selectors

| Element | Selector | Notes |
|---------|---------|-------|
| Category tree nav | `.rd-category-tree__nav` | First one only |
| Category links | `.rd-category-tree__anchor` | Inside first nav |
| "Häufig gesucht" marker | `.rd-category-tree__list-headline` | If present in a nav, skip it |
| Product tile links | `a[data-testid*="product-tile"]` | Contains href + product info |
| Product name | `.product-title` | Inside tile — use `title` attr or text content |
| Category heading | `h1.title` | Leaf pages only |
| Pagination links | `.rd-pagination a.rd-page--page` | Text content = page number |

## Pagination

Leaf category pages paginate via `?page=N` query parameter. The driver:
1. Scrapes page 1 (already loaded)
2. Finds the max page number from `.rd-pagination a.rd-page--page` text content
3. Navigates to `?page=2`, `?page=3`, ... up to `lastPage`

## Discovery Flow

BFS over the category tree:
1. Start from the configured URL (e.g. a top-level category)
2. Detect page type via selector presence
3. Non-leaf: extract subcategory links from the first `.rd-category-tree__nav` → add to BFS queue
4. Leaf: scrape all product tiles, then paginate
5. Progress stored as `KauflandDiscoveryProgress`: `{ queue[], visitedUrls[], currentLeaf? }`

Product URLs are made absolute using `https://www.kaufland.de` prefix when relative.

## SPA Notes

Kaufland's frontend is a SPA. Playwright with stealth plugin is required. The driver uses `waitUntil: 'domcontentloaded'` and then waits for key selectors with a 15s timeout.

Jittered delays between navigations: `delay * (0.75 + Math.random() * 0.5)` — e.g. with default 2000ms delay, waits 1500–2500ms.

## Phase 1: Discovery Only

- `discoverProducts()` — fully implemented (BFS category tree + paginated product tiles)
- `searchProducts()` — mocked, returns `{ products: [] }`
- `scrapeProduct()` — mocked, returns `null`

Phase 2 will add product scraping. Key data to extract: GTIN (from product page JSON-LD or structured data), price, brand, description, images, variants.
