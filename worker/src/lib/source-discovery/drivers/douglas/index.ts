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
function extractProductFromHtml(html: string, baseProductCode: string, variantCode: string | null) {
  const $ = cheerio.load(html)

  // ── Product name from h1 ──
  const h1 = $('h1').first().text().trim()

  // ── Brand name — from first span in h1 (before the product line link) ──
  // H1 structure: <span>Brand Category </span><a>Product Line </a><span data-testid="header-product-name">Name</span>
  const headlineContent = $('[data-testid="product-headline-content"]').first()
  const brandSpan = headlineContent.children('span').first().text().trim()
  // Brand is the first word(s) before the category word in the span
  // e.g. "Lancôme Gesichtscreme" → brand is "Lancôme"
  const brandName = brandSpan.split(/\s+/)[0] || undefined

  // ── Brand URL — from the link in h1 ──
  const brandLink = headlineContent.find('a').first()
  const brandHref = brandLink.attr('href')

  // ── Description — assembled from multiple rendered sections ──
  let description = ''

  // 1. Produktinformationen — bullet points
  const bullets = $('[data-testid="bullet-points"]').first()
  if (bullets.length) {
    const items = bullets.children().map((_, el) => $(el).text().trim()).get().filter(Boolean)
    if (items.length) {
      description += '## Produktinformationen\n\n'
      for (const item of items) description += `- ${item}\n`
      description += '\n'
    }
  }

  // 2. Produktdetails — marketing copy (h2 heading + paragraphs)
  const detailsEl = $('[data-testid="product-details-description"]').first()
  if (detailsEl.length) {
    const heading = detailsEl.find('h2').first().text().trim()
    const paragraphs = detailsEl.find('p').map((_, el) => $(el).text().trim()).get().filter(Boolean)
    if (heading || paragraphs.length) {
      description += '## Produktdetails\n\n'
      if (heading) description += `### ${heading}\n\n`
      if (paragraphs.length) description += paragraphs.join('\n\n') + '\n\n'
    }
  }

  // 3. Anwendung — from #srchOpt--application section
  const applicationEl = $('#srchOpt--application').first()
  if (applicationEl.length) {
    const appText = applicationEl.text().trim()
    if (appText.length > 10) {
      description += '## Anwendung\n\n' + appText + '\n\n'
    }
  }

  // 4. Warnhinweise — from #srchOpt--safety-information section
  const safetyEl = $('#srchOpt--safety-information').first()
  if (safetyEl.length) {
    const safetyText = safetyEl.text().trim()
    if (safetyText.length > 5) {
      description += '## Warnhinweise\n\n' + safetyText + '\n\n'
    }
  }

  // 5. Eigenschaften — from classifications (key-value pairs)
  const classifications: Array<{ label: string; value: string }> = []
  $('[data-testid="product-detail-info__classifications"] > div').each((_, el) => {
    const spans = $(el).find('span')
    if (spans.length >= 2) {
      const label = $(spans[0]).text().trim()
      const value = $(spans[1]).text().trim()
      if (label && value) classifications.push({ label, value })
    }
  })
  const propsWithoutArtNr = classifications.filter(c => c.label !== 'Art-Nr.')
  if (propsWithoutArtNr.length) {
    description += '## Eigenschaften\n\n'
    for (const c of propsWithoutArtNr) {
      description += `${c.label}: ${c.value}\n`
    }
  }
  description = description.trim() || undefined as any

  // ── Douglas article number from classifications ──
  const artNr = classifications.find(c => c.label === 'Art-Nr.')?.value

  // ── Ingredients (INCI) — extract from serialized __INITIAL_DATA_CACHE__ in script tags ──
  // Accordion content is collapsed and not in the rendered HTML.
  // INCI lists are quoted strings of comma-separated uppercase ingredient names with / separators.
  // We find all such patterns and pick the one closest to the product's base code in the HTML.
  let ingredientsText = ''
  {
    // Match any long uppercase comma-separated string that looks like an INCI list
    // (at least 8 comma-separated uppercase terms)
    const inciRegex = /"((?:[A-Z][A-Z0-9 /\\u002F.()\-]*,\s*){8,}[A-Z][A-Z0-9 /\\u002F.()\-]*)"/g
    const candidates: Array<{ text: string; index: number }> = []
    let m: RegExpExecArray | null
    while ((m = inciRegex.exec(html)) !== null) {
      candidates.push({ text: m[1], index: m.index })
    }
    if (candidates.length > 0) {
      // Find the candidate closest to the product's base code in the HTML
      const baseCodeStr = baseProductCode
      const baseIdx = html.indexOf(`"${baseCodeStr}"`)
      let best = candidates[0]
      if (baseIdx >= 0) {
        let bestDist = Math.abs(candidates[0].index - baseIdx)
        for (const c of candidates) {
          const dist = Math.abs(c.index - baseIdx)
          if (dist < bestDist) { best = c; bestDist = dist }
        }
      }
      ingredientsText = best.text.replace(/\\u002F/g, '/').trim()
    }
  }

  // ── Price — from data-testid price elements ──
  let priceCents: number | undefined
  const currency = 'EUR'
  // Try discount price first (current price when on sale), then strikethrough (original)
  const discountPrice = $('[data-testid="price-discount"]').first().text().trim()
  const regularPrice = $('[data-testid="price-type-strikethrough"]').filter((_, el) => {
    const text = $(el).text().trim()
    return /\d+,\d{2}\s*€/.test(text)
  }).first().text().trim()
  const priceText = discountPrice || regularPrice
  const priceMatch = priceText.match(/(\d+),(\d{2})/)
  if (priceMatch) {
    priceCents = parseInt(priceMatch[1]) * 100 + parseInt(priceMatch[2])
  }

  // ── Per-unit price — from data-testid="price-base-unit" ──
  let perUnitAmount: number | undefined
  let perUnitQuantity: number | undefined
  let perUnitUnit: string | undefined
  const basePriceText = $('[data-testid="price-base-unit"]').first().text().trim()
  // Pattern: "499,80 € / 1 l" or "33,17 € / 100 ml"
  const perUnitMatch = basePriceText.match(/(\d+[.,]\d+)\s*€\s*\/\s*(\d+)?\s*(ml|l|g|kg)/i)
  if (perUnitMatch) {
    perUnitAmount = Math.round(parseFloat(perUnitMatch[1].replace(',', '.')) * 100)
    perUnitQuantity = perUnitMatch[2] ? parseInt(perUnitMatch[2]) : 1
    perUnitUnit = perUnitMatch[3].toLowerCase()
  }

  // ── Images — product JPGs from media.douglas.de (not SVG logos) ──
  const images: Array<{ url: string; alt?: string | null }> = []
  const seenUrls = new Set<string>()
  // Preloaded LCP image (highest priority, always the main product image)
  $('link[rel="preload"][as="image"][data-preload-lcp]').each((_, el) => {
    const href = $(el).attr('href') || ''
    if (href && href.includes('media.douglas.de') && href.includes('.jpg') && !seenUrls.has(href)) {
      seenUrls.add(href)
      images.push({ url: href.replace(/&grid=true/, '') })
    }
  })
  // All product images (JPGs only, exclude logos/SVGs/blobs)
  $('img[src*="media.douglas.de"]').each((_, el) => {
    const src = $(el).attr('src') || ''
    if (src && src.includes('.jpg') && !src.includes('blob') && !src.includes('-svg-') && !seenUrls.has(src)) {
      seenUrls.add(src)
      images.push({ url: src.replace(/&grid=true/, ''), alt: $(el).attr('alt') })
    }
  })

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

  // ── Serialized data extraction (__INITIAL_DATA_CACHE__) ──
  // The serialized data has a consistent positional structure around the product name:
  //   [-1] "Product Name"   (from header-product-name)
  //   [+0] "EAN/GTIN"       (13-digit)
  //   [+1] "category_slug"
  //   [+2] reference
  //   [+3] "brand_code"
  //   [+4] "Product Line"   (e.g. "Nutrix")
  //   [+5] "brand_url"
  //   [+6] reference
  //   [+7..+11] benefit texts
  //   [+12] reference
  //   [+13] "Full title with amount" (e.g. "Gesichtscreme für Unisex Lancôme Nutrix Face Cream 50 ml")
  let gtin: string | undefined
  const headerProductName = $('[data-testid="header-product-name"]').first().text().trim()
  if (headerProductName) {
    const escapedName = headerProductName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Find the product name in serialized data and extract comma-separated fields after it
    const nameIdx = html.search(new RegExp(`"${escapedName}",`))
    if (nameIdx >= 0) {
      // Get a chunk after the product name and split by comma-separated quoted strings
      const afterChunk = html.slice(nameIdx, nameIdx + 3000)
      const fields = afterChunk.match(/"([^"]*?)"/g)?.map(s => s.slice(1, -1)) ?? []
      // fields[0] = product name, fields[1] = GTIN, fields[2+] = subsequent fields

      // GTIN at index 1
      if (fields[1]?.match(/^\d{13}$/)) {
        gtin = fields[1]
      }

    }
  }
  // Fallback: find a 13-digit number near the base product code
  if (!gtin) {
    const baseIdx = html.indexOf(`"${baseProductCode}"`)
    if (baseIdx >= 0) {
      const chunk = html.slice(baseIdx, baseIdx + 10000)
      const fallbackMatch = chunk.match(/"(\d{13})"/)
      if (fallbackMatch) gtin = fallbackMatch[1]
    }
  }

  // ── Amount / Unit — from variant-name element (e.g. "50 ml"), fallback to price calc ──
  let amount: number | undefined
  let amountUnit: string | undefined
  const variantNameText = $('[data-testid="variant-name"]').first().text().trim()
  const variantAmountMatch = variantNameText.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg)\b/i)
  if (variantAmountMatch) {
    amount = parseFloat(variantAmountMatch[1].replace(',', '.'))
    amountUnit = variantAmountMatch[2].toLowerCase()
  }
  if (!amount && priceCents && perUnitAmount && perUnitUnit) {
    const qty = perUnitQuantity ?? 1
    const rawAmount = (priceCents / perUnitAmount) * qty
    if (perUnitUnit === 'l' && rawAmount < 1) {
      amount = Math.round(rawAmount * 1000)
      amountUnit = 'ml'
    } else if (perUnitUnit === 'kg' && rawAmount < 1) {
      amount = Math.round(rawAmount * 1000)
      amountUnit = 'g'
    } else {
      amount = Math.round(rawAmount * 10) / 10
      amountUnit = perUnitUnit
    }
  }

  // ── Labels/flags from eyecatcher badges ──
  const labels: string[] = []
  $('[data-testid*="eyecatcher"], [data-testid*="flag"]').each((_, el) => {
    const text = $(el).text().trim()
    if (text && text.length > 1 && text.length < 30 && !labels.includes(text)) labels.push(text)
  })

  return {
    h1,
    brandName,
    brandHref: brandHref ? `${BASE_URL}${brandHref}` : undefined,
    description: description || undefined,
    artNr,
    gtin,
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
    const data = extractProductFromHtml(html, baseProduct, variantCode)

    if (!data.h1 || data.h1.length < 2) {
      jlog.warn('Could not extract product name from page', { url: productUrl })
      return null
    }

    // ── Step 3: Build ScrapedProductData ──
    const name = data.h1

    // Brand URL — prefer the actual link from the h1, fall back to constructed URL
    const brandUrl = data.brandHref || (data.brandName
      ? `${BASE_URL}/de/b/${encodeURIComponent(data.brandName.toLowerCase().replace(/\s+/g, '-').replace(/&/g, ''))}`
      : undefined)

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
      gtin: data.gtin,
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
      sourceArticleNumber: data.artNr || currentVariantCode || baseProduct,
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
