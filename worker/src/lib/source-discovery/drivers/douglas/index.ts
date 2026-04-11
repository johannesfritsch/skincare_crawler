import * as cheerio from 'cheerio'
import type {
  SourceDriver,
  ProductDiscoveryOptions,
  ProductDiscoveryResult,
  ProductSearchOptions,
  ProductSearchResult,
  ScrapedProductData,
  DiscoveredProduct,
} from '../../types'
import { siteUnblockerFetch } from '@/lib/site-unblocker'
import { normalizeProductUrl } from '@/lib/source-product-queries'
import { stealthFetch } from '@/lib/stealth-fetch'
import { createLogger } from '@/lib/logger'
import type { Logger } from '@/lib/logger'

const log = createLogger('Douglas')

const BASE_URL = 'https://www.douglas.de'

// ─── BazaarVoice direct API ─────────────────────────────────────────────────

const BV_API = 'https://apps.bazaarvoice.com/bfd/v1/clients/douglas-de/api-products/cv2/resources/data/reviews.json'
const BV_TOKEN = '15804,main_site,de_DE'

interface BvReview {
  Id: string
  Rating: number
  Title?: string
  ReviewText?: string
  UserNickname?: string
  SubmissionTime?: string
  IsRecommended?: boolean | null
  TotalPositiveFeedbackCount?: number
  TotalNegativeFeedbackCount?: number
  ContextDataValues?: Record<string, { Value?: string; Id?: string }>
  SyndicationSource?: { Name?: string } | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Fetch reviews from BazaarVoice direct API (bypasses Douglas/Akamai proxy).
 * Uses stealthFetch — no browser needed.
 * Exported for use by the standalone reviews stage in fetch-reviews.ts.
 */
export async function fetchDouglasReviews(
  baseProduct: string,
  jlog?: Logger | typeof log,
): Promise<ScrapedProductData['reviews']> {
  const l = jlog || log
  const reviews: NonNullable<ScrapedProductData['reviews']> = []

  try {
    let offset = 0
    const limit = 100

    while (true) {
      const url = `${BV_API}?apiVersion=5.4&filter=productid:eq:${baseProduct}&limit=${limit}&offset=${offset}&sort=submissiontime:desc`
      const res = await stealthFetch(url, {
        headers: {
          'bv-bfd-token': BV_TOKEN,
          'Origin': 'https://www.douglas.de',
          'Referer': 'https://www.douglas.de/',
          'accept': 'application/json',
        },
      })
      if (!res.ok) {
        l.warn('BazaarVoice API returned non-OK', { status: res.status, baseProduct })
        break
      }

      const data = await res.json() as { response?: { Results?: BvReview[]; TotalResults?: number } }
      const results = data.response?.Results
      if (!results?.length) break

      for (const r of results) {
        reviews.push({
          externalId: r.Id,
          rating: r.Rating * 2, // BV 1-5 → normalize to 0-10
          title: r.Title || undefined,
          reviewText: r.ReviewText || undefined,
          userNickname: r.UserNickname || undefined,
          submittedAt: r.SubmissionTime || undefined,
          isRecommended: r.IsRecommended ?? undefined,
          positiveFeedbackCount: r.TotalPositiveFeedbackCount,
          negativeFeedbackCount: r.TotalNegativeFeedbackCount,
          reviewerAge: r.ContextDataValues?.Age?.Value || undefined,
          reviewerGender: r.ContextDataValues?.Gender?.Value || undefined,
          reviewSource: r.SyndicationSource?.Name || undefined,
        })
      }

      offset += results.length
      const total = data.response?.TotalResults ?? 0
      if (offset >= total) break
    }

    l.info('BazaarVoice reviews fetched', { baseProduct, count: reviews.length })
  } catch (e) {
    l.warn('BazaarVoice review fetch failed', { baseProduct, error: String(e) })
  }

  return reviews.length > 0 ? reviews : undefined
}

/** Extract Douglas base product code from URL: /de/p/{code}?variant=... → code */
function extractBaseProduct(url: string): string | null {
  const match = url.match(/\/de\/p\/(\d+)/)
  return match ? match[1] : null
}

/** Extract variant code from URL query param: ?variant=1166241 → 1166241 */
function extractVariantCode(url: string): string | null {
  try {
    const params = new URL(url, BASE_URL).searchParams
    return params.get('variant')
  } catch {
    return null
  }
}

/** Strip HTML tags and decode entities */
function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&bdquo;/g, '\u201E')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Check if the HTML is an Access Denied / 403 error page from Akamai. */
function isAccessDenied(html: string): boolean {
  const lower = html.slice(0, 2000).toLowerCase()
  return lower.includes('access denied') || lower.includes('<title>403')
}

// ─── HTML extraction with cheerio ───────────────────────────────────────────

/** Extract product data from fully rendered product page HTML. */
function extractProductFromHtml(html: string, variantCode: string | null) {
  const $ = cheerio.load(html)

  // ── Product name from h1 ──
  const h1 = $('h1').first().text().trim()

  // ── Brand name — from headline structure or meta ──
  // Douglas renders brand in the h1 as a separate span/link before the product name
  const brandEl = $('h1 a, [data-testid="product-headline-content"] a').first()
  const brandName = brandEl.text().trim() || undefined

  // ── Description — from accordion sections ──
  let description = ''
  const accordionHeaders = $('[data-testid*="accordion"] [role="heading"], [class*="accordion"] [role="heading"]')
  accordionHeaders.each((_, el) => {
    const heading = $(el).text().trim()
    const content = $(el).closest('[class*="accordion"]').find('[class*="contents"], [class*="content"]').first().text().trim()
    if (heading && content) {
      description += `## ${heading}\n\n${content}\n\n`
    }
  })
  description = description.trim() || undefined as any

  // ── Ingredients (INCI) — search for AQUA in text ──
  const bodyText = $('body').text()
  let ingredientsText = ''
  const aquaIdx = bodyText.indexOf('AQUA')
  if (aquaIdx >= 0) {
    const slice = bodyText.slice(aquaIdx, aquaIdx + 3000)
    const endMatch = slice.match(/\.\s*\n/)
    ingredientsText = endMatch ? slice.slice(0, endMatch.index! + 1) : slice.split('\n')[0]
  }

  // ── Price — from price container ──
  let priceCents: number | undefined
  let currency = 'EUR'
  // Try meta tag first
  const priceMeta = $('meta[itemprop="price"]').attr('content')
  if (priceMeta) {
    priceCents = Math.round(parseFloat(priceMeta) * 100)
  }
  // Fallback: find price text
  if (!priceCents) {
    const priceText = $('[class*="price"] [class*="current"], [data-testid*="price"]').first().text()
    const priceMatch = priceText.match(/(\d+)[,.](\d{2})/)
    if (priceMatch) priceCents = parseInt(priceMatch[1]) * 100 + parseInt(priceMatch[2])
  }
  const currencyMeta = $('meta[itemprop="priceCurrency"]').attr('content')
  if (currencyMeta) currency = currencyMeta

  // ── Per-unit price — from base price text ──
  let perUnitAmount: number | undefined
  let perUnitQuantity: number | undefined
  let perUnitUnit: string | undefined
  const basePriceText = $('[class*="base-price"], [class*="basePrice"]').first().text()
  const perUnitMatch = basePriceText.match(/(\d+[.,]\d+)\s*€\s*(?:je\s+)?(\d+)?\s*(ml|l|g|kg)/i)
  if (perUnitMatch) {
    perUnitAmount = parseFloat(perUnitMatch[1].replace(',', '.'))
    perUnitQuantity = perUnitMatch[2] ? parseInt(perUnitMatch[2]) : 1
    perUnitUnit = perUnitMatch[3].toLowerCase()
  }

  // ── Amount / Unit — from product info ──
  let amount: number | undefined
  let amountUnit: string | undefined
  const amountText = $('[class*="content-unit"], [class*="contentUnit"]').first().text()
  const amountMatch = amountText.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg)/i)
  if (amountMatch) {
    amount = parseFloat(amountMatch[1].replace(',', '.'))
    amountUnit = amountMatch[2].toLowerCase()
  }

  // ── Images — from multiple sources ──
  const images: Array<{ url: string; alt?: string | null }> = []
  const seenUrls = new Set<string>()
  // Try carousel images
  $('[data-testid*="carousel"] img, [class*="carousel"] img, [class*="gallery"] img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || ''
    if (src && src.includes('media.douglas.de') && !src.includes('blob.png') && !seenUrls.has(src)) {
      seenUrls.add(src)
      images.push({ url: src.replace(/&grid=true/, ''), alt: $(el).attr('alt') })
    }
  })
  // Fallback: preloaded LCP image
  if (images.length === 0) {
    $('link[rel="preload"][as="image"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      if (href && href.includes('media.douglas.de') && !seenUrls.has(href)) {
        seenUrls.add(href)
        images.push({ url: href.replace(/&grid=true/, '') })
      }
    })
  }
  // Fallback: any product images
  if (images.length === 0) {
    $('img[src*="media.douglas.de"]').each((_, el) => {
      const src = $(el).attr('src') || ''
      if (src && !src.includes('blob.png') && !src.includes('brand') && !seenUrls.has(src)) {
        seenUrls.add(src)
        images.push({ url: src.replace(/&grid=true/, ''), alt: $(el).attr('alt') })
      }
    })
  }

  // ── Variant swatches (color blobs) ──
  const variants: Array<{ code: string; label: string; isSelected: boolean }> = []
  const seenCodes = new Set<string>()
  let variantDimension = ''

  $('li[data-testid="variant-blobs-scrollable-blob"]').each((_, el) => {
    const code = $(el).attr('data-code') || ''
    if (!code || seenCodes.has(code)) return
    seenCodes.add(code)
    const ariaLabel = $(el).attr('aria-label') || ''
    const label = ariaLabel.replace(/\.\s*(DEAL|NEU|SALE|NEW)$/i, '').trim()
    const isSelected = $(el).attr('aria-selected') === 'true'
    variants.push({ code, label, isSelected })
  })
  if (variants.length > 0) variantDimension = 'Farbe'

  // ── Size variants (radio buttons) ──
  if (variants.length === 0) {
    $('input[name="sizeVariants"]').each((_, el) => {
      const code = $(el).attr('value') || ''
      if (!code || seenCodes.has(code)) return
      seenCodes.add(code)
      const wrapper = $(el).closest('[data-testid="RadioButton"]')
      const label = wrapper.find('[data-testid="variant-name"]').text().trim()
      const isSelected = $(el).is(':checked')
      variants.push({ code, label, isSelected })
    })
    if (variants.length > 0) variantDimension = 'Größe'
  }

  // ── Breadcrumbs ──
  const breadcrumbs: string[] = []
  const seenBreadcrumbs = new Set<string>()
  $('[data-testid="breadcrumb-name"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text !== 'Homepage' && !seenBreadcrumbs.has(text)) {
      seenBreadcrumbs.add(text)
      breadcrumbs.push(text)
    }
  })

  // ── Availability ──
  const availText = $('[data-testid="availability-online-stock-status"]').text().trim().toLowerCase()
  const isAvailable = availText.includes('auf lager') || availText.includes('in stock')

  // ── Rating — from BazaarVoice widget or meta ──
  let rating: number | undefined
  let ratingCount: number | undefined
  const ratingEl = $('[class*="avgRating"], [class*="rating-value"]').first().text().trim()
  if (ratingEl) {
    const parsed = parseFloat(ratingEl.replace(',', '.'))
    if (!isNaN(parsed) && parsed > 0 && parsed <= 5) rating = parsed
  }
  const reviewCountEl = $('[class*="numReviews"], [class*="review-count"]').first().text().trim()
  const reviewCountMatch = reviewCountEl.match(/(\d+)/)
  if (reviewCountMatch) ratingCount = parseInt(reviewCountMatch[1])

  // ── Labels/flags ──
  const labels: string[] = []
  $('[class*="flag"], [class*="badge"], [class*="pill"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text.length < 30) labels.push(text)
  })

  return {
    h1,
    brandName,
    description: description || undefined,
    ingredientsText: ingredientsText || undefined,
    priceCents,
    currency,
    perUnitAmount,
    perUnitQuantity,
    perUnitUnit,
    amount,
    amountUnit,
    images,
    variants,
    variantDimension,
    breadcrumbs,
    isAvailable,
    rating,
    ratingCount,
    labels,
  }
}

/** Extract product tiles from a search or category page. */
function extractProductTilesFromHtml(html: string): Array<{ href: string; brand: string; name: string }> {
  const $ = cheerio.load(html)
  const tiles: Array<{ href: string; brand: string; name: string }> = []

  $('[data-testid="product-tile"]').each((_, tile) => {
    // Skip sponsored tiles
    if ($(tile).find('[data-testid="sponsored-button"]').length > 0) return

    const link = $(tile).find('a[href*="/de/p/"]').first()
    const href = link.attr('href') || ''
    if (!href) return

    const info = $(tile).find('[data-testid="product-tile-info"]').first()
    const lines = info.text().split('\n').map(l => l.trim()).filter(Boolean)

    tiles.push({ href, brand: lines[0] || '', name: lines[1] || '' })
  })

  return tiles
}

// ─── Driver ─────────────────────────────────────────────────────────────────

export const douglasDriver: SourceDriver = {
  slug: 'douglas',
  label: 'Douglas',
  hosts: ['www.douglas.de', 'douglas.de'],
  logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 24" fill="none"><text x="0" y="18" font-family="Arial,Helvetica,sans-serif" font-weight="700" font-size="20" fill="#0B3D2C">DOUGLAS</text></svg>`,

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname
      return this.hosts.includes(hostname)
    } catch {
      return false
    }
  },

  async searchProducts(options: ProductSearchOptions): Promise<ProductSearchResult> {
    const { query, maxResults = 50, logger } = options
    const jlog = logger || log

    const products: DiscoveredProduct[] = []
    const seenBaseProducts = new Set<string>()
    let currentPage = 1

    while (products.length < maxResults) {
      const searchUrl = currentPage === 1
        ? `${BASE_URL}/de/search?q=${encodeURIComponent(query)}`
        : `${BASE_URL}/de/search?q=${encodeURIComponent(query)}&page=${currentPage}`

      jlog.info('Fetching search page via Site Unblocker', { page: currentPage, query })

      let html: string
      try {
        const resp = await siteUnblockerFetch(searchUrl)
        html = resp.body
      } catch (e) {
        jlog.warn('Search page fetch failed', { page: currentPage, error: String(e) })
        break
      }

      if (isAccessDenied(html)) {
        jlog.warn('Access denied on search page', { page: currentPage })
        break
      }

      const tiles = extractProductTilesFromHtml(html)
      if (tiles.length === 0) {
        jlog.info('No products found on search page', { page: currentPage })
        break
      }

      for (const tile of tiles) {
        if (products.length >= maxResults) break
        const fullUrl = tile.href.startsWith('http') ? tile.href : `${BASE_URL}${tile.href}`
        const baseProduct = extractBaseProduct(fullUrl)
        if (!baseProduct || seenBaseProducts.has(baseProduct)) continue
        seenBaseProducts.add(baseProduct)

        products.push({
          productUrl: normalizeProductUrl(fullUrl),
          name: tile.name || undefined,
          brandName: tile.brand || undefined,
        })
      }

      jlog.info('Search page processed', { page: currentPage, tilesOnPage: tiles.length, totalFound: products.length })

      // Check for next page
      const $ = cheerio.load(html)
      const maxPage = extractMaxPageFromHtml($)
      if (currentPage >= maxPage) break

      currentPage++
      await sleep(randomDelay(1000, 2000))
    }

    jlog.info('Douglas search complete', { query, found: products.length })
    logger?.event('search.source_complete', { source: 'douglas', query, results: products.length })
    return { products }
  },

  async discoverProducts(options: ProductDiscoveryOptions): Promise<ProductDiscoveryResult> {
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages, debug = false, logger } = options
    const savedProgress = options.progress as DouglasDiscoveryProgress | undefined
    const jlog = logger || log

    jlog.info('Starting Douglas discovery', { url, delay, maxPages: maxPages ?? 'unlimited', debug })

    const visitedUrls = new Set<string>(savedProgress?.visitedUrls ?? [])
    const seenProductUrls = new Set<string>()
    const queue: string[] = savedProgress?.queue ?? [url]
    let currentLeaf = savedProgress?.currentLeaf ?? undefined
    let pagesUsed = 0

    function budgetExhausted(): boolean {
      return maxPages !== undefined && pagesUsed >= maxPages
    }

    async function fetchPage(pageUrl: string): Promise<string | null> {
      try {
        const resp = await siteUnblockerFetch(pageUrl)
        if (isAccessDenied(resp.body)) {
          jlog.warn('Access denied on category page', { url: pageUrl })
          return null
        }
        return resp.body
      } catch (e) {
        jlog.warn('Category page fetch failed', { url: pageUrl, error: String(e) })
        return null
      }
    }

    function extractSubcategoryLinks(html: string, currentPath: string): string[] {
      const $ = cheerio.load(html)
      const currentSegments = currentPath.replace(/\/$/, '').split('/').length
      const links: string[] = []
      const seen = new Set<string>()
      $('.category-facet a[href*="/de/c/"]').each((_, el) => {
        const href = $(el).attr('href') || ''
        if (!href || href.includes('?') || seen.has(href)) return
        seen.add(href)
        const segments = href.replace(/\/$/, '').split('/').length
        if (segments > currentSegments && href !== currentPath) {
          links.push(href)
        }
      })
      return links
    }

    async function emitProducts(tiles: Array<{ href: string; brand: string; name: string }>, category: string, categoryUrl: string) {
      for (const p of tiles) {
        const fullUrl = p.href.startsWith('http') ? p.href : `${BASE_URL}${p.href}`
        const productUrl = normalizeProductUrl(fullUrl)
        if (seenProductUrls.has(productUrl)) continue
        seenProductUrls.add(productUrl)
        await onProduct({
          productUrl,
          name: p.name || undefined,
          brandName: p.brand || undefined,
          category,
          categoryUrl,
        })
      }
    }

    async function saveProgress() {
      await onProgress?.({
        queue: [...queue],
        visitedUrls: [...visitedUrls],
        currentLeaf,
      } satisfies DouglasDiscoveryProgress)
    }

    // Resume paginating a leaf if we were mid-leaf
    if (currentLeaf) {
      const { categoryUrl, category, maxPage, nextPage } = currentLeaf
      for (let pageNum = nextPage; pageNum <= maxPage; pageNum++) {
        if (budgetExhausted()) {
          currentLeaf = { ...currentLeaf, nextPage: pageNum }
          await saveProgress()
          return { done: false, pagesUsed }
        }

        const pagedUrl = `${categoryUrl}?page=${pageNum}`
        jlog.info('Resuming leaf page', { pageNum, url: pagedUrl })

        const html = await fetchPage(pagedUrl)
        pagesUsed++
        if (html) {
          const tiles = extractProductTilesFromHtml(html)
          await emitProducts(tiles, category, categoryUrl)
          jlog.info('Scraped page', { pageNum, products: tiles.length })
          logger?.event('discovery.page_scraped', { source: 'douglas', page: pageNum, products: tiles.length })
        } else {
          onError?.(pagedUrl)
        }

        await saveProgress()
      }
      currentLeaf = undefined
      await saveProgress()
    }

    // BFS loop
    while (queue.length > 0) {
      if (budgetExhausted()) break

      const currentUrl = queue.shift()!
      const canonicalUrl = currentUrl.startsWith('http') ? currentUrl : `${BASE_URL}${currentUrl}`
      const urlPath = new URL(canonicalUrl).pathname

      if (visitedUrls.has(canonicalUrl)) continue
      visitedUrls.add(canonicalUrl)

      jlog.info('Visiting category', { url: canonicalUrl })
      const html = await fetchPage(canonicalUrl)
      pagesUsed++

      if (!html) {
        onError?.(canonicalUrl)
        await saveProgress()
        continue
      }

      const childHrefs = extractSubcategoryLinks(html, urlPath)

      if (childHrefs.length > 0) {
        jlog.info('Category has subcategories', { url: canonicalUrl, children: childHrefs.length })
        for (const href of childHrefs) {
          const childUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`
          if (!visitedUrls.has(childUrl)) queue.push(childUrl)
        }
      } else {
        // Leaf: paginate products
        const $ = cheerio.load(html)
        const category = extractBreadcrumbFromHtml($)
        const maxPage = extractMaxPageFromHtml($)

        jlog.info('Leaf category', { url: canonicalUrl, category, maxPage })

        // Scrape page 1 (already loaded)
        const tiles = extractProductTilesFromHtml(html)
        await emitProducts(tiles, category, canonicalUrl)
        jlog.info('Scraped page', { pageNum: 1, products: tiles.length })
        logger?.event('discovery.page_scraped', { source: 'douglas', page: 1, products: tiles.length })

        // Paginate remaining pages
        for (let pageNum = 2; pageNum <= maxPage; pageNum++) {
          if (budgetExhausted()) {
            currentLeaf = { categoryUrl: canonicalUrl, category, maxPage, nextPage: pageNum }
            await saveProgress()
            return { done: false, pagesUsed }
          }

          const pagedUrl = `${canonicalUrl}?page=${pageNum}`
          jlog.info('Navigating to page', { pageNum, url: pagedUrl })

          const pageHtml = await fetchPage(pagedUrl)
          pagesUsed++
          if (pageHtml) {
            const pageTiles = extractProductTilesFromHtml(pageHtml)
            await emitProducts(pageTiles, category, canonicalUrl)
            jlog.info('Scraped page', { pageNum, products: pageTiles.length })
            logger?.event('discovery.page_scraped', { source: 'douglas', page: pageNum, products: pageTiles.length })
          } else {
            onError?.(pagedUrl)
          }

          await saveProgress()
        }
      }

      await saveProgress()
      await sleep(randomDelay(delay, delay + 1500))
    }

    const done = queue.length === 0 && !currentLeaf
    jlog.info('Discovery tick done', { pagesUsed, done })
    return { done, pagesUsed }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean; logger?: Logger; skipReviews?: boolean },
  ): Promise<ScrapedProductData | null> {
    const jlog = options?.logger || log

    const baseProduct = extractBaseProduct(sourceUrl)
    if (!baseProduct) {
      jlog.error('Could not extract base product code from URL', { url: sourceUrl })
      return null
    }
    const variantCode = extractVariantCode(sourceUrl)

    jlog.info('Scraping Douglas product via Site Unblocker', { url: sourceUrl, baseProduct, variantCode })

    // ── Step 1: Fetch product page via Site Unblocker ──
    const productUrl = variantCode
      ? `${BASE_URL}/de/p/${baseProduct}?variant=${variantCode}`
      : `${BASE_URL}/de/p/${baseProduct}`

    let html: string
    try {
      const resp = await siteUnblockerFetch(productUrl)
      html = resp.body
    } catch (e) {
      jlog.error('Failed to fetch product page', { url: productUrl, error: String(e) })
      return null
    }

    if (isAccessDenied(html)) {
      jlog.warn('Access denied on product page', { url: productUrl })
      return null
    }

    // ── Step 2: Parse HTML with cheerio ──
    const data = extractProductFromHtml(html, variantCode)

    if (!data.h1 || data.h1.length < 2) {
      jlog.warn('Could not extract product name from page', { url: productUrl })
      return null
    }

    // ── Step 3: Build ScrapedProductData ──
    const name = data.h1

    // Brand URL from brand name
    const brandUrl = data.brandName
      ? `${BASE_URL}/de/b/${encodeURIComponent(data.brandName.toLowerCase().replace(/\s+/g, '-').replace(/&/g, ''))}`
      : undefined

    // Availability
    const availability: 'available' | 'unavailable' | 'unknown' = data.isAvailable
      ? 'available'
      : 'unknown'

    // Category breadcrumbs (drop the last one which is the product name)
    const categoryBreadcrumbs = data.breadcrumbs.length > 1
      ? data.breadcrumbs.slice(0, -1)
      : data.breadcrumbs

    // Selected variant code
    const selectedDomCode = data.variants.find(v => v.isSelected)?.code
    const currentVariantCode = variantCode || selectedDomCode

    // Canonical URL
    const effectiveVariantCode = variantCode || (data.variants.length > 0 ? currentVariantCode : undefined)
    const canonicalUrl = effectiveVariantCode
      ? `${BASE_URL}/de/p/${baseProduct}?variant=${effectiveVariantCode}`
      : `${BASE_URL}/de/p/${baseProduct}`

    // Build variant options
    const variants: ScrapedProductData['variants'] = []
    if (data.variants.length > 0) {
      const variantOptions = data.variants.map(v => ({
        label: v.label,
        value: `${BASE_URL}/de/p/${baseProduct}?variant=${v.code}`,
        gtin: null as string | null,
        isSelected: v.isSelected || v.code === variantCode,
        sourceArticleNumber: v.code,
      }))
      variants.push({ dimension: data.variantDimension || 'Variante', options: variantOptions })
    }

    const result: ScrapedProductData = {
      name,
      brandName: data.brandName,
      brandUrl,
      description: data.description,
      ingredientsText: data.ingredientsText,
      priceCents: data.priceCents,
      currency: data.currency,
      amount: data.amount,
      amountUnit: data.amountUnit,
      perUnitAmount: data.perUnitAmount,
      perUnitQuantity: data.perUnitQuantity,
      perUnitUnit: data.perUnitUnit,
      images: data.images,
      variants,
      labels: data.labels,
      rating: data.rating,
      ratingCount: data.ratingCount,
      sourceArticleNumber: currentVariantCode,
      sourceProductArticleNumber: baseProduct,
      categoryBreadcrumbs,
      canonicalUrl,
      availability,
      warnings: [],
    }

    // ── Step 4: Fetch reviews from BazaarVoice ──
    if (!options?.skipReviews) {
      result.reviews = await fetchDouglasReviews(baseProduct, jlog)
    }

    jlog.info('Product scraped successfully', {
      url: sourceUrl,
      source: 'douglas',
      name: result.name,
      variants: data.variants.length,
      hasIngredients: !!result.ingredientsText,
      images: data.images.length,
    })
    options?.logger?.event('scraper.product_scraped', {
      url: sourceUrl,
      source: 'douglas',
      name: result.name,
      variants: data.variants.length,
      durationMs: 0,
      images: data.images.length,
      hasIngredients: !!result.ingredientsText,
    })

    return result
  },
}

// ─── Discovery progress type ────────────────────────────────────────────────

interface DouglasDiscoveryProgress {
  queue: string[]
  visitedUrls: string[]
  currentLeaf?: {
    categoryUrl: string
    category: string
    maxPage: number
    nextPage: number
  }
}

// ─── Cheerio helpers ────────────────────────────────────────────────────────

function extractMaxPageFromHtml($: cheerio.CheerioAPI): number {
  let max = 1
  $('[data-testid="pagination-title-link"]').each((_, el) => {
    const match = $(el).text().match(/von\s+(\d+)/)
    if (match) {
      const num = parseInt(match[1], 10)
      if (num > max) max = num
    }
  })
  return max
}

function extractBreadcrumbFromHtml($: cheerio.CheerioAPI): string {
  const parts: string[] = []
  const seen = new Set<string>()
  $('[data-testid="breadcrumb-name"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text !== 'Homepage' && !seen.has(text)) {
      seen.add(text)
      parts.push(text)
    }
  })
  return parts.join(' -> ')
}
