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
} from '../../types'

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
  position: number
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

// ─── Yotpo Reviews ──────────────────────────────────────────────────────────

const YOTPO_STORE_KEY = 'EDc1vj8PTmjuHuo0cUBNf3lXQbrV6sAyTLXRuqBM'
const YOTPO_API = `https://api-cdn.yotpo.com/v3/storefront/store/${YOTPO_STORE_KEY}/product`
const YOTPO_PAGE_SIZE = 100

interface YotpoReview {
  id: number
  score: number
  votesUp: number
  votesDown: number
  content: string | null
  title: string | null
  createdAt: string // ISO-ish "2026-03-03T13:48:29"
  verifiedBuyer: boolean
  user: { displayName: string | null }
}

interface YotpoResult {
  reviews: NonNullable<ScrapedProductData['reviews']>
  averageScore: number | null
  totalReviews: number
}

export async function fetchPurishReviews(productId: string): Promise<YotpoResult> {
  const allReviews: NonNullable<ScrapedProductData['reviews']> = []
  let averageScore: number | null = null
  let totalReviews = 0

  try {
    let page = 1
    let totalResults = Infinity

    while (allReviews.length < totalResults) {
      const url = `${YOTPO_API}/${productId}/reviews?page=${page}&perPage=${YOTPO_PAGE_SIZE}&sort=date&lang=de`
      const res = await stealthFetch(url, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Origin': 'https://purish.com',
          'Referer': 'https://purish.com/',
        },
      })
      if (!res.ok) {
        log.info('Yotpo API returned error', { status: res.status, productId, page })
        break
      }
      const data = await res.json()
      totalResults = data?.pagination?.total ?? 0
      const reviews: YotpoReview[] = data?.reviews ?? []

      // Capture bottomline from first page
      if (page === 1 && data?.bottomline) {
        averageScore = data.bottomline.averageScore ?? null
        totalReviews = data.bottomline.totalReview ?? 0
        log.info('Yotpo bottomline', { productId, averageScore, totalReviews })
      }

      if (reviews.length === 0) break
      log.info('Yotpo reviews page fetched', { productId, page, reviews: reviews.length, total: totalResults })

      for (const r of reviews) {
        allReviews.push({
          externalId: String(r.id),
          rating: r.score * 2, // Normalize 1-5 stars to 0-10 scale
          title: r.title ?? undefined,
          reviewText: r.content ?? undefined,
          userNickname: r.user?.displayName ?? undefined,
          submittedAt: r.createdAt ?? undefined,
          positiveFeedbackCount: r.votesUp ?? 0,
          negativeFeedbackCount: r.votesDown ?? 0,
        })
      }

      page++

      if (allReviews.length < totalResults) {
        await jitteredDelay(400)
      }
    }
  } catch (error) {
    log.info('Failed to fetch reviews from Yotpo', { productId, fetched: allReviews.length, error: String(error) })
  }

  return { reviews: allReviews, averageScore, totalReviews }
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
 * Convert PURISH tab content HTML to plain text.
 *
 * Tab items on PURISH contain nested wrapper divs (tab-text, tab-text-beschreibung)
 * with metafield spans and rich-text content inside. This function is specific to
 * PURISH's Shopify theme — other drivers have their own description extraction.
 */
function tabContentToText(html: string): string {
  if (!html) return ''
  let text = html
    // Convert headings (h4 used for sub-sections like "Die Vorteile auf einen Blick")
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n### $1\n')
    // Convert list items
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    // Convert paragraphs
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    // Convert line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert bold
    .replace(/<(strong|b)[^>]*>(.*?)<\/(strong|b)>/gi, '**$2**')
    // Strip remaining HTML (meta tags, spans, divs, etc.)
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
 * Get the images for a specific variant using position-based block grouping.
 *
 * Shopify images are ordered by position. Each variant typically has one "tagged"
 * image (where variant_ids contains the variant's ID) that acts as the hero/start
 * of a contiguous block. Untagged images immediately following belong to the same
 * variant. Images after the last variant's block are shared product-level images
 * appended to every variant's gallery.
 *
 * Falls back to all images when no variant tagging exists or the selected variant
 * has no tagged image.
 */
function getVariantImages(
  allImages: ShopifyImage[],
  selectedVariantId: number | null,
): Array<{ url: string; alt: string | null }> {
  // Sort by position to ensure correct ordering
  const sorted = [...allImages].sort((a, b) => a.position - b.position)

  // Find all "block start" indices — images that are tagged to any variant
  const blockStarts: Array<{ index: number; variantIds: number[] }> = []
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].variant_ids.length > 0) {
      blockStarts.push({ index: i, variantIds: sorted[i].variant_ids })
    }
  }

  // If no variant tagging at all, or no selected variant, return all images
  if (blockStarts.length === 0 || selectedVariantId == null) {
    return sorted.map((img) => ({ url: img.src, alt: img.alt }))
  }

  // Find the block start for the selected variant
  const myBlockIdx = blockStarts.findIndex((b) => b.variantIds.includes(selectedVariantId))
  if (myBlockIdx === -1) {
    // Selected variant has no tagged image — fall back to all images
    return sorted.map((img) => ({ url: img.src, alt: img.alt }))
  }

  // The variant's block runs from its tagged image to the next tagged image (exclusive)
  const blockStart = blockStarts[myBlockIdx].index
  const blockEnd = myBlockIdx + 1 < blockStarts.length
    ? blockStarts[myBlockIdx + 1].index
    : sorted.length // last block extends to the end (includes shared images)

  // Shared images: everything after the last variant block
  const lastBlockStart = blockStarts[blockStarts.length - 1].index
  // The last variant's block ends where shared images begin. We need to figure out
  // the boundary. Shared images are untagged images that come after all variant blocks.
  // Since we don't know exactly where the last variant's images end and shared ones begin,
  // we use a heuristic: if the selected variant IS the last block, its block already
  // extends to the end (includes shared). If not, append the shared tail.
  const result = sorted.slice(blockStart, blockEnd)

  if (myBlockIdx + 1 < blockStarts.length) {
    // Not the last block — append shared images from after the last block.
    // The last block's variant-specific images end at the last tagged image's block,
    // but we need the shared tail. We estimate the shared images as untagged images
    // after the last variant block. The last variant block has the same size pattern
    // as other blocks, so shared images start where its block would end.
    //
    // Heuristic: compute the typical block size from earlier blocks. If there are
    // at least 2 blocks, use the gap between the first two tagged images. Otherwise
    // just use everything after the last tagged image.
    const typicalBlockSize = blockStarts.length >= 2
      ? blockStarts[1].index - blockStarts[0].index
      : sorted.length - lastBlockStart

    const sharedStart = lastBlockStart + typicalBlockSize
    if (sharedStart < sorted.length) {
      result.push(...sorted.slice(sharedStart))
    }
  }

  return result.map((img) => ({ url: img.src, alt: img.alt }))
}

/** Variant data from the embedded productJson (includes unavailable variants that .json API omits) */
interface PageJsonVariant {
  id: number
  title: string
  option1: string | null
  option2: string | null
  option3: string | null
  barcode: string | null
  sku: string | null
  available: boolean
}

/** Data extracted from the product page HTML (single fetch for multiple extractions) */
interface ProductPageData {
  ingredientsText: string | null
  /** Per-variant availability from the embedded productJson */
  variantAvailability: Map<number, boolean>
  /** Product-level availability from the embedded productJson */
  productAvailable: boolean | null
  /** Full variant list from productJson — includes ALL variants (available + unavailable) */
  allVariants: PageJsonVariant[]
  /** Labels extracted from <span class="product-tag"> elements (e.g. "Cruelty-free", "Paraben-free") */
  pageLabels: string[]
  /** Description merged from <tabs-desktop> tab structure (tab titles as ## headlines + content) */
  tabDescription: string | null
}

/**
 * Parse the `var productJson = {...};` embedded in the product page HTML.
 * This contains per-variant `available` booleans that the .json API omits.
 */
function parseProductJson(html: string): {
  available?: boolean
  variants?: Array<{
    id: number; title?: string; option1?: string | null; option2?: string | null; option3?: string | null;
    barcode?: string | null; sku?: string | null; available: boolean
  }>
} | null {
  const marker = 'var productJson = '
  const idx = html.indexOf(marker)
  if (idx === -1) return null

  const start = idx + marker.length
  if (html[start] !== '{') return null

  // Bracket-match to find the end of the JSON object
  let depth = 0
  let end = start
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') depth++
    else if (html[i] === '}') depth--
    if (depth === 0) {
      end = i
      break
    }
  }

  try {
    return JSON.parse(html.slice(start, end + 1))
  } catch (e) {
    log.warn('Failed to parse productJson', { error: String(e) })
    return null
  }
}

/**
 * Fetch the product page HTML and extract ingredients + variant availability.
 * Purish products don't have a dedicated ingredients field in the JSON API,
 * but many product pages include an "Inhaltsstoffe" or "INCI" section in the
 * metafields or page HTML. The page also embeds `productJson` with per-variant
 * `available` booleans.
 */
async function fetchProductPageData(handle: string): Promise<ProductPageData> {
  const empty: ProductPageData = { ingredientsText: null, variantAvailability: new Map(), productAvailable: null, allVariants: [], pageLabels: [], tabDescription: null }
  try {
    const url = `${BASE_URL}/products/${handle}`
    const res = await stealthFetch(url)
    if (!res.ok) return empty
    const html = await res.text()

    // Extract ingredients from the "Ingredients" tab.
    // PURISH's Shopify theme renders metafields in tab-items. The ingredients tab
    // contains a <span class="metafield-multi_line_text_field"> with the INCI list.
    // We extract all metafield spans and pick the one that looks like an INCI list
    // (comma-separated, 30+ chars, multiple items).
    let ingredientsText: string | null = null
    const metafieldPattern = /<span\s+class="metafield-multi_line_text_field">([\s\S]*?)<\/span>/gi
    let metaMatch: RegExpExecArray | null
    while ((metaMatch = metafieldPattern.exec(html)) !== null) {
      const text = stripHtml(metaMatch[1]).trim()
      // INCI lists are comma-separated with many items (typically 5+)
      const commaCount = (text.match(/,/g) || []).length
      if (commaCount >= 4 && text.length > 30) {
        ingredientsText = text
        break
      }
    }

    // Extract labels from two HTML sources on the product page:
    // 1. <span class="product-tag"> inside .porduct-tags-wrap — "free-from" claims
    //    (e.g. "Paraben-free", "Cruelty-free", "Made in the USA")
    // 2. <span> inside .product-badge-custom divs — store badges
    //    (e.g. "Bestseller", "Last Chance", "Kostenloser Versand")
    const pageLabels: string[] = []
    const seen = new Set<string>()

    // Source 1: product-tag spans
    const productTagPattern = /<span\s+class="product-tag">\s*(.*?)\s*<\/span>/gi
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = productTagPattern.exec(html)) !== null) {
      const label = stripHtml(tagMatch[1]).trim()
      if (label.length > 0 && !seen.has(label)) {
        seen.add(label)
        pageLabels.push(label)
      }
    }

    // Source 2: product-badge-custom divs — extract the <span> text inside each
    const badgePattern = /<div\s+class="product-badge-custom[^"]*"[^>]*>[\s\S]*?<span>(.*?)<\/span>[\s\S]*?<\/div>/gi
    let badgeMatch: RegExpExecArray | null
    while ((badgeMatch = badgePattern.exec(html)) !== null) {
      const label = stripHtml(badgeMatch[1]).trim()
      if (label.length > 0 && !seen.has(label)) {
        seen.add(label)
        pageLabels.push(label)
      }
    }

    // Extract description from <tabs-desktop> tab structure.
    // Each tab has a title (from <button class="tab-navigate">) and content
    // (from the matching <div class="tab-item">). We merge them into a single
    // text with tab titles as ## headlines.
    let tabDescription: string | null = null
    const tabsMatch = html.match(/<tabs-desktop[^>]*>([\s\S]*?)<\/tabs-desktop>/i)
    if (tabsMatch) {
      const tabsHtml = tabsMatch[1]

      // Extract tab titles from <button class="tab-navigate"> elements
      const titles: string[] = []
      const titlePattern = /<button[^>]*class="tab-navigate"[^>]*>\s*([\s\S]*?)\s*<\/button>/gi
      let titleMatch: RegExpExecArray | null
      while ((titleMatch = titlePattern.exec(tabsHtml)) !== null) {
        titles.push(stripHtml(titleMatch[1]).trim())
      }

      // Extract tab content: split by <div ... class="tab-item" ...> markers,
      // then convert each chunk via PURISH-specific tabContentToText().
      const contents: string[] = []
      const parts = tabsHtml.split(/<div[^>]*class="tab-item"[^>]*>/i)
      // parts[0] is the navbar section (before first tab-item), skip it
      for (let i = 1; i < parts.length; i++) {
        contents.push(tabContentToText(parts[i]))
      }

      // Merge: ## Title\n\nContent for each tab
      if (titles.length > 0 && contents.length > 0) {
        const sections: string[] = []
        for (let i = 0; i < titles.length; i++) {
          const title = titles[i]
          const content = (contents[i] || '').trim()
          if (title && content) {
            sections.push(`## ${title}\n\n${content}`)
          }
        }
        if (sections.length > 0) {
          tabDescription = sections.join('\n\n')
        }
      }
    }

    // Extract variant availability and full variant list from productJson
    const variantAvailability = new Map<number, boolean>()
    const allVariants: PageJsonVariant[] = []
    let productAvailable: boolean | null = null
    const productJson = parseProductJson(html)
    if (productJson) {
      if (typeof productJson.available === 'boolean') {
        productAvailable = productJson.available
      }
      if (Array.isArray(productJson.variants)) {
        for (const v of productJson.variants) {
          if (typeof v.id === 'number' && typeof v.available === 'boolean') {
            variantAvailability.set(v.id, v.available)
            allVariants.push({
              id: v.id,
              title: v.title ?? '',
              option1: v.option1 ?? null,
              option2: v.option2 ?? null,
              option3: v.option3 ?? null,
              barcode: v.barcode ?? null,
              sku: v.sku ?? null,
              available: v.available,
            })
          }
        }
      }
      log.info('Parsed productJson', { variants: allVariants.length, productAvailable })
    }

    return { ingredientsText, variantAvailability, productAvailable, allVariants, pageLabels, tabDescription }
  } catch {
    return empty
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

/** Parse amount and unit from product body_html (e.g. "Size: 0.22 g" or "Größe: 100 ml") */
function parseAmountFromDescription(bodyHtml: string): { amount: number; amountUnit: string } | null {
  const text = stripHtml(bodyHtml)
  const match = text.match(/(?:size|größe)\s*:\s*(\d+(?:[.,]\d+)?)\s*(ml|g|kg|l|oz|stk|stück|pcs)/i)
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
    log.warn('Failed to parse searchResultsJson', { error: String(e) })
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
    const { url, onProduct, onProgress, delay = 2000, logger } = options
    const maxPages = options.maxPages ?? 100
    let pagesUsed = 0

    // Resume from progress if provided
    let progress = options.progress as PurishDiscoveryProgress | undefined
    if (!progress) {
      const handles = await discoverCollectionHandles(url)
      if (handles.length === 0) {
        log.warn('No collections found', { url })
        return { done: true, pagesUsed: 0 }
      }
      progress = { collectionHandles: handles, currentIndex: 0, currentPage: 1 }
    }

    while (progress.currentIndex < progress.collectionHandles.length && pagesUsed < maxPages) {
      const handle = progress.collectionHandles[progress.currentIndex]
      const apiUrl = `${BASE_URL}/collections/${handle}/products.json?limit=250&page=${progress.currentPage}`
      log.info('Fetching collection products', { url: apiUrl })

      const res = await stealthFetch(apiUrl)
      if (!res.ok) {
        log.warn('Failed to fetch collection', { handle, page: progress.currentPage, status: res.status })
        progress.currentIndex++
        progress.currentPage = 1
        continue
      }

      const data = await res.json() as { products: ShopifyProduct[] }
      pagesUsed++
      logger?.event('discovery.page_scraped', { source: 'purish', page: progress.currentPage, products: data.products?.length ?? 0 })

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
        const discovered: DiscoveredProduct = {
          productUrl: normalizeProductUrl(productUrl(product.handle)),
          gtin: defaultVariant?.barcode || undefined,
          brandName: product.vendor || undefined,
          name: product.title,
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
    const { query, maxResults = 50, logger } = options
    const products: DiscoveredProduct[] = []

    // Use the full search page instead of the suggest API — the suggest API
    // doesn't support GTIN searches, but the website search works for both
    // text queries and barcodes. Results are embedded as `searchResultsJson`
    // in the page HTML (~24 products per page, paginated via &page=N).
    let page = 1
    while (products.length < maxResults) {
      const searchUrl = `${BASE_URL}/search?q=${encodeURIComponent(query)}&type=product&page=${page}`
      log.info('Searching products', { url: searchUrl })

      const res = await stealthFetch(searchUrl)
      if (!res.ok) {
        log.warn('Search failed', { status: res.status })
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
          category: p.type || undefined,
        })
      }

      // Shopify search pages show ~24 products per page
      if (found.length < 24) break
      page++
      await jitteredDelay(1000)
    }

    logger?.event('search.source_complete', { source: 'purish', query, results: products.length })
    return { products }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean; logger?: import('@/lib/logger').Logger; skipReviews?: boolean },
  ): Promise<ScrapedProductData | null> {
    const logger = options?.logger
    const scrapeStartMs = Date.now()
    logger?.event('scraper.started', { url: sourceUrl, source: 'purish' })

    // Extract handle and optional variant ID from URL
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
      log.warn('Could not extract handle from URL', { url: sourceUrl })
      logger?.event('scraper.failed', { url: sourceUrl, source: 'purish', error: 'No handle in URL', reason: 'no_handle' })
      return null
    }
    const requestedVariantId = parsed.searchParams.get('variant')

    const apiUrl = `${BASE_URL}/products/${handle}.json`
    log.info('Fetching product', { url: apiUrl })

    const res = await stealthFetch(apiUrl)
    if (!res.ok) {
      log.warn('Failed to fetch product', { url: apiUrl, status: res.status })
      logger?.event('scraper.failed', { url: sourceUrl, source: 'purish', error: 'API error', status: res.status })
      return null
    }

    const data = await res.json() as { product: ShopifyProduct }
    const product = data.product
    if (!product) {
      log.warn('No product in response', { handle })
      logger?.event('scraper.failed', { url: sourceUrl, source: 'purish', error: 'No product in response', reason: 'no_product' })
      return null
    }

    // Find the selected variant: match by ?variant= param from URL, fall back to first
    const selectedVariant = (requestedVariantId
      ? product.variants.find((v) => String(v.id) === requestedVariantId)
      : null) ?? product.variants[0]
    const gtin = selectedVariant?.barcode || undefined
    const priceCents = priceToCents(selectedVariant?.price)
    const amountInfo = (selectedVariant ? parseAmountFromVariant(selectedVariant) : null)
      ?? parseAmountFromDescription(product.body_html || '')

    // Per-unit price: try Shopify's unit_price_measurement (rarely populated on PURISH).
    // The persist layer computes a fallback from price + amount when missing.
    let perUnitAmount: number | undefined
    let perUnitQuantity: number | undefined
    let perUnitUnit: string | undefined
    if (selectedVariant?.unit_price_measurement) {
      const upm = selectedVariant.unit_price_measurement
      perUnitAmount = priceToCents(selectedVariant.unit_price)
      perUnitQuantity = upm.reference_value
      perUnitUnit = upm.reference_unit
    }

    // Fetch product page HTML for ingredients, variant availability, labels, and tab description
    const pageData = await fetchProductPageData(handle)

    // Description: prefer tab-structured description from page HTML (contains all
    // product tabs as ## headlines with content), fall back to body_html from JSON API
    const description = pageData.tabDescription || bodyHtmlToMarkdown(product.body_html || '')
    const ingredientsText = pageData.ingredientsText

    // Images: group by variant using position-based block detection.
    //
    // Shopify stores images sorted by position. Each variant has exactly one "tagged"
    // image (variant_ids contains the variant ID) — this is the hero image that starts
    // a contiguous block. Untagged images (variant_ids=[]) immediately after a tagged
    // image belong to that same variant's block. Images after the last variant block
    // are shared/product-level images shown for all variants.
    //
    // Example with 6 variants and 38 images:
    //   pos 1 [tagged V1], pos 2-6 [untagged] → V1's block (6 images)
    //   pos 7 [tagged V2], pos 8-12 [untagged] → V2's block (6 images)
    //   ...
    //   pos 37-38 [untagged, no more tagged after] → shared images (2 images)
    //   Variant V6 gets: 6 own + 2 shared = 8 images (matches storefront)
    const images = getVariantImages(product.images, selectedVariant?.id ?? null)

    // Variants: Use productJson from page HTML as primary source — it includes ALL variants
    // (available + unavailable), while the .json API may only return available ones.
    // Fall back to .json API variants if productJson didn't yield any.
    // Build SKU map from .json API variants (always have sku) for backfill
    const skuById = new Map(product.variants.map((v) => [v.id, v.sku || null]))

    const variantSource: Array<{
      id: number; title: string; option1: string | null; option2: string | null; option3: string | null;
      barcode: string | null; sku: string | null; available?: boolean
    }> = pageData.allVariants.length > 0
      ? pageData.allVariants.map((v) => ({
          ...v,
          sku: v.sku ?? skuById.get(v.id) ?? null, // productJson sku first, then .json API fallback
        }))
      : product.variants.map((v) => ({
          id: v.id, title: v.title, option1: v.option1, option2: v.option2, option3: v.option3,
          barcode: v.barcode, sku: v.sku || null, available: undefined,
        }))

    const variants: ScrapedProductData['variants'] = []
    if (product.options.length > 0 && variantSource.length > 1) {
      for (const option of product.options) {
        if (option.name === 'Title' && option.values.length === 1 && option.values[0] === 'Default Title') {
          continue // Skip the "Default Title" pseudo-option
        }
        const optionIndex = option.position // 1-based
        const optionValues = variantSource.map((v) => {
          const optVal = optionIndex === 1 ? v.option1 : optionIndex === 2 ? v.option2 : v.option3
          return {
            label: optVal || v.title,
            value: normalizeVariantUrl(`${BASE_URL}/products/${handle}?variant=${v.id}`),
            gtin: v.barcode || null,
            isSelected: v.id === selectedVariant?.id,
            availability: v.available != null ? (v.available ? 'available' as const : 'unavailable' as const) : undefined,
            sourceArticleNumber: String(v.id),
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

    // Labels: scraped directly from the product page HTML (product-tag spans + badge divs).
    // Taken as-is — no filtering, no normalization.
    const labels = pageData.pageLabels

    // Category breadcrumbs from product_type
    const categoryBreadcrumbs = product.product_type ? [product.product_type] : undefined

    // Canonical URL includes ?variant= so the crawled source-variant gets a unique URL
    const canonicalUrl = selectedVariant
      ? `${productUrl(handle)}?variant=${selectedVariant.id}`
      : productUrl(handle)

    // Product-level availability: use the selected variant's availability from productJson
    const selectedAvail = selectedVariant ? pageData.variantAvailability.get(selectedVariant.id) : null
    const productAvailability: 'available' | 'unavailable' | undefined =
      selectedAvail != null
        ? (selectedAvail ? 'available' : 'unavailable')
        : (pageData.productAvailable != null
            ? (pageData.productAvailable ? 'available' : 'unavailable')
            : undefined)

    // Fetch reviews from Yotpo (uses Shopify product ID, skip if requested)
    const yotpo = options?.skipReviews
      ? { reviews: [], averageScore: null, totalReviews: 0 }
      : await fetchPurishReviews(String(product.id))

    const scrapeDurationMs = Date.now() - scrapeStartMs
    logger?.event('scraper.product_scraped', { url: sourceUrl, source: 'purish', name: product.title, variants: variants.length, durationMs: scrapeDurationMs, images: images.length, hasIngredients: !!ingredientsText, reviews: yotpo.reviews.length, rating: yotpo.averageScore ?? 0 })

    // Brand URL: Shopify collections page for the vendor
    // Shopify handles strip special characters and collapse multiple hyphens
    const brandUrl = product.vendor
      ? `${BASE_URL}/collections/${product.vendor.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
      : undefined

    return {
      gtin,
      name: product.title,
      brandName: product.vendor || undefined,
      brandUrl,
      description: description || undefined,
      ingredientsText: ingredientsText || undefined,
      priceCents,
      currency: 'EUR',
      amount: amountInfo?.amount,
      amountUnit: amountInfo?.amountUnit,
      images,
      variants,
      labels: labels.length > 0 ? labels : undefined,
      sourceArticleNumber: selectedVariant ? String(selectedVariant.id) : undefined,
      sourceProductArticleNumber: String(product.id),
      categoryBreadcrumbs,
      canonicalUrl,
      perUnitAmount,
      perUnitQuantity,
      perUnitUnit,
      rating: yotpo.averageScore ?? undefined,
      ratingCount: yotpo.totalReviews || undefined,
      availability: productAvailability,
      warnings: [],
      reviews: yotpo.reviews.length > 0 ? yotpo.reviews : undefined,
    }
  },
}
