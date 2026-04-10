import type { Page } from 'playwright-core'
import type {
  SourceDriver,
  ProductDiscoveryOptions,
  ProductDiscoveryResult,
  ProductSearchOptions,
  ProductSearchResult,
  ScrapedProductData,
  DiscoveredProduct,
} from '../../types'
import { launchBrowser } from '@/lib/browser'
import { captureDebugScreenshot } from '@/lib/debug-screenshot'
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

// ─── Douglas API types ──────────────────────────────────────────────────────

interface DouglasSearchResponse {
  products?: DouglasSearchProduct[]
  pagination?: {
    pageSize: number
    currentPage: number
    totalPages: number
    totalResults: number
  }
}

interface DouglasSearchProduct {
  code: string              // variant code e.g. "1166241"
  name: string              // variant name e.g. "Nr. 100"
  url: string               // "/de/p/5011358006?variant=1166241"
  description?: string       // HTML description
  baseProduct: string       // product code e.g. "5011358006"
  baseProductName: string   // product name e.g. "SKIN Tint"
  brand?: { code: string; name: string }
  averageRating?: number    // 0-5 scale
  numberOfReviews?: number
  price?: {
    currencyIso: string
    value: number
    originalValue?: number
    discountPercentage?: number
  }
  baseContentPrice?: {
    currencyIso: string
    value: number
  }
  numberContentUnits?: number
  baseNumberContentUnits?: number
  contentUnitOfBaseNumberContentUnits?: string
  contentUnit?: string
  images?: Array<{ url: string }>
  classifications?: Array<{ name: string }>
  productFamily?: { code: string; name: string }
  variantOptions?: Array<{
    code: string
    url: string
    priceData?: { value: number; currencyIso: string }
    numberContentUnits?: number
    contentUnit?: string
  }>
  stock?: { stockLevelStatus: string }
  availability?: { code: string }
  flags?: Array<{ code: string }>
  availableColorsAmount?: number
  ean?: string
}

// ─── Discovery progress ─────────────────────────────────────────────────────

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

/** Check if the page is an Access Denied / 403 error page from Akamai. */
async function isAccessDenied(page: Page): Promise<boolean> {
  const title = await page.title()
  if (title.toLowerCase().includes('access denied') || title.toLowerCase().includes('403')) return true
  // Some Akamai blocks show the text in the body without changing the title
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 500) || '')
  return bodyText.toLowerCase().includes('access denied')
}

/** Dismiss the cookie consent banner if present. Must be called after page load. */
async function dismissCookieConsent(page: Page): Promise<void> {
  try {
    const btn = page.locator('button:has-text("Alle erlauben")')
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click({ timeout: 5000 })
      await sleep(1500)
    }
  } catch {
    // No consent banner — already dismissed or not shown
  }
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
    .replace(/&bdquo;/g, '„')
    .replace(/&ldquo;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Fetch product data via Douglas search API. Must be called from a page
 * on the Douglas homepage (not a product page) where fetch isn't blocked.
 */
async function fetchSearchProduct(
  page: Page,
  query: string,
  jlog: Logger | typeof log,
): Promise<DouglasSearchProduct | null> {
  const params = new URLSearchParams({
    fields: 'FULL',
    isApp: 'false',
    pageSize: '5',
    query,
  })
  const apiUrl = `/jsapi/v2/products/search?${params.toString()}`

  try {
    const resp: DouglasSearchResponse = await page.evaluate(async (url: string) => {
      const r = await fetch(url, {
        headers: {
          'accept': 'application/json',
          'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
        credentials: 'include',
      })
      if (!r.ok) throw new Error(`Search API returned ${r.status}`)
      return r.json()
    }, apiUrl)

    return resp.products?.[0] ?? null
  } catch (e) {
    jlog.warn('Search API call failed', { query, error: String(e) })
    return null
  }
}

/**
 * Extract product data from the product page DOM.
 * Returns ingredients, variant codes, breadcrumbs, and availability.
 */
async function extractDomData(page: Page) {
  return page.evaluate(() => {
    const body = document.body.innerText

    // ── Ingredients (INCI) ──────────────────────────────────────────────
    let ingredientsText = ''
    const aquaIdx = body.indexOf('AQUA')
    if (aquaIdx >= 0) {
      const slice = body.slice(aquaIdx, aquaIdx + 3000)
      // INCI list ends at a period followed by whitespace/newline
      const endMatch = slice.match(/\.\s*\n/)
      ingredientsText = endMatch ? slice.slice(0, endMatch.index! + 1) : slice.split('\n')[0]
    }

    // ── Variant swatches (color blobs) ──────────────────────────────────
    const variantLis = document.querySelectorAll('li[data-testid="variant-blobs-scrollable-blob"]')
    const variants: Array<{ code: string; label: string; isSelected: boolean }> = []
    const seenCodes = new Set<string>()
    let variantDimension = ''
    variantLis.forEach(li => {
      const code = li.getAttribute('data-code') || ''
      if (!code || seenCodes.has(code)) return
      seenCodes.add(code)
      const ariaLabel = li.getAttribute('aria-label') || ''
      // Strip trailing ". DEAL" or similar suffixes from aria-label
      const label = ariaLabel.replace(/\.\s*(DEAL|NEU|SALE|NEW)$/i, '').trim()
      const isSelected = li.getAttribute('aria-selected') === 'true'
      variants.push({ code, label, isSelected })
    })
    if (variants.length > 0) variantDimension = 'Farbe'

    // ── Size variants (radio buttons) ────────────────────────────────────
    // The radio input and the variant content div are in sibling spans inside
    // a shared <label> under [data-testid="RadioButton"]. We start from the
    // radio inputs and walk up to the common ancestor to find the variant name.
    if (variants.length === 0) {
      const sizeRadioInputs = document.querySelectorAll('input[name="sizeVariants"]')
      sizeRadioInputs.forEach(radio => {
        const code = (radio as HTMLInputElement).value || ''
        if (!code || seenCodes.has(code)) return
        seenCodes.add(code)
        const wrapper = radio.closest('[data-testid="RadioButton"]')
        const label = wrapper?.querySelector('[data-testid="variant-name"]')?.textContent?.trim() || ''
        const isSelected = (radio as HTMLInputElement).checked === true
        variants.push({ code, label, isSelected })
      })
      if (variants.length > 0) variantDimension = 'Größe'
    }

    // ── Breadcrumbs ─────────────────────────────────────────────────────
    const breadcrumbEls = document.querySelectorAll('[data-testid="breadcrumb-name"]')
    const breadcrumbs: string[] = []
    const seen = new Set<string>()
    breadcrumbEls.forEach(el => {
      const text = el.textContent?.trim() || ''
      // Douglas renders breadcrumbs twice (mobile + desktop) — deduplicate
      if (text && text !== 'Homepage' && !seen.has(text)) {
        seen.add(text)
        breadcrumbs.push(text)
      }
    })

    // ── Availability ────────────────────────────────────────────────────
    const availText = document.querySelector('[data-testid="availability-online-stock-status"]')?.textContent?.trim() || ''
    const isAvailable = availText.toLowerCase().includes('auf lager') || availText.toLowerCase().includes('in stock')

    // ── Product name from h1 ────────────────────────────────────────────
    const h1 = document.querySelector('h1')?.textContent?.trim() || ''

    // ── Images from carousel ────────────────────────────────────────────
    const imageEls = document.querySelectorAll('[data-testid="carousel-productpage"] img')
    const images: Array<{ url: string; alt: string | null }> = []
    const seenUrls = new Set<string>()
    imageEls.forEach(img => {
      const src = img.getAttribute('src') || ''
      if (src && src.includes('media.douglas.de') && !src.includes('blob.png') && !seenUrls.has(src)) {
        seenUrls.add(src)
        images.push({ url: src, alt: img.getAttribute('alt') })
      }
    })

    // ── EAN from React product state ──────────────────────────────────
    // The search API doesn't always return EANs. The decoded __INITIAL_DATA_CACHE__
    // is available in the React fiber tree as memoizedProps.product on the product
    // detail component. This gives us the EAN for the currently selected variant.
    let reactEan = ''
    try {
      const h1El = document.querySelector('h1')
      if (h1El) {
        let el: Element | null = h1El
        while (el) {
          const fk = Object.keys(el).find(k => k.startsWith('__reactFiber'))
          if (fk) {
            let fiber = (el as any)[fk]
            let depth = 0
            while (fiber && depth < 30) {
              try {
                const p = fiber.memoizedProps?.product
                if (p?.code && typeof p.ean === 'string' && p.ean) {
                  reactEan = p.ean
                  break
                }
              } catch {}
              fiber = fiber.return
              depth++
            }
            break
          }
          el = el.parentElement
        }
      }
    } catch {}

    return { ingredientsText, variants, variantDimension, breadcrumbs, isAvailable, h1, images, reactEan }
  })
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
    const { query, maxResults = 50, debug, logger, debugContext } = options
    const jlog = logger || log

    const browser = await launchBrowser({ headless: !debug })
    let page: Page | undefined
    try {
      const context = await browser.newContext({
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        viewport: { width: 1920, height: 1080 },
      })
      page = await context.newPage()

      // Navigate to Douglas to establish Akamai session cookies
      jlog.info('Navigating to Douglas to establish session', { url: `${BASE_URL}/de` })
      await page.goto(`${BASE_URL}/de`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await sleep(randomDelay(2000, 3000))
      if (await isAccessDenied(page)) {
        throw new Error('Access denied on Douglas homepage — Akamai blocked the request')
      }
      await dismissCookieConsent(page)

      const products: DiscoveredProduct[] = []
      const seenBaseProducts = new Set<string>()
      const pageSize = 48
      let currentPage = 0

      while (products.length < maxResults) {
        const params = new URLSearchParams({
          fields: 'FULL',
          isApp: 'false',
          pageSize: String(pageSize),
          query,
          currentPage: String(currentPage),
        })

        const apiUrl = `/jsapi/v2/products/search?${params.toString()}`
        jlog.info('Fetching search page', { page: currentPage, query })

        const resp: DouglasSearchResponse = await page.evaluate(async (url: string) => {
          const r = await fetch(url, {
            headers: {
              'accept': 'application/json',
              'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
            },
            credentials: 'include',
          })
          if (!r.ok) throw new Error(`Search API returned ${r.status}`)
          return r.json()
        }, apiUrl)

        if (!resp.products?.length) {
          jlog.info('No products in search response', { page: currentPage })
          break
        }

        for (const p of resp.products) {
          if (products.length >= maxResults) break
          // Deduplicate by baseProduct code (API returns variant-level results)
          if (seenBaseProducts.has(p.baseProduct)) continue
          seenBaseProducts.add(p.baseProduct)

          const productUrl = `${BASE_URL}/de/p/${p.baseProduct}`
          const category = p.classifications?.[0]?.name || p.productFamily?.name

          products.push({
            productUrl,
            name: p.baseProductName || p.name,
            brandName: p.brand?.name,
            rating: p.averageRating,
            ratingCount: p.numberOfReviews,
            category,
          })
        }

        jlog.info('Search page processed', {
          page: currentPage,
          resultsOnPage: resp.products.length,
          totalFound: products.length,
        })

        currentPage++
        if (currentPage >= (resp.pagination?.totalPages ?? 1)) break

        await sleep(randomDelay(1000, 2000))
      }

      if (debug) {
        jlog.info('Debug mode: browser kept open')
        await page.pause()
      }

      jlog.info('Douglas search complete', { query, found: products.length })
      logger?.event('search.source_complete', { source: 'douglas', query, results: products.length })

      return { products }
    } catch (err) {
      if (page && debugContext) {
        const screenshotUrl = await captureDebugScreenshot({
          page,
          client: debugContext.client,
          jobCollection: debugContext.jobCollection,
          jobId: debugContext.jobId,
          step: 'search-error',
          label: err instanceof Error ? err.message : String(err),
        }).catch(() => null)
        if (screenshotUrl && err instanceof Error) {
          ;(err as any).screenshotUrl = screenshotUrl
        }
      }
      throw err
    } finally {
      await browser.close()
    }
  },

  async discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult> {
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

    const browser = await launchBrowser({ headless: !debug })

    try {
      const context = await browser.newContext({
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        viewport: { width: 1920, height: 1080 },
      })
      const page = await context.newPage()

      /** Extract subcategory links that go deeper than the current URL path */
      function extractSubcategoryLinks(currentPath: string) {
        return page.$$eval(
          '.category-facet a[href*="/de/c/"]',
          (links, curPath) => {
            const currentSegments = curPath.replace(/\/$/, '').split('/').length
            const seen = new Set<string>()
            return links
              .map(a => a.getAttribute('href') || '')
              .filter(href => {
                if (!href || href.includes('?') || seen.has(href)) return false
                seen.add(href)
                // Child links have more path segments than the current URL
                const segments = href.replace(/\/$/, '').split('/').length
                return segments > currentSegments && href !== curPath
              })
          },
          currentPath,
        )
      }

      /** Extract product tiles, skipping sponsored ads */
      function extractProductTiles() {
        return page.$$eval(
          '[data-testid="product-tile"]',
          (tiles) => tiles
            .filter(tile => !tile.querySelector('[data-testid="sponsored-button"]'))
            .map(tile => {
              const link = tile.querySelector('a[href*="/de/p/"]') as HTMLAnchorElement | null
              const href = link?.getAttribute('href') || ''
              const info = tile.querySelector('[data-testid="product-tile-info"]') as HTMLElement | null
              const lines = info?.innerText?.split('\n').filter(Boolean) || []
              return { href, brand: lines[0] || '', name: lines[1] || '' }
            })
            .filter(t => t.href),
        )
      }

      /** Extract max page number from pagination "Seite N von M" */
      function extractMaxPage() {
        return page.$$eval(
          '[data-testid="pagination-title-link"]',
          (links) => {
            let max = 1
            for (const link of links) {
              const match = link.textContent?.match(/von\s+(\d+)/)
              if (match) {
                const num = parseInt(match[1], 10)
                if (num > max) max = num
              }
            }
            return max
          },
        ).catch(() => 1)
      }

      /** Extract breadcrumb category string */
      function extractBreadcrumb() {
        return page.$$eval(
          '[data-testid="breadcrumb-name"]',
          (els) => {
            const seen = new Set<string>()
            const parts: string[] = []
            els.forEach(el => {
              const text = el.textContent?.trim() || ''
              if (text && text !== 'Homepage' && !seen.has(text)) {
                seen.add(text)
                parts.push(text)
              }
            })
            return parts.join(' -> ')
          },
        )
      }

      async function emitProducts(
        products: Awaited<ReturnType<typeof extractProductTiles>>,
        category: string,
        categoryUrl: string,
      ) {
        for (const p of products) {
          // Normalize to base product URL (strip ?variant= query params)
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

      // First navigation — dismiss cookie consent once
      let consentDismissed = false
      async function ensureConsent() {
        if (!consentDismissed) {
          await dismissCookieConsent(page)
          consentDismissed = true
        }
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

          try {
            await page.goto(pagedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
            await sleep(randomDelay(2000, 3500))
            await ensureConsent()
            pagesUsed++

            const products = await extractProductTiles()
            await emitProducts(products, category, categoryUrl)
            jlog.info('Scraped page', { pageNum, products: products.length })
            logger?.event('discovery.page_scraped', { source: 'douglas', page: pageNum, products: products.length })
          } catch (e) {
            jlog.warn('Error on page', { url: pagedUrl, error: String(e) })
            onError?.(pagedUrl)
            pagesUsed++
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
        const canonicalUrl = currentUrl.startsWith('http')
          ? currentUrl
          : `${BASE_URL}${currentUrl}`
        const urlPath = new URL(canonicalUrl).pathname

        if (visitedUrls.has(canonicalUrl)) continue
        visitedUrls.add(canonicalUrl)

        try {
          jlog.info('Visiting category', { url: canonicalUrl })
          await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
          await sleep(randomDelay(2000, 3500))
          await ensureConsent()
          pagesUsed++

          // Check for child subcategories
          const childHrefs = await extractSubcategoryLinks(urlPath)

          if (childHrefs.length > 0) {
            // Non-leaf: queue children for later traversal
            jlog.info('Category has subcategories', { url: canonicalUrl, children: childHrefs.length })
            for (const href of childHrefs) {
              const childUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`
              if (!visitedUrls.has(childUrl)) {
                queue.push(childUrl)
              }
            }
          } else {
            // Leaf: paginate products
            const category = await extractBreadcrumb()
            const maxPage = await extractMaxPage()

            jlog.info('Leaf category', { url: canonicalUrl, category, maxPage })

            // Scrape page 1 (already loaded)
            const products = await extractProductTiles()
            await emitProducts(products, category, canonicalUrl)
            jlog.info('Scraped page', { pageNum: 1, products: products.length })
            logger?.event('discovery.page_scraped', { source: 'douglas', page: 1, products: products.length })

            // Paginate remaining pages
            for (let pageNum = 2; pageNum <= maxPage; pageNum++) {
              if (budgetExhausted()) {
                currentLeaf = { categoryUrl: canonicalUrl, category, maxPage, nextPage: pageNum }
                await saveProgress()
                return { done: false, pagesUsed }
              }

              const pagedUrl = `${canonicalUrl}?page=${pageNum}`
              jlog.info('Navigating to page', { pageNum, url: pagedUrl })

              try {
                await page.goto(pagedUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
                await sleep(randomDelay(2000, 3500))
                pagesUsed++

                const pageProducts = await extractProductTiles()
                await emitProducts(pageProducts, category, canonicalUrl)
                jlog.info('Scraped page', { pageNum, products: pageProducts.length })
                logger?.event('discovery.page_scraped', { source: 'douglas', page: pageNum, products: pageProducts.length })
              } catch (e) {
                jlog.warn('Error on page', { url: pagedUrl, error: String(e) })
                onError?.(pagedUrl)
                pagesUsed++
              }

              await saveProgress()
            }
          }

          await saveProgress()
        } catch (e) {
          jlog.warn('Error visiting category', { url: canonicalUrl, error: String(e) })
          onError?.(canonicalUrl)
          await saveProgress()
        }
      }

      if (debug) {
        jlog.info('Debug mode: browser kept open')
        await page.pause()
      }
    } finally {
      await browser.close()
    }

    const done = queue.length === 0 && !currentLeaf
    jlog.info('Discovery tick done', { pagesUsed, done })
    return { done, pagesUsed }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean; logger?: Logger; skipReviews?: boolean; debugContext?: { client: import('@/lib/payload-client').PayloadRestClient; jobCollection: 'product-crawls' | 'product-discoveries' | 'product-searches'; jobId: number } },
  ): Promise<ScrapedProductData | null> {
    const debug = options?.debug ?? false
    const jlog = options?.logger || log

    const baseProduct = extractBaseProduct(sourceUrl)
    if (!baseProduct) {
      jlog.error('Could not extract base product code from URL', { url: sourceUrl })
      return null
    }
    const variantCode = extractVariantCode(sourceUrl)

    jlog.info('Scraping Douglas product', { url: sourceUrl, baseProduct, variantCode })

    const browser = await launchBrowser({ headless: !debug })
    let page: Page | undefined
    try {
      const context = await browser.newContext({
        locale: 'de-DE',
        timezoneId: 'Europe/Berlin',
        viewport: { width: 1920, height: 1080 },
      })
      page = await context.newPage()

      // ── Step 1: Navigate to homepage and fetch structured data via search API ──
      jlog.info('Establishing session for API access')
      await page.goto(`${BASE_URL}/de`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await sleep(randomDelay(2000, 3000))
      if (await isAccessDenied(page)) {
        throw new Error('Access denied on Douglas homepage — Akamai blocked the request')
      }
      await dismissCookieConsent(page)

      // Search by base product code to get structured product data
      const searchQuery = variantCode || baseProduct
      const searchProduct = await fetchSearchProduct(page, searchQuery, jlog)
      if (!searchProduct) {
        jlog.warn('Product not found via search API, falling back to DOM-only scrape', { baseProduct })
      }

      // ── Step 2: Navigate to product page for DOM scraping ──
      const productUrl = variantCode
        ? `${BASE_URL}/de/p/${baseProduct}?variant=${variantCode}`
        : `${BASE_URL}/de/p/${baseProduct}`
      jlog.info('Loading product page', { url: productUrl })
      await page.goto(productUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await sleep(randomDelay(3000, 5000))
      if (await isAccessDenied(page)) {
        jlog.warn('Access denied on product page', { url: productUrl })
        return null
      }
      await dismissCookieConsent(page)

      // Scroll down to trigger lazy-loaded content
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await sleep(1500)

      const domData = await extractDomData(page)

      // ── Step 2b: Fetch GTINs for all variants via search API ──
      // Must navigate back to homepage — Akamai blocks API calls on product pages
      const variantGtins = new Map<string, string>() // code → GTIN

      // Add the current variant's GTIN from the search product or React state
      const selectedDomCode = domData.variants.find(v => v.isSelected)?.code
      const currentVariantCode = variantCode || selectedDomCode || searchProduct?.code
      const currentEan = searchProduct?.ean || domData.reactEan
      if (currentEan && currentVariantCode) {
        variantGtins.set(currentVariantCode, currentEan)
      }

      // Fetch GTINs for other variants we discovered from the DOM
      const otherVariantCodes = domData.variants
        .map(v => v.code)
        .filter(code => !variantGtins.has(code))

      if (otherVariantCodes.length > 0) {
        jlog.info('Fetching GTINs for sibling variants', { count: otherVariantCodes.length })
        // Navigate back to homepage for API access
        await page.goto(`${BASE_URL}/de`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        await sleep(randomDelay(1500, 2500))

        for (const code of otherVariantCodes) {
          const variantProduct = await fetchSearchProduct(page, code, jlog)
          if (variantProduct?.ean) {
            variantGtins.set(code, variantProduct.ean)
          }
          // Small delay between API calls
          await sleep(randomDelay(300, 600))
        }
        jlog.info('Variant GTINs fetched', { found: variantGtins.size, total: domData.variants.length })
      }

      if (debug) {
        jlog.info('Debug mode: browser kept open')
        await page.pause()
      }

      // ── Step 3: Combine search API + DOM data into ScrapedProductData ──

      // Name: prefer search API baseProductName, fallback to DOM h1
      const name = searchProduct?.baseProductName || domData.h1 || 'Unknown'

      // Brand
      const brandName = searchProduct?.brand?.name
      const brandUrl = searchProduct?.brand?.code
        ? `${BASE_URL}/de/b/${encodeURIComponent(searchProduct.brand.name?.toLowerCase().replace(/\s+/g, '-').replace(/&/g, '') || '')}/${searchProduct.brand.code}`
        : undefined

      // Description: from search API HTML
      const description = searchProduct?.description ? htmlToText(searchProduct.description) : undefined

      // Price
      const priceCents = searchProduct?.price?.value
        ? Math.round(searchProduct.price.value * 100)
        : undefined
      const currency = searchProduct?.price?.currencyIso || 'EUR'

      // Per-unit price
      const perUnitAmount = searchProduct?.baseContentPrice?.value
      const perUnitQuantity = searchProduct?.baseNumberContentUnits
      const perUnitUnit = searchProduct?.contentUnitOfBaseNumberContentUnits

      // Amount
      const amount = searchProduct?.numberContentUnits
      const amountUnit = searchProduct?.contentUnit

      // Images: prefer search API (higher quality URLs), fallback to DOM
      const images: Array<{ url: string; alt?: string | null }> = []
      if (searchProduct?.images?.length) {
        for (const img of searchProduct.images) {
          // Strip the ?context= param to get clean URLs, and remove &grid=true for full size
          const cleanUrl = img.url.replace(/&grid=true/, '')
          images.push({ url: cleanUrl })
        }
      } else if (domData.images.length) {
        images.push(...domData.images)
      }

      // Rating (0-5 scale from Douglas, stored as-is — normalize to 0-10 during persist)
      const rating = searchProduct?.averageRating
      const ratingCount = searchProduct?.numberOfReviews

      // Availability
      const stockStatus = searchProduct?.stock?.stockLevelStatus?.toLowerCase()
      const availability: 'available' | 'unavailable' | 'unknown' =
        stockStatus === 'instock' || domData.isAvailable
          ? 'available'
          : stockStatus === 'outofstock'
            ? 'unavailable'
            : 'unknown'

      // Labels from flags
      const labels = searchProduct?.flags?.map(f => f.code).filter(Boolean) || []

      // Category breadcrumbs (drop the last one which is the product name)
      const categoryBreadcrumbs = domData.breadcrumbs.length > 1
        ? domData.breadcrumbs.slice(0, -1)
        : domData.breadcrumbs

      // Canonical URL — always include ?variant= when the product has variants,
      // even when crawling the base URL. This ensures the default variant's
      // source-variant URL matches the sibling URL other variants generate for it,
      // preventing duplicates (base URL vs ?variant=code for the same variant).
      const effectiveVariantCode = variantCode || (domData.variants.length > 0 ? currentVariantCode : undefined)
      const canonicalUrl = effectiveVariantCode
        ? `${BASE_URL}/de/p/${baseProduct}?variant=${effectiveVariantCode}`
        : `${BASE_URL}/de/p/${baseProduct}`

      // Variants from DOM (color blobs or size radio buttons)
      const variants: ScrapedProductData['variants'] = []
      if (domData.variants.length > 0) {
        const options = domData.variants.map(v => ({
          label: v.label,
          value: `${BASE_URL}/de/p/${baseProduct}?variant=${v.code}`,
          gtin: variantGtins.get(v.code) || null,
          isSelected: v.isSelected || v.code === variantCode,
          sourceArticleNumber: v.code,
        }))
        variants.push({ dimension: domData.variantDimension || 'Farbe', options })
      }

      // Source article number: the variant code for the crawled variant
      const sourceArticleNumber = currentVariantCode

      // Top-level GTIN for the crawled variant
      const gtin = (currentVariantCode ? variantGtins.get(currentVariantCode) : undefined)
        || searchProduct?.ean
        || domData.reactEan
        || undefined

      const result: ScrapedProductData = {
        name,
        gtin,
        brandName,
        brandUrl,
        description,
        ingredientsText: domData.ingredientsText || undefined,
        priceCents,
        currency,
        amount,
        amountUnit,
        perUnitAmount,
        perUnitQuantity,
        perUnitUnit,
        images,
        variants,
        labels,
        rating,
        ratingCount,
        sourceArticleNumber,
        sourceProductArticleNumber: baseProduct,
        categoryBreadcrumbs,
        canonicalUrl,
        availability,
        warnings: [],
      }

      // ── Step 4: Fetch reviews from BazaarVoice (no browser needed) ──
      if (!options?.skipReviews) {
        result.reviews = await fetchDouglasReviews(baseProduct, jlog)
      }

      jlog.info('Product scraped successfully', {
        url: sourceUrl,
        source: 'douglas',
        name: result.name,
        variants: domData.variants.length,
        hasGtin: !!gtin,
        variantGtins: variantGtins.size,
        hasIngredients: !!result.ingredientsText,
        images: images.length,
      })
      options?.logger?.event('scraper.product_scraped', {
        url: sourceUrl,
        source: 'douglas',
        name: result.name,
        variants: domData.variants.length,
        durationMs: 0, // TODO: track duration
        images: images.length,
        hasIngredients: !!result.ingredientsText,
      })

      return result
    } catch (err) {
      if (page && options?.debugContext) {
        const screenshotUrl = await captureDebugScreenshot({
          page,
          client: options.debugContext.client,
          jobCollection: options.debugContext.jobCollection,
          jobId: options.debugContext.jobId,
          step: 'error',
          label: err instanceof Error ? err.message : String(err),
        }).catch(() => null)
        if (screenshotUrl && err instanceof Error) {
          ;(err as any).screenshotUrl = screenshotUrl
        }
      }
      throw err
    } finally {
      await browser.close()
    }
  },
}
