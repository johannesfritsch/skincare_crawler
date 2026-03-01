import { createLogger } from '@/lib/logger'
import { stealthFetch } from '@/lib/stealth-fetch'
import { normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'
import type {
  SourceDriver,
  ProductDiscoveryOptions,
  ProductDiscoveryResult,
  ProductSearchOptions,
  ProductSearchResult,
  ScrapedProductData,
  DiscoveredProduct,
} from '../types'

const log = createLogger('PurishDriver')

const BASE_URL = 'https://purish.com'

// ─── Shopify JSON API types ─────────────────────────────────────────────────

interface ShopifyVariant {
  id: number
  title: string
  option1: string | null
  option2: string | null
  option3: string | null
  sku: string
  price: string // e.g. "23.82"
  compare_at_price: string | null
  barcode: string | null // EAN/GTIN
  grams: number
  available?: boolean
  image_id: number | null
  requires_shipping: boolean
  featured_image?: { src: string } | null
  unit_price?: string | null
  unit_price_measurement?: {
    measured_type: string
    quantity_value: string
    quantity_unit: string
    reference_value: number
    reference_unit: string
  } | null
}

interface ShopifyImage {
  id: number
  src: string
  alt: string | null
  variant_ids: number[]
}

interface ShopifyOption {
  name: string
  position: number
  values: string[]
}

interface ShopifyProduct {
  id: number
  title: string
  handle: string
  body_html: string
  vendor: string // brand name
  product_type: string // e.g. "Serum & Booster"
  tags: string
  variants: ShopifyVariant[]
  images: ShopifyImage[]
  options: ShopifyOption[]
  published_at: string | null
}

/** Product shape embedded in the search page's `searchResultsJson` variable */
interface ShopifySearchPageProduct {
  id: number
  title: string
  handle: string
  vendor: string
  type: string
  price: number // already in cents
  price_min: number
  price_max: number
  compare_at_price_min: number | null
  compare_at_price_max: number | null
  available: boolean
  tags: string[]
  variants: Array<{
    id: number
    title: string
    option1: string | null
    option2: string | null
    option3: string | null
    sku: string
    price: number
    compare_at_price: number | null
    barcode: string | null
    available: boolean
    featured_image?: { src: string } | null
  }>
  images: string[]
  featured_image: string | null
  options: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function jitteredDelay(baseMs: number): Promise<void> {
  const jitter = baseMs * 0.25
  const ms = baseMs + (Math.random() * 2 - 1) * jitter
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Parse price string like "23.82" to cents (2382) */
function priceToCents(price: string | number | null | undefined): number | undefined {
  if (price == null) return undefined
  const num = typeof price === 'string' ? parseFloat(price) : price
  if (isNaN(num)) return undefined
  return Math.round(num * 100)
}

/** Strip HTML tags and decode common entities */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/** Convert Shopify body_html to markdown-ish description text */
function bodyHtmlToMarkdown(html: string): string {
  if (!html) return ''
  let text = html
    // Convert headings
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n')
    // Convert list items
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    // Convert paragraphs
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    // Convert line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert bold
    .replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**')
    // Strip remaining HTML
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text
}

/**
 * Extract ingredients text from Shopify body_html.
 * Purish products don't have a dedicated ingredients field in the JSON API,
 * but many product pages include an "Inhaltsstoffe" or "INCI" section in the
 * metafields or page HTML. We try the product page for metafield data.
 */
async function fetchIngredientsFromPage(handle: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}/products/${handle}`
    const res = await stealthFetch(url)
    if (!res.ok) return null
    const html = await res.text()

    // Look for INCI / Inhaltsstoffe in the page. Purish typically stores it
    // in a metafield that gets rendered as a tab/accordion on the product page.
    // Common patterns: "Inhaltsstoffe" or "INCI" section
    const patterns = [
      // Match "Inhaltsstoffe" tab content (Shopify theme renders metafields in tabs)
      /(?:inhaltsstoffe|inci|ingredients)[^<]*<\/(?:h[1-6]|strong|b|div|span|p)>\s*(?:<[^>]*>)*\s*((?:aqua|water|glycerin|niacinamide|cetearyl|dimethicone|phenoxyethanol|sodium|butylene|caprylic|isopropyl)[^<]{20,})/i,
      // Match a block of comma-separated INCI names (typical ingredient list)
      /((?:aqua|water)\s*(?:\/\s*eau)?,\s*(?:[a-z][a-z0-9\s\-\/()]*,\s*){5,}[a-z][a-z0-9\s\-\/()]*\.?)/i,
    ]

    for (const pattern of patterns) {
      const match = html.match(pattern)
      if (match) {
        const text = stripHtml(match[1] || match[0])
        // Sanity check: should look like an ingredient list (comma-separated chemical names)
        if (text.includes(',') && text.length > 30) {
          return text
        }
      }
    }
    return null
  } catch {
    return null
  }
}

/** Build the canonical product URL */
function productUrl(handle: string): string {
  return `${BASE_URL}/products/${handle}`
}

/** Parse amount and unit from variant title or product tags/body */
function parseAmountFromVariant(variant: ShopifyVariant): { amount: number; amountUnit: string } | null {
  const text = variant.option1 ?? variant.title ?? ''
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(ml|g|kg|l|oz|stk|stück|pcs)/i)
  if (match) {
    const amount = parseFloat(match[1].replace(',', '.'))
    const unit = match[2].toLowerCase()
    return { amount, amountUnit: unit }
  }
  return null
}

// ─── Discovery progress ─────────────────────────────────────────────────────

interface PurishDiscoveryProgress {
  /** Collection handles to discover (the BFS queue) */
  collectionHandles: string[]
  /** Current index in collectionHandles */
  currentIndex: number
  /** Current page within the collection (1-based) */
  currentPage: number
}

/** Fetch the list of collection handles from the nav/sitemap */
async function discoverCollectionHandles(rootUrl: string): Promise<string[]> {
  // If the URL points to a specific collection, just use that
  try {
    const parsed = new URL(rootUrl)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    // URL like /collections/skincare → just use that collection
    if (pathParts[0] === 'collections' && pathParts[1]) {
      return [pathParts[1]]
    }
    // Also handle /en/collections/skincare
    if (pathParts[1] === 'collections' && pathParts[2]) {
      return [pathParts[2]]
    }
  } catch { /* fall through to full discovery */ }

  // For the root URL or non-collection URLs, fetch all collections
  const handles: string[] = []
  let page = 1
  while (true) {
    const res = await stealthFetch(`${BASE_URL}/collections.json?limit=250&page=${page}`)
    if (!res.ok) break
    const data = await res.json() as { collections: Array<{ handle: string }> }
    if (!data.collections || data.collections.length === 0) break
    for (const c of data.collections) {
      handles.push(c.handle)
    }
    if (data.collections.length < 250) break
    page++
    await jitteredDelay(500)
  }
  return handles
}

/**
 * Extract the `searchResultsJson` array from the search page HTML.
 * Shopify themes embed the full product data (including variants with barcodes)
 * as a JS variable. We find the array start and bracket-match to extract it.
 */
function parseSearchResultsJson(html: string): ShopifySearchPageProduct[] | null {
  const marker = 'var searchResultsJson = '
  const idx = html.indexOf(marker)
  if (idx === -1) return null

  const start = idx + marker.length
  if (html[start] !== '[') return null

  // Bracket-match to find the end of the JSON array
  let depth = 0
  let end = start
  for (let i = start; i < html.length; i++) {
    if (html[i] === '[') depth++
    else if (html[i] === ']') depth--
    if (depth === 0) {
      end = i
      break
    }
  }

  try {
    return JSON.parse(html.slice(start, end + 1))
  } catch (e) {
    log.warn(`parseSearchResultsJson: failed to parse JSON: ${e}`)
    return null
  }
}

// ─── Driver ─────────────────────────────────────────────────────────────────

export const purishDriver: SourceDriver = {
  slug: 'purish' as any,
  label: 'PURISH',
  hosts: ['purish.com', 'www.purish.com', 'purish.de', 'www.purish.de'],
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 40" fill="none"><text x="0" y="32" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="36" fill="#000">PURISH</text></svg>`,

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return this.hosts.includes(hostname)
    } catch {
      return false
    }
  },

  async discoverProducts(options: ProductDiscoveryOptions): Promise<ProductDiscoveryResult> {
    const { url, onProduct, onProgress, delay = 2000 } = options
    const maxPages = options.maxPages ?? 100
    let pagesUsed = 0

    // Resume from progress if provided
    let progress = options.progress as PurishDiscoveryProgress | undefined
    if (!progress) {
      const handles = await discoverCollectionHandles(url)
      if (handles.length === 0) {
        log.warn(`discoverProducts: no collections found for ${url}`)
        return { done: true, pagesUsed: 0 }
      }
      progress = { collectionHandles: handles, currentIndex: 0, currentPage: 1 }
    }

    while (progress.currentIndex < progress.collectionHandles.length && pagesUsed < maxPages) {
      const handle = progress.collectionHandles[progress.currentIndex]
      const apiUrl = `${BASE_URL}/collections/${handle}/products.json?limit=250&page=${progress.currentPage}`
      log.info(`discoverProducts: fetching ${apiUrl}`)

      const res = await stealthFetch(apiUrl)
      if (!res.ok) {
        log.warn(`discoverProducts: failed to fetch collection ${handle} page ${progress.currentPage}: ${res.status}`)
        progress.currentIndex++
        progress.currentPage = 1
        continue
      }

      const data = await res.json() as { products: ShopifyProduct[] }
      pagesUsed++

      if (!data.products || data.products.length === 0) {
        // Done with this collection
        progress.currentIndex++
        progress.currentPage = 1
        await onProgress?.(progress)
        await jitteredDelay(delay)
        continue
      }

      // Process products
      for (const product of data.products) {
        const defaultVariant = product.variants[0]
        const price = priceToCents(defaultVariant?.price)
        const discovered: DiscoveredProduct = {
          productUrl: normalizeProductUrl(productUrl(product.handle)),
          gtin: defaultVariant?.barcode || undefined,
          brandName: product.vendor || undefined,
          name: product.title,
          price,
          currency: 'EUR',
          category: product.product_type || undefined,
        }
        await onProduct(discovered)
      }

      if (data.products.length < 250) {
        // Done with this collection
        progress.currentIndex++
        progress.currentPage = 1
      } else {
        progress.currentPage++
      }

      await onProgress?.(progress)
      await jitteredDelay(delay)
    }

    const done = progress.currentIndex >= progress.collectionHandles.length
    return { done, pagesUsed }
  },

  async searchProducts(options: ProductSearchOptions): Promise<ProductSearchResult> {
    const { query, maxResults = 50 } = options
    const products: DiscoveredProduct[] = []

    // Use the full search page instead of the suggest API — the suggest API
    // doesn't support GTIN searches, but the website search works for both
    // text queries and barcodes. Results are embedded as `searchResultsJson`
    // in the page HTML (~24 products per page, paginated via &page=N).
    let page = 1
    while (products.length < maxResults) {
      const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(query)}&type=product&page=${page}`
      log.info(`searchProducts: ${searchUrl}`)

      const res = await stealthFetch(searchUrl)
      if (!res.ok) {
        log.warn(`searchProducts: search failed: ${res.status}`)
        break
      }

      const html = await res.text()
      const found = parseSearchResultsJson(html)
      if (!found || found.length === 0) break

      for (const p of found) {
        if (products.length >= maxResults) break
        const defaultVariant = p.variants?.[0]
        products.push({
          productUrl: normalizeProductUrl(productUrl(p.handle)),
          gtin: defaultVariant?.barcode || undefined,
          brandName: p.vendor || undefined,
          name: p.title,
          price: p.price, // already in cents
          currency: 'EUR',
          category: p.type || undefined,
        })
      }

      // Shopify search pages show ~24 products per page
      if (found.length < 24) break
      page++
      await jitteredDelay(1000)
    }

    return { products }
  },

  async scrapeProduct(sourceUrl: string): Promise<ScrapedProductData | null> {
    // Extract handle from URL
    const parsed = new URL(sourceUrl)
    const pathParts = parsed.pathname.split('/').filter(Boolean)
    // Handle /products/foo or /en/products/foo
    let handle: string | null = null
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === 'products' && pathParts[i + 1]) {
        handle = pathParts[i + 1]
        break
      }
    }
    if (!handle) {
      log.warn(`scrapeProduct: could not extract handle from ${sourceUrl}`)
      return null
    }

    const apiUrl = `${BASE_URL}/products/${handle}.json`
    log.info(`scrapeProduct: fetching ${apiUrl}`)

    const res = await stealthFetch(apiUrl)
    if (!res.ok) {
      log.warn(`scrapeProduct: failed to fetch ${apiUrl}: ${res.status}`)
      return null
    }

    const data = await res.json() as { product: ShopifyProduct }
    const product = data.product
    if (!product) {
      log.warn(`scrapeProduct: no product in response for ${handle}`)
      return null
    }

    const defaultVariant = product.variants[0]
    const gtin = defaultVariant?.barcode || undefined
    const priceCents = priceToCents(defaultVariant?.price)
    const amountInfo = defaultVariant ? parseAmountFromVariant(defaultVariant) : null

    // Per-unit price from Shopify's unit_price_measurement
    let perUnitAmount: number | undefined
    let perUnitQuantity: number | undefined
    let perUnitUnit: string | undefined
    if (defaultVariant?.unit_price_measurement) {
      const upm = defaultVariant.unit_price_measurement
      perUnitAmount = priceToCents(defaultVariant.unit_price)
      perUnitQuantity = upm.reference_value
      perUnitUnit = upm.reference_unit
    }

    // Description
    const description = bodyHtmlToMarkdown(product.body_html || '')

    // Ingredients: try to extract from the product page HTML
    const ingredientsText = await fetchIngredientsFromPage(handle)

    // Images
    const images = product.images.map((img) => ({
      url: img.src,
      alt: img.alt,
    }))

    // Variants: Shopify stores variants as option combinations
    const variants: ScrapedProductData['variants'] = []
    if (product.options.length > 0 && product.variants.length > 1) {
      for (const option of product.options) {
        if (option.name === 'Title' && option.values.length === 1 && option.values[0] === 'Default Title') {
          continue // Skip the "Default Title" pseudo-option
        }
        const optionIndex = option.position // 1-based
        const optionValues = product.variants.map((v) => {
          const optVal = optionIndex === 1 ? v.option1 : optionIndex === 2 ? v.option2 : v.option3
          return {
            label: optVal || v.title,
            value: normalizeVariantUrl(`${BASE_URL}/products/${handle}?variant=${v.id}`),
            gtin: v.barcode || null,
            isSelected: v.id === defaultVariant?.id,
          }
        })
        // Deduplicate by label
        const seen = new Set<string>()
        const dedupedOptions = optionValues.filter((o) => {
          if (seen.has(o.label)) return false
          seen.add(o.label)
          return true
        })
        if (dedupedOptions.length > 1) {
          variants.push({ dimension: option.name, options: dedupedOptions })
        }
      }
    }

    // Labels from tags
    const labels = product.tags
      ? product.tags.split(',').map((t) => t.trim()).filter((t) => {
          // Only include user-facing labels, skip internal tags
          const lower = t.toLowerCase()
          return !lower.startsWith('dp-') && !lower.startsWith('nirang_') && !lower.startsWith('dynamic_')
            && !lower.includes('off') && !lower.includes('gwp') && !lower.includes('lp')
            && !lower.startsWith('bw') && !lower.startsWith('bemine')
            && t.length > 1 && t.length < 30
        })
      : []

    // Category breadcrumbs from product_type
    const categoryBreadcrumbs = product.product_type ? [product.product_type] : undefined

    const canonicalUrl = productUrl(handle)

    return {
      gtin,
      name: product.title,
      brandName: product.vendor || undefined,
      description: description || undefined,
      ingredientsText: ingredientsText || undefined,
      priceCents,
      currency: 'EUR',
      amount: amountInfo?.amount,
      amountUnit: amountInfo?.amountUnit,
      images,
      variants,
      labels: labels.length > 0 ? labels : undefined,
      sourceArticleNumber: defaultVariant?.sku || undefined,
      categoryBreadcrumbs,
      canonicalUrl,
      perUnitAmount,
      perUnitQuantity,
      perUnitUnit,
      warnings: [],
    }
  },
}
