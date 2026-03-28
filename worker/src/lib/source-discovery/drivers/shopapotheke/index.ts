import { createLogger } from '@/lib/logger'
import type { Logger } from '@/lib/logger'
import { stealthFetch } from '@/lib/stealth-fetch'
import { normalizeProductUrl } from '@/lib/source-product-queries'
import type {
  SourceDriver,
  ProductDiscoveryOptions,
  ProductDiscoveryResult,
  ProductSearchOptions,
  ProductSearchResult,
  ScrapedProductData,
  DiscoveredProduct,
} from '../../types'

const log = createLogger('ShopApotheke')

// ─── JSON-LD types ──────────────────────────────────────────────────────────

interface JsonLdOffer {
  price?: number | string
  priceCurrency?: string
  availability?: string
  eligibleQuantity?: {
    name?: string
  }
}

interface JsonLdSimilar {
  sku?: string
  url?: string
  name?: string
  offers?: JsonLdOffer
}

interface JsonLdProduct {
  '@type': string
  name?: string
  brand?: string
  sku?: string
  image?: string
  description?: string
  offers?: JsonLdOffer
  isSimilarTo?: JsonLdSimilar[]
  aggregateRating?: {
    ratingValue?: number
    ratingCount?: number
    bestRating?: number
  }
}

interface JsonLdWebPage {
  '@type': string
  mainEntity?: JsonLdProduct
}

interface JsonLdBreadcrumbItem {
  name?: string
  position?: number
}

interface JsonLdBreadcrumbList {
  '@type': string
  itemListElement?: JsonLdBreadcrumbItem[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip query params from a Shop Apotheke URL */
function toCanonicalUrl(url: string): string {
  try {
    const u = new URL(url)
    u.search = ''
    return u.toString()
  } catch {
    return url
  }
}

/** Parse amount and unit from a string like "9.5 g", "100,5 ml", "60 St", "2x60 St" */
function parseAmount(text: string): { amount: number; amountUnit: string } | null {
  if (!text) return null
  // Handle "NxM unit" patterns (e.g. "2x60 St" → 120 St)
  const multiMatch = text.match(/(\d+)\s*x\s*(\d+)\s*(mg|g|kg|ml|l|St\.?|Stück)/i)
  if (multiMatch) {
    const amount = parseInt(multiMatch[1], 10) * parseInt(multiMatch[2], 10)
    const unit = normalizeUnit(multiMatch[3])
    return { amount, amountUnit: unit }
  }
  const match = text.match(/([\d.,]+)\s*(mg|g|kg|ml|l|St\.?|Stück)/i)
  if (!match) return null
  const amount = parseFloat(match[1].replace(',', '.'))
  const unit = normalizeUnit(match[2])
  if (isNaN(amount)) return null
  return { amount, amountUnit: unit }
}

/** Normalize unit abbreviations (St./St → Stück) */
function normalizeUnit(unit: string): string {
  if (/^St\.?$/i.test(unit)) return 'Stück'
  return unit
}

/** Decode HTML entities in a string (no tag stripping) */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
}

/** Extract plain text from HTML-tagged content */
function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Parse all JSON-LD blocks from HTML */
function parseJsonLdBlocks(html: string): unknown[] {
  const results: unknown[] = []
  const regex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(html)) !== null) {
    try {
      results.push(JSON.parse(match[1]))
    } catch {
      // skip malformed blocks
    }
  }
  return results
}

// ─── Reviews (API-based) ────────────────────────────────────────────────────

const REVIEW_API = 'https://www.shop-apotheke.com/homeone/api/bully/product-review/v1/de/com/variants'

interface SaReview {
  reviewId?: string
  message?: string
  rating?: number
  title?: string
  customer?: { author?: string }
  submissionDate?: string
  upid?: string
}

interface SaReviewResponse {
  summary?: { variant_code?: string; ratingCount?: number; averageRating?: number }
  page?: number
  pageSize?: number
  totalItems?: number
  reviews?: SaReview[]
}

/**
 * Fetch all reviews for a Shop Apotheke product via the internal review API.
 * Uses stealthFetch — no browser needed.
 *
 * The review key is the PF variant code (e.g. "PF01693052"), extracted from
 * the product page HTML pattern: "variant_code":"PFxxxxxx","variants"
 *
 * API: /homeone/api/bully/product-review/v1/de/com/variants/{pfCode}/reviews
 * Pagination: page=N (1-based), pageSize=5 (MUST be 5, other values return empty)
 *
 * @param reviewKey - Either a PF variant code directly, or a product URL (will fetch page to extract PF code)
 * @param jlog - Optional logger
 */
export async function fetchShopApothekeReviews(
  reviewKey: string,
  jlog?: Logger | typeof log,
): Promise<ScrapedProductData['reviews']> {
  const l = jlog || log
  const reviews: NonNullable<ScrapedProductData['reviews']> = []

  try {
    // Determine the PF variant code
    let pfCode = reviewKey
    if (!pfCode.startsWith('PF')) {
      // reviewKey is a URL — fetch the page and extract the PF code
      l.info('Fetching product page to extract PF code', { url: reviewKey })
      const pageRes = await stealthFetch(reviewKey)
      if (!pageRes.ok) {
        l.warn('Failed to fetch product page for PF code', { url: reviewKey, status: pageRes.status })
        return undefined
      }
      const html = await pageRes.text()
      // Extract: "variant_code":"PFxxxxxx","variants" — the product's own code (not siblings)
      const pfMatch = html.match(/\\?"variant_code\\?":\\?"(PF\d+)\\?"[,}]\\?"variants\\?"/)
      if (!pfMatch) {
        l.warn('No PF variant code found in page', { url: reviewKey })
        return undefined
      }
      pfCode = pfMatch[1]
      l.info('Extracted PF code', { pfCode, url: reviewKey })
    }

    // Paginate through reviews (pageSize MUST be 5)
    let page = 1
    let totalItems = Infinity

    while ((page - 1) * 5 < totalItems) {
      const url = `${REVIEW_API}/${pfCode}/reviews?page=${page}&pageSize=5&channel=direct`
      const res = await stealthFetch(url, {
        headers: { 'Accept': 'application/json' },
      })
      if (!res.ok) {
        l.warn('Review API returned non-OK', { status: res.status, pfCode, page })
        break
      }

      const data = await res.json() as SaReviewResponse
      totalItems = data.totalItems ?? 0
      const items = data.reviews ?? []
      if (items.length === 0) break

      for (const r of items) {
        reviews.push({
          externalId: r.reviewId || `sa_${r.customer?.author}_${r.submissionDate}`.replace(/\s+/g, '_').toLowerCase(),
          rating: (r.rating ?? 0) * 2, // 1-5 → 0-10 scale
          title: r.title || undefined,
          reviewText: r.message || undefined,
          userNickname: r.customer?.author || undefined,
          submittedAt: r.submissionDate || undefined,
        })
      }

      page++
    }

    l.info('Reviews fetched', { pfCode, count: reviews.length, totalItems })
  } catch (e) {
    l.warn('Review fetch failed', { reviewKey, error: String(e) })
  }

  return reviews.length > 0 ? reviews : undefined
}

// ─── Driver ─────────────────────────────────────────────────────────────────

export const shopApothekeDriver: SourceDriver = {
  slug: 'shopapotheke',
  label: 'Shop Apotheke',
  hosts: ['www.shop-apotheke.com', 'shop-apotheke.com'],

  logoSvg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 24" fill="none"><text x="0" y="18" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="16" fill="#E31937">Shop Apotheke</text></svg>',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname
      return this.hosts.includes(hostname)
    } catch {
      return false
    }
  },

  async discoverProducts(_options: ProductDiscoveryOptions): Promise<ProductDiscoveryResult> {
    throw new Error('Shop Apotheke discovery not yet implemented')
  },

  async searchProducts(options: ProductSearchOptions): Promise<ProductSearchResult> {
    const { query, maxResults = 50, isGtinSearch, logger } = options
    const jlog = logger || log
    const products: DiscoveredProduct[] = []
    const seenUrls = new Set<string>()

    jlog.info('Searching Shop Apotheke', { query, maxResults, isGtinSearch })

    let page = 1
    while (products.length < maxResults) {
      const searchUrl = `https://www.shop-apotheke.com/search.htm?q=${encodeURIComponent(query)}&i=${page}`
      const res = await stealthFetch(searchUrl)
      if (!res.ok) {
        jlog.warn('Search fetch failed', { url: searchUrl, status: res.status })
        break
      }
      const html = await res.text()

      // Extract search result entries
      const entryRegex = /<li data-qa-id="result-list-entry">([\s\S]*?)<\/li>/gi
      let entryMatch: RegExpExecArray | null
      let foundOnPage = 0

      while ((entryMatch = entryRegex.exec(html)) !== null) {
        const entry = entryMatch[1]

        // Product URL from title link
        const hrefMatch = entry.match(/data-qa-id="serp-result-item-title"\s+href="([^"]+)"/)
        if (!hrefMatch) continue
        const rawHref = decodeEntities(hrefMatch[1])
        // Strip tracking query params — keep only the path
        const cleanHref = rawHref.split('?')[0]
        const productUrl = normalizeProductUrl(
          cleanHref.startsWith('http') ? cleanHref : `https://www.shop-apotheke.com${cleanHref}`,
        )
        if (seenUrls.has(productUrl)) continue

        // For GTIN search: check if PZN/EAN in this entry matches the query
        if (isGtinSearch) {
          // Match "PZN/EAN: 01580241/4150015802413" or "PZN: 13984512" or just check URL SKU
          const pznEanMatch = entry.match(/(?:PZN\/EAN|PZN|EAN)[^0-9]*([0-9][0-9/]*)/)
          const urlSkuMatch = cleanHref.match(/\/([^/]+)\/[^/]+\.htm$/)
          const identifiers: string[] = []
          if (pznEanMatch) {
            identifiers.push(...pznEanMatch[1].split('/').map(s => s.trim()))
          }
          if (urlSkuMatch) {
            identifiers.push(urlSkuMatch[1])
          }
          const queryNormalized = query.replace(/^0+/, '')
          if (!identifiers.some(id => id === query || id.replace(/^0+/, '') === queryNormalized)) continue
        }

        seenUrls.add(productUrl)

        // Product name from title link text
        const nameMatch = entry.match(/data-qa-id="serp-result-item-title"[^>]*>([^<]+)</)
        const name = nameMatch ? decodeEntities(nameMatch[1].trim()) : undefined

        // Rating: count filled star icons
        const filledStars = (entry.match(/rating__icon_filled/g) || []).length
        const rating = filledStars > 0 ? filledStars : undefined

        // Rating count from review-count
        const ratingCountMatch = entry.match(/data-qa-id="review-count">\((\d+)\)</)
        const ratingCount = ratingCountMatch ? parseInt(ratingCountMatch[1], 10) : undefined

        // Brand name: from the manufacturer in list items (third li after PZN/EAN)
        // The list has: "20 g | Salbe", "PZN/EAN: ...", "Bayer Vital GmbH"
        const brandMatch = entry.match(/<li class="[^"]*text-dark-primary-strong[^"]*">([^<]+)<\/li>/g)
        let brandName: string | undefined
        if (brandMatch) {
          // Last text-dark-primary-strong li that doesn't contain PZN/EAN
          for (const li of brandMatch) {
            const text = stripHtml(li)
            if (!text.includes('PZN') && !text.includes('EAN') && text.length > 2) {
              brandName = text
            }
          }
        }

        products.push({ productUrl, name, brandName, rating, ratingCount })
        foundOnPage++

        if (products.length >= maxResults) break
      }

      jlog.info('Search page processed', { page, found: foundOnPage, total: products.length })

      if (foundOnPage === 0) break
      page++
    }

    jlog.info('Search complete', { query, found: products.length })
    logger?.event('search.source_complete', { source: 'shopapotheke', query, results: products.length })

    return { products }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean; logger?: import('@/lib/logger').Logger; skipReviews?: boolean },
  ): Promise<ScrapedProductData | null> {
    const jlog = options?.logger ?? log

    jlog.info('Scraping product', { url: sourceUrl, source: 'shopapotheke' })

    // ── 1. Fetch page HTML ──────────────────────────────────────────────────
    const response = await stealthFetch(sourceUrl)
    if (!response.ok) {
      jlog.warn('Fetch failed', { url: sourceUrl, status: response.status, source: 'shopapotheke' })
      return null
    }
    const html = await response.text()

    // ── 2. Parse JSON-LD blocks ─────────────────────────────────────────────
    const blocks = parseJsonLdBlocks(html)

    let product: JsonLdProduct | null = null
    let breadcrumbList: JsonLdBreadcrumbList | null = null

    for (const block of blocks) {
      const b = block as Record<string, unknown>
      if (b['@type'] === 'WebPage') {
        const page = b as unknown as JsonLdWebPage
        if (page.mainEntity && (page.mainEntity as unknown as JsonLdProduct)['@type'] === 'Product') {
          product = page.mainEntity as unknown as JsonLdProduct
        }
      } else if (b['@type'] === 'Product') {
        product = b as unknown as JsonLdProduct
      } else if (b['@type'] === 'BreadcrumbList') {
        breadcrumbList = b as unknown as JsonLdBreadcrumbList
      }
    }

    if (!product) {
      jlog.warn('No Product JSON-LD found', { url: sourceUrl, source: 'shopapotheke' })
      return null
    }

    // ── 3. Canonical URL ────────────────────────────────────────────────────
    const canonicalUrl = normalizeProductUrl(toCanonicalUrl(sourceUrl))

    // ── 4. GTIN + PZN from HTML ─────────────────────────────────────────────
    // The <dt> label indicates the format:
    //   <dt>EAN</dt>         → value is just EAN ("4059729028976")
    //   <dt>PZN / EAN</dt>   → value is "01580241 / 4150015802413" (PZN + EAN)
    //   <dt>PZN</dt>         → value is just PZN ("A8000532"), no EAN available
    // PZN (Pharmazentralnummer) is an official German pharmacy identifier.
    let gtin: string | undefined
    let pzn: string | undefined
    const pznLabelMatch = html.match(/<dt[^>]*>(PZN\s*\/\s*EAN|PZN|EAN)<\/dt>/i)
    const pznLabel = pznLabelMatch?.[1]?.trim().toUpperCase() ?? ''
    const pznContent = html.match(/data-qa-id="product-attribute-pzn"[^>]*>([^<]+)</)
    if (pznContent) {
      const text = pznContent[1].trim()
      const slashParts = text.split('/')
      if (slashParts.length > 1) {
        // Two values separated by slash — EAN is the 13-digit one
        const ean = slashParts[slashParts.length - 1].trim()
        if (/^\d{13}$/.test(ean)) gtin = ean
        // First part is PZN when label includes "PZN"
        if (pznLabel.includes('PZN')) {
          const pznCandidate = slashParts[0].trim()
          if (pznCandidate) pzn = pznCandidate
        }
      } else if (pznLabel === 'PZN') {
        // Single value, label is "PZN" — value is a PZN (no EAN)
        pzn = text
      } else {
        // Single value, label is "EAN" — value is an EAN
        const eanMatch = text.match(/\b(\d{13})\b/)
        if (eanMatch) gtin = eanMatch[1]
      }
    }

    // ── 5. Name & Brand ────────────────────────────────────────────────────
    const name = decodeEntities(product.name ?? '')
    if (!name) {
      jlog.warn('No product name found', { url: sourceUrl, source: 'shopapotheke' })
      return null
    }
    // Brand: prefer HTML "Marke" section (has proper casing + brand URL), fallback to JSON-LD
    let brandName: string | undefined
    let brandUrl: string | undefined
    const brandMatch = html.match(/<dt[^>]*>Marke<\/dt>\s*<dd[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([^<]+)<\/a>/i)
    if (brandMatch) {
      brandName = brandMatch[2].trim()
      const brandHref = brandMatch[1]
      brandUrl = brandHref.startsWith('http') ? brandHref : `https://www.shop-apotheke.com${brandHref}`
    }
    if (!brandName && typeof product.brand === 'string') {
      brandName = decodeEntities(product.brand)
    }

    // ── 6. Price ───────────────────────────────────────────────────────────
    let priceCents: number | undefined
    let currency: string | undefined
    let availability: 'available' | 'unavailable' | 'unknown' = 'unknown'

    if (product.offers) {
      const offers = product.offers
      if (offers.price !== undefined && offers.price !== null) {
        const priceNum = typeof offers.price === 'string' ? parseFloat(offers.price) : offers.price
        if (!isNaN(priceNum)) {
          priceCents = Math.round(priceNum * 100)
        }
      }
      currency = offers.priceCurrency ?? 'EUR'
      if (offers.availability) {
        if (offers.availability.includes('InStock')) {
          availability = 'available'
        } else if (offers.availability.includes('OutOfStock')) {
          availability = 'unavailable'
        }
      }
    }

    // ── 7. Images ──────────────────────────────────────────────────────────
    const imageUrls = new Set<string>()
    if (product.image) {
      imageUrls.add(product.image)
    }
    // Try to find more images from HTML data-qa-id attributes
    const imgRegex =
      /data-qa-id="product-image-\d+"[^>]*>[\s\S]*?src="([^"]*cdn\.shop-apotheke\.com[^"]*)"/g
    let imgMatch: RegExpExecArray | null
    while ((imgMatch = imgRegex.exec(html)) !== null) {
      imageUrls.add(imgMatch[1])
    }
    const images = Array.from(imageUrls).map((url) => ({ url }))

    // ── 8. Description ──────────────────────────────────────────────────────
    // Extract accordion sections from the FIRST accordion-stack inside product-description.
    // Structure: <div class="accordion-stack"><div class="accordion">
    //   <div class="accordion-summary"><div class="accordion-summary__content">Title</div>...</div>
    //   <div class="accordion__transition"><div class="accordion-details"><div class="prose ...">Content</div></div></div>
    // </div>...</div>
    // Format as markdown: ## Title\n\nContent for each section.
    let description: string | undefined
    const stackMatch = html.match(/<div class="accordion-stack">([\s\S]*?)(?:<\/div>\s*<div class="accordion-stack">|<\/div>\s*<(?:footer|div[^>]*data-qa-id))/i)
    if (stackMatch) {
      const stackHtml = stackMatch[1]
      const sections: string[] = []
      // Extract each accordion: title from accordion-summary__content, content from accordion-details
      const accordionRegex = /accordion-summary__content">([^<]+)<[\s\S]*?accordion-details">([\s\S]*?)(?:<\/div>\s*<\/div>\s*<\/div>\s*(?:<\/div>|<div class="accordion))/gi
      let accMatch: RegExpExecArray | null
      while ((accMatch = accordionRegex.exec(stackHtml)) !== null) {
        const title = accMatch[1].trim().replace(/&amp;/g, '&')
        const contentHtml = accMatch[2]
        const content = stripHtml(contentHtml)
        if (title && content && content.length > 5) {
          sections.push(`## ${title}\n\n${content}`)
        }
      }
      if (sections.length > 0) {
        description = sections.join('\n\n')
      }
    }
    // Fallback: use product.description from JSON-LD if available
    if (!description && product.description) {
      const stripped = stripHtml(product.description)
      // Only use if it's more than just the product name
      if (stripped.length > 50 && stripped !== name) {
        description = stripped
      }
    }

    // ── 9. Ingredients ──────────────────────────────────────────────────────
    let ingredientsText: string | undefined
    // Look for INCI list — scan for "AQUA" or "Inhaltsstoffe" section
    const inciMatch = html.match(/Inhaltsstoffe[^:]*:?\s*<[^>]*>([\s\S]{30,2000}?)(?:<\/[^>]+>){2,}/i)
    if (inciMatch) {
      const candidate = stripHtml(inciMatch[1])
      if (candidate.length > 20) {
        ingredientsText = candidate
      }
    }
    if (!ingredientsText) {
      // Try to find AQUA block
      const aquaMatch = html.match(/(AQUA[^<]{20,1500})(?:<|$)/i)
      if (aquaMatch) {
        ingredientsText = stripHtml(aquaMatch[1]).trim()
      }
    }

    // ── 10. Amount / Unit ───────────────────────────────────────────────────
    let amount: number | undefined
    let amountUnit: string | undefined
    if (product.offers?.eligibleQuantity?.name) {
      const parsed = parseAmount(product.offers.eligibleQuantity.name)
      if (parsed) {
        amount = parsed.amount
        amountUnit = parsed.amountUnit
      }
    }
    // Fallback: HTML data-qa-id="product-attribute-package_size"
    // Structure: ...package_size">Packungsgröße<!-- -->: <span class="mr-3">9,5 g</span>
    if (!amount) {
      const pkgMatch = html.match(/data-qa-id="product-attribute-package_size"[\s\S]*?<span[^>]*>([\d.,]+\s*(?:mg|g|kg|ml|l|Stück))<\/span>/i)
      if (pkgMatch) {
        const parsed = parseAmount(pkgMatch[1].trim())
        if (parsed) {
          amount = parsed.amount
          amountUnit = parsed.amountUnit
        }
      }
    }

    // ── 10b. Per-unit price from HTML ──────────────────────────────────────
    // data-qa-id="current-variant-price-per-unit" → "65,68 € / 100 g" or "0,28 € / 1 St."
    let perUnitAmount: number | undefined
    let perUnitQuantity: number | undefined
    let perUnitUnit: string | undefined
    const perUnitMatch = html.match(/data-qa-id="current-variant-price-per-unit"[^>]*>([\d.,]+)\s*€\s*\/\s*([\d.,]*)\s*(mg|g|kg|ml|l|St\.?|Stück)/i)
    if (perUnitMatch) {
      perUnitAmount = parseFloat(perUnitMatch[1].replace(',', '.'))
      const qtyStr = perUnitMatch[2].replace(',', '.')
      perUnitQuantity = qtyStr ? parseFloat(qtyStr) : 1
      perUnitUnit = normalizeUnit(perUnitMatch[3])
    }

    // ── 11. Category breadcrumbs ────────────────────────────────────────────
    let categoryBreadcrumbs: string[] | undefined
    if (breadcrumbList?.itemListElement && breadcrumbList.itemListElement.length > 0) {
      const items = breadcrumbList.itemListElement
        .filter((item) => item.name && item.name.toLowerCase() !== 'home')
        .map((item) => decodeEntities(item.name!))
      // Skip last element (product name)
      if (items.length > 1) {
        categoryBreadcrumbs = items.slice(0, -1)
      } else if (items.length === 1) {
        categoryBreadcrumbs = items
      }
    }

    // ── 12. Source article number ────────────────────────────────────────────
    // Extract from URL path (e.g. "upm3ZWKHA" from /beauty/upm3ZWKHA/...,
    // "A8000532" from /beauty/A8000532/..., "1580241" from /arzneimittel/1580241/...).
    // This is the store-specific ID used in the URL. For some products this matches
    // the PZN — that's intentional, both fields are populated independently.
    const urlPathSku = new URL(canonicalUrl).pathname.match(/\/([^/]+)\/[^/]+\.htm$/)?.[1]
    const sourceArticleNumber = urlPathSku ?? product.sku ?? undefined

    // ── 13. Variants from isSimilarTo ────────────────────────────────────────
    const variants: ScrapedProductData['variants'] = []

    if (product.isSimilarTo && product.isSimilarTo.length > 0) {
      // Extract variant labels from HTML: each variant link has <a href="..."><ul><li>LABEL</li><li>PRICE</li>...</ul></a>
      // The first <li> contains the label (e.g. "3,5 g", "30 Medium Bronze")
      const htmlLabelMap = new Map<string, string>() // URL path → label from first <li>
      const variantLinkRegex = /<a[^>]*href="(\/[^"]*\.htm)"[^>]*>[\s\S]*?<ul[\s\S]*?<\/ul>[\s\S]*?<\/a>/gi
      let linkMatch: RegExpExecArray | null
      while ((linkMatch = variantLinkRegex.exec(html)) !== null) {
        const linkHref = linkMatch[1]
        const linkInner = linkMatch[0]
        // Extract first <li> innerText (strip tags)
        const firstLi = linkInner.match(/<li[^>]*>([\s\S]*?)<\/li>/i)
        if (firstLi) {
          const label = stripHtml(firstLi[1]).trim()
          if (label && label.length > 1) {
            htmlLabelMap.set(linkHref, label)
          }
        }
      }

      // Current product's label: from HTML variant link, package_size attribute, or eligibleQuantity
      const currentPath = new URL(canonicalUrl).pathname
      const currentPkgLabel = htmlLabelMap.get(currentPath)
        || html.match(/data-qa-id="product-attribute-package_size"[\s\S]*?<span[^>]*>([^<]+)<\/span>/i)?.[1]?.trim()
        || product.offers?.eligibleQuantity?.name

      // Build options: current product first (always selected), then siblings from isSimilarTo
      const options_list: Array<{
        label: string
        value: string | null
        gtin: string | null
        isSelected: boolean
        sourceArticleNumber: string | null
      }> = []

      // Add current product as selected variant
      options_list.push({
        label: currentPkgLabel || urlPathSku || '',
        value: canonicalUrl,
        gtin: gtin ?? null,
        isSelected: true,
        sourceArticleNumber: urlPathSku ?? null,
      })

      // Add sibling variants from isSimilarTo
      for (const similar of product.isSimilarTo) {
        // Prefer HTML label (first <li> in variant link), fall back to eligibleQuantity
        let label = ''
        let siblingUrlSku: string | null = null
        if (similar.url) {
          try {
            const path = new URL(similar.url).pathname
            label = htmlLabelMap.get(path) || ''
            siblingUrlSku = path.match(/\/([^/]+)\/[^/]+\.htm$/)?.[1] ?? null
          } catch {}
        }
        if (!label) {
          label = similar.offers?.eligibleQuantity?.name || siblingUrlSku || ''
        }
        options_list.push({
          label,
          value: similar.url ?? null,
          gtin: null,
          isSelected: false,
          sourceArticleNumber: siblingUrlSku,
        })
      }

      // Detect dimension: if any label matches a weight/volume pattern → "Größe", else "Farbe"
      const isSizeDimension = options_list.some((o) =>
        /\d+\s*(mg|g|kg|ml|l)\b/i.test(o.label),
      )
      variants.push({ dimension: isSizeDimension ? 'Größe' : 'Farbe', options: options_list })
    }

    // ── Rating from aggregateRating ───────────────────────────────────────
    const rating = product.aggregateRating?.ratingValue
    const ratingCount = product.aggregateRating?.ratingCount

    const result: ScrapedProductData = {
      name,
      brandName,
      brandUrl,
      gtin,
      pzn,
      priceCents,
      currency,
      availability,
      images,
      description,
      ingredientsText,
      amount,
      amountUnit,
      perUnitAmount,
      perUnitQuantity,
      perUnitUnit,
      rating,
      ratingCount,
      categoryBreadcrumbs,
      sourceArticleNumber,
      canonicalUrl,
      variants,
      warnings: [],
    }

    jlog.info('Product scraped', {
      url: sourceUrl,
      source: 'shopapotheke',
      name,
      variants: variants.length,
      images: images.length,
      hasIngredients: !!ingredientsText,
    })

    return result
  },
}
