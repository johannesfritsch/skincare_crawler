# Driver Implementation Guide

Practical guide for building a new source driver, based on lessons learned from DM, Mueller, Rossmann, PURISH, and Douglas. Read the root `CLAUDE.md` section "Adding a New Store Driver" first for the mechanical checklist (registry files, types, migrations). This guide covers the implementation decisions and pitfalls.

## Choosing a Scraping Strategy

Every store falls into one of three patterns:

| Pattern | When to use | Examples | Pros | Cons |
|---------|------------|----------|------|------|
| **Pure HTTP** (`stealthFetch`) | Store has public JSON APIs or static HTML | DM (product API), PURISH (Shopify JSON) | Fast, no browser overhead | Blocked by bot protection |
| **Playwright DOM** | Store requires JS rendering, no usable API | Mueller (RSC JSON + DOM), Rossmann (DOM) | Handles SPAs, bot checks | Slow, resource-heavy |
| **Playwright + page.evaluate(fetch)** | Store has APIs but blocks plain HTTP via CDN bot management | Douglas (Akamai blocks stealthFetch, API only works from browser context) | Bypasses CDN protection | Complex, fragile timing |

**Decision process:**
1. Try `stealthFetch` on the store's product pages and any JSON APIs first
2. If blocked (403, empty response, CAPTCHA), check if Playwright with stealth plugin works
3. If the store has a JSON API that only works with CDN session cookies, use `page.evaluate(fetch)` from within the browser context

## ScrapedProductData Contract

The driver returns `ScrapedProductData`. Key fields and how persist uses them:

### Canonical URL

`canonicalUrl` overrides the source-variant's `sourceUrl` during persist. Critical for dedup:

- **Single-variant products**: canonical URL = base product URL (no query params)
- **Multi-variant products**: canonical URL MUST include the variant identifier (e.g. `?variant=123`), even for the default variant. Otherwise the default variant gets two source-variants: one from the base URL crawl and one from sibling creation during other variant crawls.

```typescript
// Correct: always include variant param when variants exist
const effectiveVariantCode = variantCode || (domData.variants.length > 0 ? selectedCode : undefined)
const canonicalUrl = effectiveVariantCode
  ? `${BASE_URL}/path/${productId}?variant=${effectiveVariantCode}`
  : `${BASE_URL}/path/${productId}`
```

### Variants

`variants` is an array of `{ dimension, options[] }`. Each option needs:

- `value`: full variant URL (e.g. `https://store.com/product?variant=123`) — persist stores this as the source-variant's `sourceUrl`
- `label`: human-readable label (e.g. "30 ml", "Nr. 100")
- `gtin`: EAN/GTIN if known, or `null`
- `isSelected`: `true` for the variant currently being crawled — persist skips it (already handled as the main crawled variant)
- `sourceArticleNumber`: store-specific article/variant code

**The `isSelected` flag is critical.** If the currently crawled variant is not marked `isSelected`, persist creates a duplicate sibling for it. Always set it based on the URL's variant param OR the page's selected state.

### Reviews

`reviews` are product-level, not variant-specific. When the scrape stage provides reviews inline (`data.reviews`), they're linked to the single crawled variant. The standalone reviews stage (which runs separately) fetches reviews per source-product and links them to ALL variants.

If the store's review API is keyed by product ID (BazaarVoice, Yotpo), export the review fetch function so `fetch-reviews.ts` can dispatch to it. See `fetchDouglasReviews()` or `fetchDmReviews()` for examples.

### Source Article Numbers

Two levels:
- `sourceArticleNumber` (top-level): the variant-level article number for the crawled variant
- `sourceProductArticleNumber`: the product-level code (stored on source-products). For Douglas this is the base product code; for PURISH it's the Shopify product ID. Used as the review API key.

### Description Extraction

Stores typically have product details in collapsible/accordion/tab sections (not in a single block). The description should be formatted as **markdown with `## Heading` per section**, combining all product-relevant sections (description, usage, manufacturer, key facts, etc.) into one text block. Skip non-product sections (shipping, payment, legal).

**Patterns by store:**

| Store | Structure | Approach |
|-------|-----------|----------|
| PURISH | `<tabs-desktop>` with `<button class="tab-navigate">` titles + `<div class="tab-item">` content | Extract tab titles → format as `## Title\n\nContent` |
| Douglas | Single HTML description field | `htmlToText()` converts HTML to plain text |
| Shop Apotheke | `<div class="accordion-stack">` with `accordion-summary__content` titles + `accordion-details` content | Extract first accordion-stack only (second is footer), format as `## Title\n\nContent` |
| Mueller | `<section class="accordion">` with `span[role="heading"]` + `accordion-entry__contents` | Specs table rows → `### Label\nValue`, other sections as `## Heading\n\nContent` |

**Key rule:** The JSON-LD `description` field is often just the product name or a very short summary. Always prefer HTML-extracted structured descriptions. Only use JSON-LD as a last resort fallback.

**When building a new driver:** Check the product page for accordion/tab/collapsible sections. These almost always contain the real product information. Extract each section's title and content, format as markdown, and concatenate. Filter out footer/shipping/legal sections that aren't product data.

## Variant Extraction Pitfalls

### Multiple variant UI types

A single store may render variants differently depending on the product type. Douglas has:
- **Color swatches**: `<li data-testid="variant-blobs-scrollable-blob" data-code="123">`
- **Size radio buttons**: `<input name="sizeVariants" value="123">` inside `[data-testid="RadioButton"]`

Always check multiple products during development. Try at minimum: a color-variant product, a size-variant product, and a single-variant product (no variants).

### DOM structure assumptions

Never assume an element is a child of another just because they appear visually nested. Browser DevTools can mislead — always verify with `querySelector` from the parent. The Douglas size variants looked like:

```
div[data-testid="RadioButton"]     <-- common ancestor
  label
    span                           <-- radio input lives here
      input[name="sizeVariants"]
    span                           <-- content lives here
      div[data-testid="size-variants-radio"]
        div[data-testid="variant-name"]
```

The radio input and the content div are **sibling spans**, not parent-child. The fix: start from the input element and use `.closest()` to walk UP to the common ancestor.

### Identifying the selected variant

Different UI types use different selection indicators:
- Color swatches: `aria-selected="true"` attribute
- Radio buttons: `input.checked` property
- Dropdowns: `option[selected]` or the displayed value

When crawling a base URL (no variant param), the "selected" variant is whatever the page defaults to. When crawling a `?variant=X` URL, verify the selection matches `X`.

## GTIN Extraction

GTINs may come from multiple sources with different reliability:

| Source | Reliability | When available |
|--------|------------|----------------|
| Search/product API `ean` field | High | Most products, but not all |
| Product page meta tags / JSON-LD | High | If the store includes structured data |
| React component state (fiber tree) | Medium | SPAs that decode server data into React props |
| `__INITIAL_DATA_CACHE__` or SSR data | Low | Proprietary serialization, hard to decode |
| Image URLs containing GTIN | Low | Mueller embeds GTIN in image filenames |

**Always implement fallback chains.** Douglas example:

```
1. Search API ean field (primary)
2. React fiber tree product.ean (fallback for products where API omits EAN)
```

### React fiber tree extraction

When a store uses React and embeds product data in a serialized cache (like Douglas's `__INITIAL_DATA_CACHE__`), the decoded data is accessible via React internals:

```typescript
// Walk up from a known element to find the product component
let el = document.querySelector('h1')
while (el) {
  const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'))
  if (fk) {
    let fiber = el[fk]
    while (fiber) {
      if (fiber.memoizedProps?.product?.ean) {
        return fiber.memoizedProps.product.ean  // decoded EAN
      }
      fiber = fiber.return
    }
  }
  el = el.parentElement
}
```

This only returns data for the currently selected variant. Sibling variants get their data when crawled individually.

## Bot Protection

| CDN | Detection method | Workaround |
|-----|-----------------|------------|
| None | — | `stealthFetch()` works |
| Cloudflare | JS challenge, turnstile | Playwright + stealth plugin, wait for challenge to clear |
| Akamai Bot Manager | Cookie-based (`_abck`), sensor intercepts fetch/XHR on some pages | Playwright for session cookies, `page.evaluate(fetch)` for API calls |

**Akamai-specific (Douglas):** The sensor intercepts `fetch()` and `XMLHttpRequest` on product pages but not the homepage. API calls only work from the homepage context. The scrape flow must navigate to the homepage first for API calls, then to the product page for DOM extraction, then back to the homepage for sibling GTIN fetches.

## Cookie Consent

Most German stores use Usercentrics or similar. The consent banner may be in a **Shadow DOM**:

```typescript
// Playwright's locator() pierces open shadow roots automatically
const btn = page.locator('button:has-text("Alle erlauben")')
```

But `document.querySelector()` inside `page.evaluate()` does NOT pierce shadow DOM. If you need to dismiss consent inside evaluate, access the shadow root explicitly:

```typescript
const sr = document.getElementById('usercentrics-root')?.shadowRoot
const btn = sr?.querySelectorAll('button').find(b => b.textContent.includes('ALLE ERLAUBEN'))
btn?.click()
```

## Reviews Integration

### BazaarVoice (DM, Rossmann, Douglas)

Direct API at `apps.bazaarvoice.com` bypasses store CDN protection entirely. Key parameters:
- `filter=productid:eq:{productCode}` — keyed by the store's product code
- `Bv-Bfd-Token` header — extract from the BV loader script at `apps.bazaarvoice.com/deployments/{client}/main_site/production/{locale}/bv.js`
- Ratings are 1-5 stars, normalize to 0-10 (`rating * 2`)

### Yotpo (PURISH)

REST API at `api.yotpo.com`. Keyed by Shopify product ID. Provides `bottomline` (average score, total reviews) separately from individual reviews.

### Adding review support

1. Implement a `fetch*Reviews()` function in the driver (exported)
2. Add a case to `worker/src/lib/source-discovery/fetch-reviews.ts` to route the store slug to your function
3. Add the store to `getReviewKey()` in `worker/src/lib/product-crawl/stages/reviews.ts` — specify where the review API key comes from (source-product articleNumber, source-variant GTIN, etc.)

## Testing a New Driver

### Manual scrape test

Use `debug: true` in the scrape options to keep the browser open:

```typescript
const result = await driver.scrapeProduct('https://store.com/product/123', { debug: true })
```

### Checklist before merging

- [ ] Scrape a **color-variant** product (if applicable) — verify all variants extracted with GTINs
- [ ] Scrape a **size-variant** product (if applicable) — verify variant dimension is correct
- [ ] Scrape a **single-variant** product — verify no empty variants array, GTIN present
- [ ] Scrape a `?variant=X` URL directly — verify `isSelected` is correct, canonical URL includes variant
- [ ] Search by product name — verify dedup by base product code
- [ ] Check that reviews are fetched and linked to all variants
- [ ] Re-crawl an already-crawled product — verify no duplicate source-variants
- [ ] Verify the driver's `CLAUDE.md` documents all selectors, API endpoints, and extraction patterns

## Per-Driver CLAUDE.md Template

Each driver's `CLAUDE.md` should document (see `douglas/CLAUDE.md` for a complete example):

1. **Data sources** — which APIs and DOM elements provide which fields
2. **Scrape flow** — step-by-step navigation and extraction sequence
3. **Field extraction details** — CSS selectors, API response paths, regex patterns for each field
4. **Variants** — UI types, DOM structure, how codes/labels/selection are extracted
5. **GTINs** — where they come from, fallback chain
6. **Reviews** — API details, token source, pagination, normalization
7. **Bot protection** — what CDN is used, what works and what doesn't
8. **URL patterns** — product, variant, search, brand URL formats
9. **Not yet implemented** — known gaps (e.g. discovery)
