import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ProductSearchOptions, ProductSearchResult, ScrapedProductData, DiscoveredProduct } from '../../types'
import { launchBrowser } from '@/lib/browser'
import { createLogger } from '@/lib/logger'
import { captureDebugScreenshot } from '@/lib/debug-screenshot'

const log = createLogger('Kaufland')

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface KauflandDiscoveryProgress {
  queue: string[]
  visitedUrls: string[]
  currentLeaf?: {
    categoryUrl: string
    category: string
    lastPage: number
    nextPage: number
  }
}

export const kauflandDriver: SourceDriver = {
  slug: 'kaufland',
  label: 'Kaufland',
  hosts: ['www.kaufland.de', 'kaufland.de'],
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 24"><rect width="80" height="24" rx="4" fill="#e10915"/><text x="40" y="17" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial, sans-serif">Kaufland</text></svg>',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.kaufland.de' || hostname === 'kaufland.de'
    } catch {
      return false
    }
  },

  async discoverProducts(options: ProductDiscoveryOptions): Promise<ProductDiscoveryResult> {
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages, debug, logger, debugContext } = options
    const savedProgress = options.progress as KauflandDiscoveryProgress | undefined

    log.info('Starting browser-based discovery', { url, delay, maxPages: maxPages ?? 'unlimited' })

    const visitedUrls = new Set<string>(savedProgress?.visitedUrls ?? [])
    const seenProductUrls = new Set<string>()
    const queue: string[] = savedProgress?.queue ?? [url]
    let currentLeaf = savedProgress?.currentLeaf ?? undefined
    let pagesUsed = 0

    function budgetExhausted(): boolean {
      return maxPages !== undefined && pagesUsed >= maxPages
    }

    const browser = await launchBrowser()

    try {
      const page = await browser.newPage()

      /** Dismiss OneTrust cookie consent popup if present */
      async function dismissCookiePopup() {
        try {
          // Wait briefly for the OneTrust banner to appear
          await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000 })
          await page.click('#onetrust-accept-btn-handler')
          log.info('OneTrust cookie popup dismissed')
          await sleep(1000)
        } catch {
          // No popup or already dismissed — continue
        }
      }

      // Navigate to initial URL and dismiss cookie popup before BFS
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      await sleep(1500)
      await dismissCookiePopup()

      async function debugScreenshot(step: string) {
        if (!debug || !debugContext) return
        await captureDebugScreenshot({
          page,
          client: debugContext.client,
          jobCollection: debugContext.jobCollection,
          jobId: debugContext.jobId,
          step,
        })
      }

      async function saveProgress() {
        await onProgress?.({
          queue: [...queue],
          visitedUrls: [...visitedUrls],
          currentLeaf,
        } satisfies KauflandDiscoveryProgress)
      }

      async function scrapeProductTiles(categoryName: string, categoryUrl: string): Promise<number> {
        // Hover span tiles to trigger SPA conversion from <span> to <a> with href
        const spanTiles = await page.$$('[data-testid="product-tiles"] > span[data-testid*="product-tile"]')
        for (const tile of spanTiles) {
          await tile.hover().catch(() => {})
        }
        await sleep(300)

        const tiles = await page.$$eval(
          '[data-testid="product-tiles"] > [data-testid*="product-tile"]',
          (elements) =>
            elements.map((el) => {
              // <a> tiles have href directly; <span> tiles use SPA navigation
              let href = el.getAttribute('href') || ''
              // For <span> tiles: try to find product link inside, or extract from image URL
              if (!href) {
                const innerLink = el.querySelector('a[href*="/product/"]')
                if (innerLink) href = innerLink.getAttribute('href') || ''
              }
              const nameEl = el.querySelector('.product-title')
              const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim() || ''
              const tag = el.tagName
              return { href, name, tag }
            }),
        )

        let newCount = 0
        for (const tile of tiles) {
          if (!tile.href) continue
          const productUrl = tile.href.startsWith('http')
            ? tile.href
            : `https://www.kaufland.de${tile.href}`
          if (seenProductUrls.has(productUrl)) continue
          seenProductUrls.add(productUrl)
          newCount++
          const product: DiscoveredProduct = {
            productUrl,
            name: tile.name || undefined,
            category: categoryName,
            categoryUrl,
          }
          await onProduct(product)
        }

        const aTiles = tiles.filter(t => t.tag === 'A').length
        const spanTileCount = tiles.filter(t => t.tag === 'SPAN').length
        const withHref = tiles.filter(t => t.href).length
        log.info('Product tiles scraped', { tilesFound: tiles.length, aTiles, spanTiles: spanTileCount, withHref, skippedNoHref: tiles.length - withHref, newProducts: newCount, totalSeen: seenProductUrls.size })
        return newCount
      }

      /** Check if pagination has a non-disabled forward button */
      async function hasNextPage(): Promise<boolean> {
        return page.$$eval(
          '.rd-pagination .rd-page--arrow-btn',
          (btns) => {
            // The forward (next) button is the last arrow btn
            const lastBtn = btns[btns.length - 1]
            if (!lastBtn) return false
            return !lastBtn.classList.contains('rd-page--disabled')
          },
        ).catch(() => false)
      }

      /** Paginate through all pages of a leaf category, starting from nextPage */
      async function paginateLeaf(categoryUrl: string, category: string, startPage: number): Promise<boolean> {
        let pageNum = startPage
        while (true) {
          if (budgetExhausted()) {
            currentLeaf = { categoryUrl, category, lastPage: 0, nextPage: pageNum }
            await saveProgress()
            return false // not done, budget exhausted
          }

          const baseUrl = categoryUrl.split('?')[0]
          const pagedUrl = `${baseUrl}?page=${pageNum}`
          log.info('Navigating to page', { pageNum, url: pagedUrl })

          try {
            await page.goto(pagedUrl, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('[data-testid*="product-tile"]', { timeout: 15000 }).catch(() => {})
            const jitter = delay * (0.75 + Math.random() * 0.5)
            await sleep(jitter)
            pagesUsed++

            await debugScreenshot(`leaf_p${pageNum}_${category}`)

            const beforeCount = seenProductUrls.size
            await scrapeProductTiles(category, categoryUrl)
            const newProducts = seenProductUrls.size - beforeCount
            log.info('Scraped page', { pageNum, newProducts })

            // Stop if no products found on this page or no next button
            if (newProducts === 0 || !(await hasNextPage())) break

            pageNum++
            await saveProgress()
          } catch (e) {
            log.warn('Error on page', { url: pagedUrl, error: String(e) })
            onError?.(pagedUrl)
            pagesUsed++
            break
          }
        }
        return true // done with this leaf
      }

      // Resume paginating a leaf if we were mid-leaf
      if (currentLeaf) {
        const { categoryUrl, category, nextPage } = currentLeaf
        log.info('Resuming leaf pagination', { categoryUrl, nextPage })
        const leafDone = await paginateLeaf(categoryUrl, category, nextPage)
        if (!leafDone) return { done: false, pagesUsed }
        currentLeaf = undefined
        await saveProgress()
      }

      // BFS loop
      while (queue.length > 0) {
        if (budgetExhausted()) break

        const currentUrl = queue.shift()!
        const canonicalUrl = currentUrl.startsWith('http')
          ? currentUrl
          : `https://www.kaufland.de${currentUrl}`

        if (visitedUrls.has(canonicalUrl)) continue
        visitedUrls.add(canonicalUrl)

        try {
          log.info('Visiting', { url: canonicalUrl })
          await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector('[data-testid*="product-tile"], .rd-category-tree', { timeout: 15000 }).catch(() => {})
          const jitter = delay * (0.75 + Math.random() * 0.5)
          await sleep(jitter)
          pagesUsed++

          // Detect page type: non-leaf has .rd-category-tree, leaf has product tiles
          const hasCategoryTree = await page.$('.rd-category-tree') !== null
          const hasProductTiles = await page.$('[data-testid*="product-tile"]') !== null

          if (!hasCategoryTree && hasProductTiles) {
            // Leaf page: scrape products on page 1, then paginate
            const category = await page.$eval('h1.title', (el) => el.textContent?.trim() || '').catch(() => '')

            log.info('Leaf page detected', { category, url: canonicalUrl })
            await debugScreenshot(`leaf_p1_${category}`)

            // Scrape page 1 (already loaded)
            await scrapeProductTiles(category, canonicalUrl)
            await saveProgress()

            // Paginate remaining pages if there's a next button
            if (await hasNextPage()) {
              const leafDone = await paginateLeaf(canonicalUrl, category, 2)
              if (!leafDone) return { done: false, pagesUsed }
              currentLeaf = undefined
            }
          } else if (hasCategoryTree) {
            // Non-leaf page: extract subcategory links from the FIRST .rd-category-tree__nav only
            // Skip sections with rd-category-tree__list-headline (e.g. "Häufig gesucht", "Hersteller")
            const childHrefs = await page.$$eval(
              '.rd-category-tree__nav',
              (navs) => {
                if (navs.length === 0) return []
                const firstNav = navs[0]
                // Skip if this nav has a list-headline (indicates "Häufig gesucht" etc.)
                if (firstNav.querySelector('.rd-category-tree__list-headline')) return []
                const anchors = firstNav.querySelectorAll('.rd-category-tree__anchor')
                return Array.from(anchors)
                  .map((a) => a.getAttribute('href') || '')
                  .filter(Boolean)
              },
            ).catch(() => [] as string[])

            if (childHrefs.length === 0) {
              log.info('No category nav links found, skipping', { url: canonicalUrl })
            } else {
              log.info('Non-leaf page with child categories', { children: childHrefs.length })
              for (const href of childHrefs) {
                const childUrl = href.startsWith('http')
                  ? href
                  : `https://www.kaufland.de${href}`
                if (!visitedUrls.has(childUrl)) {
                  queue.push(childUrl)
                }
              }
            }
          } else {
            log.info('Unknown page type, skipping', { url: canonicalUrl })
          }

          await saveProgress()
        } catch (e) {
          log.warn('Error visiting page', { url: canonicalUrl, error: String(e) })
          onError?.(canonicalUrl)
          await saveProgress()
        }
      }
    } finally {
      await browser.close()
    }

    const done = queue.length === 0 && !currentLeaf
    log.info('Tick done', { pagesUsed, done })
    return { done, pagesUsed }
  },

  async searchProducts(options: ProductSearchOptions): Promise<ProductSearchResult> {
    const { query, maxResults = 50, debug, logger } = options
    const searchUrl = `https://www.kaufland.de/s/?search_value=${encodeURIComponent(query)}`

    log.info('Searching Kaufland', { query, maxResults, url: searchUrl })

    const browser = await launchBrowser()
    const products: import('../../types').DiscoveredProduct[] = []
    const seenUrls = new Set<string>()

    try {
      const page = await browser.newPage()

      // Navigate and dismiss cookie popup
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
      await sleep(1500)
      try {
        await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000 })
        await page.click('#onetrust-accept-btn-handler')
        await sleep(1000)
      } catch { /* no popup */ }

      let pageNum = 1
      while (products.length < maxResults) {
        // Wait for tiles
        await page.waitForSelector('[data-testid*="product-tile"]', { timeout: 15000 }).catch(() => {})
        await sleep(500)

        // Hover span tiles to convert to <a>
        const spanTiles = await page.$$('[data-testid="product-tiles"] > span[data-testid*="product-tile"]')
        for (const tile of spanTiles) {
          await tile.hover().catch(() => {})
        }
        await sleep(300)

        // Scrape tiles
        const tiles = await page.$$eval(
          '[data-testid="product-tiles"] > [data-testid*="product-tile"]',
          (elements) =>
            elements.map((el) => {
              let href = el.getAttribute('href') || ''
              if (!href) {
                const innerLink = el.querySelector('a[href*="/product/"]')
                if (innerLink) href = innerLink.getAttribute('href') || ''
              }
              const nameEl = el.querySelector('.product-title')
              const name = nameEl?.getAttribute('title') || nameEl?.textContent?.trim() || ''
              // Extract rating
              const ratingEl = el.querySelector('.rating-stars__average')
              const ratingText = ratingEl?.textContent?.trim()?.replace(',', '.') || ''
              const rating = parseFloat(ratingText) || undefined
              const countEl = el.querySelector('.rating-stars__count')
              const countText = countEl?.textContent?.replace(/[^0-9]/g, '') || ''
              const ratingCount = parseInt(countText, 10) || undefined
              return { href, name, rating, ratingCount }
            }),
        )

        let foundNew = false
        for (const tile of tiles) {
          if (!tile.href) continue
          if (products.length >= maxResults) break
          const productUrl = tile.href.startsWith('http')
            ? tile.href
            : `https://www.kaufland.de${tile.href}`
          // Strip search_value query param for clean URL
          const cleanUrl = productUrl.split('?')[0]
          if (seenUrls.has(cleanUrl)) continue
          seenUrls.add(cleanUrl)
          foundNew = true
          products.push({
            productUrl: cleanUrl,
            name: tile.name || undefined,
            rating: tile.rating ? tile.rating * 2 : undefined, // normalize 5-star to 0-10
            ratingCount: tile.ratingCount,
          })
        }

        log.info('Search page scraped', { pageNum, tilesFound: tiles.length, totalProducts: products.length })

        // Check for next page
        if (!foundNew || products.length >= maxResults) break
        const hasNext = await page.$$eval(
          '.rd-pagination .rd-page--arrow-btn',
          (btns) => {
            const lastBtn = btns[btns.length - 1]
            return lastBtn ? !lastBtn.classList.contains('rd-page--disabled') : false
          },
        ).catch(() => false)

        if (!hasNext) break

        pageNum++
        const baseUrl = searchUrl.split('?')[0]
        await page.goto(`${searchUrl}&page=${pageNum}`, { waitUntil: 'domcontentloaded' })
        await sleep(1000)
      }
    } finally {
      await browser.close()
    }

    log.info('Search complete', { query, totalProducts: products.length })
    return { products }
  },

  async scrapeProduct(sourceUrl: string, options?: { debug?: boolean; logger?: any; skipReviews?: boolean }): Promise<ScrapedProductData | null> {
    const productUrl = sourceUrl.startsWith('http') ? sourceUrl : `https://www.kaufland.de${sourceUrl}`
    log.info('Scraping product', { url: productUrl })

    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()

      // Navigate and dismiss cookie popup
      await page.goto(productUrl, { waitUntil: 'domcontentloaded' })
      await sleep(1500)
      try {
        await page.waitForSelector('#onetrust-accept-btn-handler', { timeout: 5000 })
        await page.click('#onetrust-accept-btn-handler')
        await sleep(1000)
      } catch { /* no popup */ }

      // Wait for above-the-fold content
      await page.waitForSelector('h1#product-title', { timeout: 15000 }).catch(() => {})

      // Scroll down to trigger below-the-fold lazy loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
      await sleep(2000)
      await page.evaluate(() => window.scrollTo(0, 0))
      await sleep(500)

      // Extract all product data using individual queries to avoid tsx __name issue in page.evaluate
      const data = await page.evaluate(() => {
        // Title
        const name = document.querySelector('h1#product-title')?.textContent?.trim() || ''

        // GTIN from loadbee or attribute list
        let gtin = document.querySelector('[data-loadbee-gtin]')?.getAttribute('data-loadbee-gtin') || ''
        if (!gtin) {
          // Try EAN from attribute list
          const attrItems = document.querySelectorAll('.pdp-attribute-list__item')
          for (const item of attrItems) {
            const title = item.querySelector('.pdp-attribute-list__title')?.textContent?.trim()
            if (title === 'EAN') {
              gtin = item.querySelector('.pdp-attribute-list__value')?.textContent?.trim() || ''
              break
            }
          }
        }

        // Price
        const priceText = (document.querySelector('[data-test="product-price"]')?.getAttribute('aria-label') || '')
          .replace(/Preis:\s*/, '')
          .replace(/[^\d,]/g, '')
          .replace(',', '.') || ''
        const priceCents = priceText ? Math.round(parseFloat(priceText) * 100) : undefined

        // Base price (per unit)
        const basePriceText = document.querySelector('.pdp-base-prices__base-price')?.textContent?.trim() || ''

        // Description
        const description = document.querySelector('.pdp-product-description__section')?.textContent?.trim() || ''

        // Ingredients from attribute list
        let ingredientsText = ''
        const attrItems = document.querySelectorAll('.pdp-attribute-list__item')
        let brandName = ''
        let amount = ''
        for (const item of attrItems) {
          const title = item.querySelector('.pdp-attribute-list__title')?.textContent?.trim()
          const value = item.querySelector('.pdp-attribute-list__values')?.textContent?.trim() || ''
          if (title === 'Inhaltsstoffe' && !ingredientsText) ingredientsText = value
          if (title === 'Hersteller' && !brandName) brandName = value
          if (title === 'Inhalt' && !amount) amount = value
        }

        // Images from gallery
        const imgEl = document.querySelector('picture.product-picture img')
        const imgSrc = imgEl?.getAttribute('src') || ''
        const imgSrcset = imgEl?.getAttribute('srcset') || ''
        // Get the largest image from srcset
        const images: Array<{ url: string; alt?: string }> = []
        if (imgSrcset) {
          const parts = imgSrcset.split(',').map(s => s.trim())
          const largest = parts[parts.length - 1]?.split(' ')[0]
          if (largest) images.push({ url: largest, alt: name })
        } else if (imgSrc) {
          images.push({ url: imgSrc, alt: name })
        }

        // Rating
        const filledStars = document.querySelectorAll('.widget-review-teaser .rd-rating-stars__star--full').length
        const halfStars = document.querySelectorAll('.widget-review-teaser .rd-rating-stars__star--half').length
        const rating = filledStars > 0 || halfStars > 0 ? filledStars + halfStars * 0.5 : undefined
        const ratingCountText = document.querySelector('.widget-review-teaser__text.widget-review-teaser--number-only')?.textContent?.replace(/[^0-9]/g, '') || '0'
        const ratingCount = parseInt(ratingCountText, 10) || 0

        // Breadcrumbs
        const breadcrumbs: string[] = []
        document.querySelectorAll('.rd-breadcrumb__link .rd-link__text').forEach(el => {
          const t = el.textContent?.trim()
          if (t && t !== 'Startseite') breadcrumbs.push(t)
        })

        return { name, gtin, priceCents, description, ingredientsText, brandName, amount, images, rating, ratingCount, breadcrumbs, basePriceText }
      })

      if (!data.name) {
        log.warn('No product name found', { url: productUrl })
        return null
      }

      // Parse amount
      const amountMatch = data.amount?.match(/(\d+(?:[.,]\d+)?)\s*(ml|l|g|kg)/i)
      const amountNum = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : undefined
      const amountUnit = amountMatch ? amountMatch[2].toLowerCase() : undefined

      // Parse per-unit price from base price text (e.g. "2.212,22 €/1l")
      const perUnitMatch = data.basePriceText?.match(/([\d.,]+)\s*€\s*\/\s*(\d+)?\s*(ml|l|g|kg)/i)
      const perUnitAmount = perUnitMatch ? Math.round(parseFloat(perUnitMatch[1].replace('.', '').replace(',', '.')) * 100) : undefined
      const perUnitQuantity = perUnitMatch ? parseInt(perUnitMatch[2] || '1', 10) : undefined
      const perUnitUnit = perUnitMatch ? perUnitMatch[3].toLowerCase() : undefined

      const result: ScrapedProductData = {
        gtin: data.gtin || undefined,
        name: data.name,
        brandName: data.brandName || undefined,
        description: data.description || undefined,
        ingredientsText: data.ingredientsText || undefined,
        priceCents: data.priceCents,
        currency: data.priceCents ? 'EUR' : undefined,
        amount: amountNum,
        amountUnit,
        images: data.images,
        variants: [],
        labels: [],
        rating: data.rating ? data.rating * 2 : undefined, // normalize 5-star → 0-10
        ratingCount: data.ratingCount || undefined,
        categoryBreadcrumbs: data.breadcrumbs,
        canonicalUrl: productUrl,
        perUnitAmount,
        perUnitQuantity,
        perUnitUnit,
        warnings: [],
      }

      log.info('Product scraped', { name: result.name, gtin: result.gtin, price: result.priceCents })
      return result
    } finally {
      await browser.close()
    }
  },
}
