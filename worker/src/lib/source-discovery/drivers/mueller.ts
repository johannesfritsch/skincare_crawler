import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ScrapedProductData } from '../types'
import { launchBrowser } from '@/lib/browser'

import { normalizeProductUrl } from '@/lib/source-product-queries'
import { createLogger } from '@/lib/logger'

const log = createLogger('Mueller')

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jitteredDelay(baseDelay: number): number {
  const jitter = baseDelay * 0.25
  return baseDelay + Math.floor(Math.random() * jitter * 2 - jitter)
}

interface MuellerProductDiscoveryProgress {
  queue: string[]
  visitedUrls: string[]
  currentLeaf?: {
    categoryUrl: string
    category: string
    lastPage: number
    nextPage: number
  }
}

function buildCategoryFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    // Mueller URLs look like /c/drogerie/pflege/koerperpflege/deodorants/spray/
    const match = pathname.match(/\/c\/(.+?)\/?$/)
    if (!match) return ''
    return match[1]
      .split('/')
      .filter(Boolean)
      .map((seg) =>
        seg
          .replace(/-und-/g, ' & ')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
      )
      .join(' -> ')
  } catch {
    return ''
  }
}

export const muellerDriver: SourceDriver = {
  slug: 'mueller',
  label: 'Müller',
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 710 140"><g transform="translate(-13.6,-96.1)"><path d="M14.9 97.5h33.4c10.8-.1 18 1.7 25.9 8.8 4.8 4.4 7.1 7.8 9.3 14 2.4-6.2 4.8-9.6 9.9-14 7.9-6.9 15.2-8.5 25.4-8.8h33.3v33.4c.5 10.7-1.3 18.8-8.9 26.7-4.3 4.5-7.5 6.6-13.4 8.5 5.9 2.1 9.1 4.2 13.4 8.8 7.4 8 9.2 15.1 8.9 26.5v33.2h-33.3c-10.5.1-17.8-1.8-25.7-8.8-4.8-4.2-7.1-7.5-9.5-13.4-2-5.9-4.1-9.2-8.7-13.4-7.9-6.5-15.7-8.6-26.6-7.9h-33.4V201.3c-.3-10.1 1.8-17.8 8.9-25.7 4.4-4.9 7.8-7.2 14-9.5-6.2-2.2-9.3-4.5-13.7-9.2-7.2-7.9-8.8-15.5-8.9-26v-33.4z" fill="#f16426"/><path d="M29.1 111.7H50.7c10.6.1 16.9 1 24.4 7.5 4.2 3.6 6.2 6.4 8.4 11.5 2.3-5.1 4.4-7.9 8.8-11.5 7.5-6.3 14.4-7.8 24-7.5h21.7v21.7c-.2 8.4-.5 14.5-5.5 21.7-3.9 5.6-7.3 8.4-13.6 11 6.3 2.6 9.7 5.3 13.6 10.9 5.1 7.2 5.5 13.2 5.5 21.9v21.6H116.2c-9.9.4-16.4-1.2-24-7.5-4.3-3.6-6.5-6.4-8.8-11.5-2.1 5.1-4.1 7.9-8.3 11.5-7.5 6.5-14.2 7.4-24.5 7.5H29.2V199c-.1-9.4 1.1-14.5 6.2-21.7 3.8-5.4 7-8.1 12.9-11-5.9-2.8-9.1-5.4-12.9-10.7-5.2-7.3-6.3-13.4-6.2-22.2v-21.7z" fill="#fff"/><path d="M72.9 182c4.8 10.7 5.4 10.5 6.7 10.7 2.5.3 5.4-8.7 7.1-12.4 1.9-4 4.4-11 6.9-11s3.3 13.6 3 15c-.6 2.5-4.1 3-4.1 5.8 0 5.1 10.9 4.8 14.1 4.8s14.3.2 14.3-5.1c0-3.6-4.8-2.3-5.6-8.9-.7-5.7-1.2-14.5-1.2-15.7 0-3.6.6-12.9 1.2-15.1.8-2.7 4.4-3.3 4.4-6.5 0-5-8-5.2-11.4-5.2-10.5 0-10.6 2.4-14.6 9.8-2.9 5.2-6.1 14.8-8.6 14.3-3.5-.8-8.4-13.8-11.2-18.5-2.4-4-2.2-5.6-11.5-5.6-6.3 0-13.7 1.1-13.7 5.6 0 3.2 4.5 3.8 5.3 5.5.9 1.8 1.2 4.3 1.2 9v11.3c-.6 5.9-1.3 13.2-2 19.9-.6 6.5-5.4 2.8-5.4 7.3 0 4.1 7.2 4.4 10 4.4s12.6-.2 12.6-4.7c0-4.3-5.1-.3-5.1-8.8 0-2.6-.8-12.9 1.7-12.9 1.4 0 2.3 2.4 2.8 3.4l4.6 10.3z" fill="#282526"/></g><g fill="#f16426" transform="translate(-13.6,-96.1)"><path d="M236.5 196.7c8.9 20.4 10.1 20.1 12.5 20.4 2.8.6 8.1-16.6 11.4-23.6 3.6-7.7 8.4-20.9 13-20.9s5.2 16.3 4.6 17.6c-1-5.2-8 .3-8 5.9 0 10.7 21.4 10.4 27.5 10.4s27 .5 27-10.1c0-6.7-8.9-4.4-9.3-15.4-.5-12.1-.9-28.7-.9-30 0-6.8.5-18.7 1.7-21.7 1.5-5.1 8.2-6.3 8.2-12.4 0-9.5-14.9-10-21.4-10-20.3 0-20.5 4.5-28 19.2-5.4 10-11.5 28.3-14 27.7-6.9-1.5-15.8-26.3-21-31.2-4.1-7.6-3.8-10.7-17.5-10.7-12 0-25.8 2.1-25.8 10.7 0 6.2 8.9 7.3 10.4 10.4 1.6 3.5 2.2 8.2 2.2 17.3 0 21.9-1.3 36-2.5 48.7-1.2 12.4-10.1 5.5-10.1 14.1 0 7.9 13.6 8.3 18.8 8.3s21.7-.3 21.7-8.9c0-8.2-9.5-1.6-9.5-17.8 0-5-1.5-24.9 3.1-24.9 2.7 0 4.4 4.5 5.3 6.5l8.6 19.6z"/><path d="M361.4 110.8c-7.6 0-22.9 1.8-22.9 12.5 0 7.4 8.2 10 14.2 10 7.4 0 24.7-2.7 24.7-12.8 0-8-10-9.7-16-9.7zm45.4 0c-7.6 0-22.9 1.8-22.9 12.5 0 7.4 8.2 10 14.2 10 7.4 0 24.7-2.7 24.7-12.8 0-8-10-9.7-16-9.7zm-39 32c-1.2 0-38.7.5-38.7 10.1 0 9.4 9.1 1 10.2 19.2v3.8c0 22.7-2.4 45.3 26 45.3 13.1 0 19.1-9.1 22.5-9.1 6 0-1.6 9.1 9.8 9.1 8.2 0 34.6-2.9 34.6-13.2 0-7.3-8.2-3-8.2-12.1v-23.8-6.5c0-4.8.3-9.5.3-14.3 0-5.3-2.2-8.5-7.6-8.5-5.7 0-35.6 1.5-35.6 10.4 0 6.3 7.3 3.7 8.5 11.3.3 2.3.5 5 .6 7.6v8.8c0 7.3 1.5 21.4-9.2 21.4-8 0-8.5-9.4-8.5-15.4v-14.8-24.4c0-3.8-.5-5.7-4.6-5.7z" fill-rule="evenodd"/><path d="M482.7 163.2c0-21.6 1.9-38.2 1.9-41.7 0-4.5-1.2-7.9-6.3-7.9h-40.8c0 13.1 8.8 9.1 11 20.3 1.3 6.8 1 18.1 1 24v6.2c0 7.4 0 26.3-1.9 32.5-1.8 5.6-8.2 3.6-8.2 8.9 0 10.7 20.9 10 27.6 10s24.6.8 24.6-9.4c0-6.3-6.7-3.8-8.3-9.2-.7-2.4-.6-7.4-.6-10.1v-29.3-6.3zM541.9 163.2c0-21.6 1.9-38.2 1.9-41.7 0-4.5-1.2-7.9-6.3-7.9h-40.8c0 13.1 8.8 9.1 11 20.3 1.3 6.8 1 18.1 1 24v6.2c0 7.4 0 26.3-1.9 32.5-1.8 5.6-8.2 3.6-8.2 8.9 0 10.7 20.9 10 27.6 10s24.6.8 24.6-9.4c0-6.3-6.7-3.8-8.3-9.2-.7-2.4-.6-7.4-.6-10.1v-29.3-6.3z"/><path d="M626.1 184.8c4.8 0 9.3-1.4 9.3-11.3 0-11.3-11.2-31.1-36.5-31.1-22.3 0-41.9 16.9-41.9 40.2 0 19.5 13.9 39.1 40.7 39.1 13.4 0 34.4-8.5 34.4-20.1 0-2.9-2.7-7.6-5.8-7.6s-8.6 6.8-19.8 6.8c-7 0-16.7-6.3-16.7-13.9 0-2.6 2.4-2.1 4-2.1h32.3zm-28.2-14.5c-3.9 0-8.9 1.2-8.9-4.2 0-4.8 4-10 8.9-10s8.8 4.2 8.8 9.7-4.8 4.5-8.8 4.5z" fill-rule="evenodd"/><path d="M651.3 182.8c0 4.2-.4 13 1.6 16.6-1.4 5.3-8 5.3-8 8.1 0 10.8 20.3 10.4 27.1 10.4 16.4 0 29.5-.8 29.5-10.3 0-9.1-11.3-5-12.2-11.6-.7-5.7-1.2-12.1-1.2-16.6 0-2.7-.7-12.8 3.4-12.8 3.9 0 6.6 8.6 16.2 8.6 9.8 0 18.3-8 18.3-18.1 0-10-6.6-17.5-16.5-17.5-12.8 0-15 11.9-18.6 11.9-2.5 0-2.4-3.5-2.6-5.3-.6-5.1-.7-6.6-6.4-6.6h-36.2c0 11.5 9.2 7.6 9.2 22.4v9.1-5.7z"/></g></svg>',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.mueller.de' || hostname === 'mueller.de'
    } catch {
      return false
    }
  },

  async discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult> {
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages, debug = false } = options
    const savedProgress = options.progress as MuellerProductDiscoveryProgress | undefined

    log.info(`Starting browser-based discovery for ${url} (delay=${delay}ms, maxPages=${maxPages ?? 'unlimited'}, debug=${debug})`)

    const visitedUrls = new Set<string>(savedProgress?.visitedUrls ?? [])
    const seenProductUrls = new Set<string>() // within-tick dedup only, not persisted
    const queue: string[] = savedProgress?.queue ?? [url]
    let currentLeaf = savedProgress?.currentLeaf ?? undefined
    let pagesUsed = 0

    function budgetExhausted(): boolean {
      return maxPages !== undefined && pagesUsed >= maxPages
    }

    const browser = await launchBrowser({ headless: !debug })

    try {
      const page = await browser.newPage()

      function scrapeProductTiles() {
        return page.$$eval(
          '[class*="product-tile"]',
          (tiles) =>
            tiles
              .filter((el) => el.tagName === 'ARTICLE' || el.querySelector('a[data-track-id="product"]'))
              .map((tile) => {
                const link = tile.querySelector('a[data-track-id="product"]') as HTMLAnchorElement | null
                const href = link?.getAttribute('href') || ''
                const nameEl = tile.querySelector('[class*="product-tile__product-name"]')
                const name = nameEl?.textContent?.trim() || ''
                const priceEl = tile.querySelector('[class*="product-price__main-price-accent"]')
                const priceText = priceEl?.textContent?.trim() || ''
                const priceMatch = priceText.match(/([\d]+[,.][\d]+)\s*€/)
                let priceCents: number | null = null
                if (priceMatch) {
                  priceCents = Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
                }
                const starImages = tile.querySelectorAll('[class*="star-rating"] img, [class*="star-rating"] svg')
                let rating: number | null = null
                if (starImages.length > 0) {
                  let filled = 0
                  starImages.forEach((img) => {
                    const src = img.getAttribute('src') || img.getAttribute('href') || ''
                    const cls = img.getAttribute('class') || ''
                    if (!src.includes('star-rating-empty') && !cls.includes('empty')) {
                      filled++
                    }
                  })
                  rating = filled
                }
                return { href, name, priceCents, rating }
              }),
        )
      }

      async function emitProducts(products: Awaited<ReturnType<typeof scrapeProductTiles>>, category: string, categoryUrl: string) {
        for (const p of products) {
          const rawUrl = p.href
            ? (p.href.startsWith('http') ? p.href : `https://www.mueller.de${p.href}`)
            : null
          const productUrl = rawUrl ? normalizeProductUrl(rawUrl) : null
          if (!productUrl || seenProductUrls.has(productUrl)) continue
          seenProductUrls.add(productUrl)
          await onProduct({
            productUrl,
            name: p.name || undefined,
            price: p.priceCents ?? undefined,
            currency: 'EUR',
            rating: p.rating ?? undefined,
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
        } satisfies MuellerProductDiscoveryProgress)
      }

      // Resume paginating a leaf if we were mid-leaf
      if (currentLeaf) {
        const { categoryUrl, category, lastPage, nextPage } = currentLeaf
        for (let pageNum = nextPage; pageNum <= lastPage; pageNum++) {
          if (budgetExhausted()) {
            currentLeaf = { ...currentLeaf, nextPage: pageNum }
            await saveProgress()
            return { done: false, pagesUsed }
          }

          const baseUrl = categoryUrl.split('?')[0]
          const pagedUrl = `${baseUrl}?page=${pageNum}`
          log.info(`Resuming leaf page ${pageNum}: ${pagedUrl}`)

          try {
            await page.goto(pagedUrl, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('[class*="product-tile"], [class*="category-navigation"]', { timeout: 15000 }).catch(() => {})
            await sleep(jitteredDelay(delay))
            pagesUsed++

            const products = await scrapeProductTiles()
            await emitProducts(products, category, categoryUrl)
            log.info(`Page ${pageNum}: found ${products.length} product tiles`)
          } catch (e) {
            log.warn(`Error on page ${pagedUrl}: ${e}`)
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
          : `https://www.mueller.de${currentUrl}`

        if (visitedUrls.has(canonicalUrl)) continue
        visitedUrls.add(canonicalUrl)

        try {
          log.info(`Visiting: ${canonicalUrl}`)
          await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector('[class*="product-tile"], [class*="category-navigation"]', { timeout: 15000 }).catch(() => {})
          await sleep(jitteredDelay(delay))
          pagesUsed++

          const isLeaf = await page.$('[class*="category-navigation__option--selected"]') !== null

          if (isLeaf) {
            const category = buildCategoryFromUrl(canonicalUrl)

            const lastPage = await page.$$eval(
              '[data-testid^="pageLink-"]',
              (links) => {
                let max = 1
                for (const link of links) {
                  const testId = link.getAttribute('data-testid') || ''
                  const match = testId.match(/pageLink-(\d+)/)
                  if (match) {
                    const num = parseInt(match[1], 10)
                    if (num > max) max = num
                  }
                }
                return max
              },
            ).catch(() => 1)

            log.info(`Leaf page, ${lastPage} page(s) detected`)

            // Scrape page 1 (already loaded)
            const products = await scrapeProductTiles()
            await emitProducts(products, category, canonicalUrl)
            log.info(`Page 1: found ${products.length} product tiles`)

            await saveProgress()

            // Paginate remaining pages
            for (let pageNum = 2; pageNum <= lastPage; pageNum++) {
              if (budgetExhausted()) {
                currentLeaf = { categoryUrl: canonicalUrl, category, lastPage, nextPage: pageNum }
                await saveProgress()
                return { done: false, pagesUsed }
              }

              const baseUrl = canonicalUrl.split('?')[0]
              const pagedUrl = `${baseUrl}?page=${pageNum}`
              log.info(`Navigating to page ${pageNum}: ${pagedUrl}`)

              try {
                await page.goto(pagedUrl, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector('[class*="product-tile"]', { timeout: 15000 }).catch(() => {})
                await sleep(jitteredDelay(delay))
                pagesUsed++

                const pageProducts = await scrapeProductTiles()
                await emitProducts(pageProducts, category, canonicalUrl)
                log.info(`Page ${pageNum}: found ${pageProducts.length} product tiles`)
              } catch (e) {
                log.warn(`Error on page ${pagedUrl}: ${e}`)
                onError?.(pagedUrl)
                pagesUsed++
              }

              await saveProgress()
            }
          } else {
            const childHrefs = await page.$$eval(
              '[class*="category-navigation__list"] a[href]',
              (links) => links.map((a) => a.getAttribute('href') || '').filter(Boolean),
            )

            if (childHrefs.length === 0) {
              log.info(`No category nav links on ${canonicalUrl}, skipping`)
            } else {
              log.info(`Non-leaf page with ${childHrefs.length} child categories`)
              for (const href of childHrefs) {
                const childUrl = href.startsWith('http')
                  ? href
                  : `https://www.mueller.de${href}`
                queue.push(childUrl)
              }
            }
          }

          await saveProgress()
        } catch (e) {
          log.warn(`Error visiting ${canonicalUrl}: ${e}`)
          onError?.(canonicalUrl)
          await saveProgress()
        }
      }
    } finally {
      if (debug) {
        const page = browser.contexts()[0]?.pages()[0]
        if (page) {
          log.info(`Debug mode: browser kept open. Press "Resume" in the Playwright inspector to continue.`)
          await page.pause()
        }
      }
      await browser.close()
    }

    const done = queue.length === 0 && !currentLeaf
    log.info(`Tick done: ${pagesUsed} pages used, done=${done}`)
    return { done, pagesUsed }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean },
  ): Promise<ScrapedProductData | null> {
    try {
      log.info(`Scraping product: ${sourceUrl}`)

      const debug = options?.debug ?? false
      const browser = await launchBrowser({ headless: !debug })
      try {
        const page = await browser.newPage()
        await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('h1, [class*="product-info"]', { timeout: 15000 }).catch(() => {})
        await sleep(randomDelay(1000, 2000))

        if (debug) {
          log.info(`Debug mode: browser kept open for ${sourceUrl}. Press Ctrl+C to continue.`)
          await page.pause()
        }

        const scraped = await page.evaluate(() => {
          let jsonLd: Record<string, unknown> | null = null
          const ldScripts = document.querySelectorAll('script[type="application/ld+json"]')
          for (const script of ldScripts) {
            try {
              const parsed = JSON.parse(script.textContent || '')
              if (parsed['@type'] === 'Product') {
                jsonLd = parsed
                break
              }
            } catch { /* ignore */ }
          }

          const h1 = document.querySelector('h1')
          const name = h1?.textContent?.trim() || (jsonLd?.name as string) || null

          let brandName: string | null = null
          const brandImg = document.querySelector('a[class*="product-info"][class*="brand"] img')
          if (brandImg) {
            const alt = brandImg.getAttribute('alt') || ''
            brandName = alt.replace(/^Markenbild von\s*/i, '').trim() || null
          }
          if (!brandName && jsonLd) {
            const brand = jsonLd.brand as Record<string, unknown> | undefined
            brandName = (brand?.name as string) || null
          }

          let sourceArticleNumber: string | null = null
          const articleNrEl = document.querySelector('[class*="product-info__article-nr"]')
          if (articleNrEl) {
            const text = articleNrEl.textContent?.trim() || ''
            const match = text.match(/(\d+)/)
            sourceArticleNumber = match ? match[1] : null
          }
          if (!sourceArticleNumber) {
            const btn = document.querySelector('button[data-product-id]')
            sourceArticleNumber = btn?.getAttribute('data-product-id') || null
          }
          if (!sourceArticleNumber && jsonLd) {
            sourceArticleNumber = (jsonLd.sku as string) || null
          }

          let gtin: string | null = (jsonLd?.gtin as string) || null
          if (!gtin) {
            const allImgs = document.querySelectorAll('img[src], img[srcset]')
            for (const img of allImgs) {
              const src = img.getAttribute('src') || img.getAttribute('srcset') || ''
              const decoded = decodeURIComponent(src)
              const gtinMatch = decoded.match(/\/products\/(\d{8,14})\//)
              if (gtinMatch) {
                gtin = gtinMatch[1]
                break
              }
            }
          }

          let categoryUrl: string | null = null
          let categoryBreadcrumbs: string[] | null = null
          for (const script of ldScripts) {
            try {
              const parsed = JSON.parse(script.textContent || '')
              if (parsed['@type'] === 'BreadcrumbList' && Array.isArray(parsed.itemListElement)) {
                const items = parsed.itemListElement as Array<{ item?: string; name?: string }>
                // Skip first (Home) and last (product itself)
                const categoryItems = items.slice(1, -1)
                const names = categoryItems.map((el) => el.name).filter((n): n is string => !!n)
                if (names.length > 0) {
                  categoryBreadcrumbs = names
                }
                const urlItems = categoryItems.filter((el) => el.item)
                if (urlItems.length > 0) {
                  categoryUrl = urlItems[urlItems.length - 1].item ?? null
                }
              }
            } catch { /* ignore */ }
          }

          let priceCents: number | null = null
          let currency = 'EUR'
          if (jsonLd?.offers) {
            const offers = jsonLd.offers as Array<Record<string, unknown>> | Record<string, unknown>
            const offer = Array.isArray(offers) ? offers[0] : offers
            if (offer?.price != null) {
              priceCents = Math.round(Number(offer.price) * 100)
              currency = (offer.priceCurrency as string) || 'EUR'
            }
          }
          if (priceCents === null) {
            const priceEl = document.querySelector('[data-track-id="priceContainer"]')
            if (priceEl) {
              const priceText = priceEl.textContent?.trim() || ''
              const priceMatch = priceText.match(/([\d]+[,.][\d]+)\s*€/)
              if (priceMatch) {
                priceCents = Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
              }
            }
          }

          let perUnitAmount: number | null = null
          let perUnitQuantity: number | null = null
          let perUnitUnit: string | null = null
          const basePriceEl = document.querySelector('[class*="product-price__base-price"] span')
          if (basePriceEl) {
            const basePriceText = basePriceEl.textContent?.trim() || ''
            const perUnitMatch = basePriceText.match(/([\d]+[,.][\d]+)\s*€\s*\/\s*([\d]+(?:[,.]\d+)?)\s*(\w+)/)
            if (perUnitMatch) {
              perUnitAmount = Math.round(parseFloat(perUnitMatch[1].replace(',', '.')) * 100)
              perUnitQuantity = parseFloat(perUnitMatch[2].replace(',', '.'))
              perUnitUnit = perUnitMatch[3]
            }
          }

          const mutable = {
            amount: null as number | null,
            amountUnit: null as string | null,
            ingredientsRaw: null as string | null,
          }

          let rating: number | null = null
          const ratingNum: number | null = null
          const ratingContainer = document.querySelector('[class*="product-rating"]')
          if (ratingContainer) {
            const starImgs = ratingContainer.querySelectorAll('img')
            let filled = 0
            starImgs.forEach((img) => {
              const src = img.getAttribute('src') || ''
              const alt = img.getAttribute('alt') || ''
              if (!src.includes('star-rating-empty') && !alt.includes('star-rating-empty')) {
                filled++
              }
            })
            rating = filled
          }

          const images: Array<{ url: string; alt: string | null }> = []
          if (jsonLd?.image) {
            const ldImages = jsonLd.image as string[]
            if (Array.isArray(ldImages)) {
              ldImages.forEach((url) => {
                images.push({ url, alt: null })
              })
            }
          }
          if (images.length === 0) {
            const carouselImgs = document.querySelectorAll('[class*="carousel_component_carousel__item"] img[class*="image-section"]')
            const seenUrls = new Set<string>()
            carouselImgs.forEach((img) => {
              let src = img.getAttribute('src') || ''
              try {
                const urlObj = new URL(src, window.location.origin)
                const innerUrl = urlObj.searchParams.get('url')
                if (innerUrl) src = decodeURIComponent(innerUrl)
              } catch { /* use src as-is */ }
              if (src && !seenUrls.has(src)) {
                seenUrls.add(src)
                images.push({ url: src, alt: img.getAttribute('alt') || null })
              }
            })
          }

          const descriptionSections: string[] = []
          const accordionEntries = document.querySelectorAll('section[class*="accordion_component_accordion-entry"]')
          accordionEntries.forEach((section) => {
            const headingEl = section.querySelector('span[role="heading"]') as HTMLElement | null
            const headingText = headingEl?.innerText?.trim() || headingEl?.textContent?.trim()
            if (!headingText) return

            const contentEl = section.querySelector('[class*="accordion-entry__contents"]') as HTMLElement | null
            if (!contentEl) return

            const specsTable = contentEl.querySelector('table[class*="specifications-table"]')
            if (specsTable) {
              const rows = specsTable.querySelectorAll('tr')
              const rowParts: string[] = []
              rows.forEach((tr) => {
                const cells = tr.querySelectorAll('td, th')
                if (cells.length >= 2) {
                  const label = (cells[0] as HTMLElement).innerText?.trim() || (cells[0] as HTMLElement).textContent?.trim() || ''
                  const value = (cells[1] as HTMLElement).innerText?.trim() || (cells[1] as HTMLElement).textContent?.trim() || ''

                  if (label === 'Inhalt' && !mutable.amount) {
                    const amountMatch = value.match(/([\d]+(?:[,.]\d+)?)\s*(\w+)/)
                    if (amountMatch) {
                      mutable.amount = parseFloat(amountMatch[1].replace(',', '.'))
                      mutable.amountUnit = amountMatch[2]
                    }
                  }

                  if (label === 'Inhaltsstoffe') {
                    mutable.ingredientsRaw = value
                  }

                  rowParts.push(`### ${label}\n${value}`)
                }
              })
              descriptionSections.push(`## ${headingText}\n\n${rowParts.join('\n\n')}`)
            } else {
              const bodyText = contentEl.innerText?.trim() || contentEl.textContent?.trim() || ''
              if (bodyText) {
                descriptionSections.push(`## ${headingText}\n\n${bodyText}`)
              }
            }
          })

          const description = descriptionSections.length > 0
            ? descriptionSections.join('\n\n')
            : null

          const variants: Array<{
            dimension: string
            options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }>
          }> = []
          const attrWrappers = document.querySelectorAll('[class*="product-attribute-list__attribute-wrapper"]')
          attrWrappers.forEach((wrapper) => {
            const dimEl = wrapper.querySelector('div.text-lg') as HTMLElement | null
            if (!dimEl) return
            const dimText = dimEl.textContent?.trim() || ''
            const colonIdx = dimText.indexOf(':')
            const dimension = colonIdx > 0 ? dimText.substring(0, colonIdx).trim() : dimText
            if (!dimension) return

            const tileList = wrapper.querySelector('[class*="product-attribute-tile-list"]')
            if (!tileList) return

            const options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }> = []
            const tiles = tileList.querySelectorAll(':scope > div')
            tiles.forEach((tile) => {
              const img = tile.querySelector('img[alt]')
              const label = img?.getAttribute('alt') || ''
              if (!label) return

              let tileGtin: string | null = null
              const imgSrc = img?.getAttribute('src') || img?.getAttribute('srcset') || ''
              const decoded = decodeURIComponent(imgSrc)
              const gtinMatch = decoded.match(/_default_upload_bucket\/(\d{8,14})_/)
              if (gtinMatch) tileGtin = gtinMatch[1]

              const contentEl = tile.querySelector('[class*="product-attribute-tile__content"]')
              const isSelected = contentEl?.className?.includes('--selected') ?? false

              let value: string | null = null
              const link = tile.querySelector('a[href]')
              if (link) {
                const href = link.getAttribute('href') || ''
                const itemMatch = href.match(/itemId=(\d+)/)
                value = itemMatch ? itemMatch[1] : null
              }

              options.push({ label, value, gtin: tileGtin, isSelected })
            })

            if (options.length > 0) {
              variants.push({ dimension, options })
            }
          })

          return {
            name,
            brandName,
            sourceArticleNumber,
            gtin,
            categoryUrl,
            categoryBreadcrumbs,
            description,
            ingredientsRaw: mutable.ingredientsRaw,
            priceCents,
            currency,
            amount: mutable.amount,
            amountUnit: mutable.amountUnit,
            perUnitAmount,
            perUnitQuantity,
            perUnitUnit,
            images,
            variants,
            rating,
            ratingNum,
          }
        })

        if (!scraped.name) {
          log.info(`No product name found on page for ${sourceUrl}`)
          return null
        }

        // Raw ingredients text (stored as-is, parsed during aggregation)
        const ingredientsText = scraped.ingredientsRaw || undefined
        if (ingredientsText) {
          log.info(`Found ingredients text (${ingredientsText.length} chars)`)
        }

        // Calculate per-unit price if not found in DOM
        let perUnitAmount = scraped.perUnitAmount ?? undefined
        let perUnitQuantity = scraped.perUnitQuantity ?? undefined
        let perUnitUnit = scraped.perUnitUnit ?? undefined
        if (!perUnitAmount && scraped.priceCents && scraped.amount && scraped.amountUnit) {
          const u = scraped.amountUnit.toLowerCase()
          if (u === 'ml' || u === 'g') {
            perUnitAmount = Math.round(scraped.priceCents / scraped.amount * 100)
            perUnitQuantity = 100
            perUnitUnit = u
          } else if (u === 'l' || u === 'kg') {
            perUnitAmount = Math.round(scraped.priceCents / scraped.amount)
            perUnitQuantity = 1
            perUnitUnit = u
          } else {
            perUnitAmount = Math.round(scraped.priceCents / scraped.amount)
            perUnitQuantity = 1
            perUnitUnit = scraped.amountUnit
          }
        }

        log.debug(`Category for ${sourceUrl}: breadcrumbs=${scraped.categoryBreadcrumbs ? scraped.categoryBreadcrumbs.join(' -> ') : '(none)'}, categoryUrl=${scraped.categoryUrl ?? '(none)'}`)

        return {
          gtin: scraped.gtin ?? undefined,
          name: scraped.name,
          brandName: scraped.brandName ?? undefined,
          description: scraped.description ?? undefined,
          ingredientsText,
          priceCents: scraped.priceCents ?? undefined,
          currency: scraped.currency,
          amount: scraped.amount ?? undefined,
          amountUnit: scraped.amountUnit ?? undefined,
          images: scraped.images,
          variants: scraped.variants,
          rating: scraped.rating ?? undefined,
          ratingNum: scraped.ratingNum ?? undefined,
          sourceArticleNumber: scraped.sourceArticleNumber ?? undefined,
          categoryBreadcrumbs: scraped.categoryBreadcrumbs ?? undefined,
          categoryUrl: scraped.categoryUrl ?? undefined,
          perUnitAmount,
          perUnitQuantity,
          perUnitUnit,
          warnings: [],
        }
      } finally {
        await browser.close()
      }
    } catch (error) {
      log.error(`Error scraping product (url: ${sourceUrl}): ${String(error)}`)
      return null
    }
  },

}
