import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ScrapedProductData } from '../types'
import { launchBrowser } from '@/lib/browser'

import { normalizeProductUrl } from '@/lib/source-product-queries'
import { createLogger } from '@/lib/logger'

const log = createLogger('Rossmann')

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

interface RossmannProductDiscoveryProgress {
  queue: string[]
  visitedUrls: string[]
  currentLeaf?: {
    categoryUrl: string
    category: string
    nextPageIndex: number
  }
}

function buildCategoryFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    // Extract segments between /de/ and /c/
    const match = pathname.match(/\/de\/(.+?)\/c\//)
    if (!match) return ''
    return match[1]
      .split('/')
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

export const rossmannDriver: SourceDriver = {
  slug: 'rossmann',
  label: 'Rossmann',
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1685 236"><path fill="#fff" d="M402.4 118.2a110.9 112.3 0 0 1-221.8 0 110.9 112.3 0 0 1 221.8 0Z"/><g fill="#c3002d" transform="matrix(8.5 0 0 8.5-5-19.3)"><path d="m116.1 3.6c0-.2-.2-.3-.3-.3h-1.3c-.1 0-.2 0-.3.2s-7.8 18.2-7.9 18.5c-.1.3-.3.3-.4-.1-.1-.2-8.4-18.3-8.5-18.4-.1-.2-.2-.2-.4-.2h-1.4c-.1 0-.2 0-.3.2L92 28.3c0 .1 0 .4.3.4h1.7c.2 0 .4-.1.5-.4l2.6-16.8c0-.3.1-.3.2 0l7.8 17c.1.1.2.2.2.2h.9c.1 0 .2-.1.2-.2l7.2-16.9c.1-.3.2-.3.3 0l3 16.8c0 .2.2.3.4.3h3.4c.2 0 .4-.2.4-.4l-4.4-24.7z"/><path d="m136.4 18.1c.1.2.1.4-.3.4h-7.2c-.3 0-.4-.1-.3-.4l3.6-8.3c.1-.3.3-.2.4 0l3.7 8.4zm-1.8-14c-.3-.7-.6-.8-.9-.8h-1c-.1 0-.2 0-.3.3L121.9 28c-.1.3-.1.5.3.5h1.9c.2 0 .3-.1.4-.3l3.1-7.1c.2-.3.4-.3.6-.3h9.3c.2 0 .4 0 .5.3l3.1 7.1c.1.2.3.4.5.4h3.5c.3 0 .4-.3.3-.5L134.6 4.1z"/><path d="M76.3 8.6c0-1.9 1.3-3.3 3.1-3.7 1.7-.4 3.9 0 5 1.5.2.2.3.4.4.7.1.2.3.3.6.3h.6c.2 0 .4-.1.4-.4L86.3 4.5c0-.3-.2-.4-.4-.5-.9-.4-1.8-.7-2.8-.9-2.3-.4-4.7-.3-6.8.6-2 .8-3.5 2.4-4.1 4.5-.5 1.6-.3 3.4.6 4.9.8 1.3 2 2.2 3.4 2.8l4.3 1.8c1.8.8 3.1 1.6 3.6 3.1.5 1.8.2 3.8-1.3 5.1-2 1.8-7.4 1.5-9.2-1.1-.3-.5-.4-.8-.9-.8h-.8c0 .4 0 2.1 0 2.8 0 .3 0 .6.3.7.6.2 1.2.5 1.8.7 1 .3 1.9.5 3 .6 6.5.7 11.3-2.6 11.3-8.3 0-2-.7-4-2.4-5.3-1.4-1-3.3-1.7-4.9-2.2-1-.3-2.1-.7-3-1.3-1.2-.8-1.8-2-1.8-3.4"/><path d="M34.9 2.3c-7.7 0-13.9 6.2-13.9 13.9s6.2 13.9 13.9 13.9 13.9-6.2 13.9-13.9-6.2-13.9-13.9-13.9zm0 2.4c3.5 0 6.5 1.5 8.6 4h-4L39.9 7.9c.4-.9-1.2-1.7-1.6-.7L37.6 8.7H26.3c2.1-2.4 5.2-3.9 8.6-3.9zm-11.4 11.4c0-2.2.6-4.3 1.7-6l10.7.5c.1 0 .3 0 .3.2l1.1 2.6c.1.1.1.4-.4.4h-10.3c-.7 0-1.3.6-1.3 1.3v3.9c0 .3.1.6.3.8.3.3.8.5.9.5.1.1.2 0 .2-.1V12.8c0-.1.1-.2.2-.2h1.1c0 0 .2 0 .1.1-.3.5-.5 1-.5 1.9 0 1.4 1 2.4 1.4 2.6 0 0 .1.1 0 .2l-1 2.1c-.1.1-.1.2 0 .3l5 5c-5.9-.8-10-5.5-10-10.2zm12 11.4-5.2-5.2c-.1-.1 0-.2 0-.3l1.8-3.4c.1-.2.2-.2.3-.2h1.1c0 0 .2 0 .1.2l-1.6 3.2c0 .1 0 .2 0 .2l5.2 5.2c-.6.1-1.2.2-1.8.2zm3.7-.8-4.6-4.6c-.1-.1-.1-.2 0-.3l1.6-3.3c.1-.1.2-.2.3-.2h2.9c.1 0 .1.1.1.2l-.8 1.7c0 0 0 .2.1.2l1.1.7c.1.1.2 0 .3-.1l1.1-2.6c.1-.1.2-.2.3-.2h1c0 0 .2 0 .1.2l-.8 1.8c0 0 0 .2.1.2l1.1.7c.1.1.2 0 .3-.1l1.3-2.9c.3-.7.2-1.9-1.2-1.9h-1.6c-.2 0-.2-.1-.2-.2V11.1c0-.2.1-.3.3-.3l2.9-.5c1.1 1.7 1.7 3.8 1.7 6 0 4.8-3 8.9-7.1 10.6z"/><path d="M56.8 8.6c0-1.9 1.3-3.3 3.1-3.7 1.7-.4 3.9 0 5 1.5.2.2.3.4.4.7.1.2.3.3.6.3h.6c.2 0 .4-.1.4-.4L67 4.5c0-.3-.2-.4-.4-.5-.9-.4-1.8-.7-2.8-.9-2.3-.4-4.7-.3-6.8.6-2 .8-3.5 2.4-4.1 4.5-.4 1.6-.3 3.4.6 4.9.8 1.3 2 2.2 3.4 2.8l4.3 1.8c1.8.8 3.1 1.6 3.6 3.1.5 1.8.2 3.8-1.3 5.1-2 1.8-7.4 1.5-9.2-1.1-.3-.5-.4-.8-.9-.8h-.8c0 .4 0 2.1 0 2.8 0 .3 0 .6.3.7.6.2 1.2.5 1.8.7 1 .3 1.9.5 3 .6 6.5.7 11.3-2.6 11.3-8.3 0-2-.7-4-2.4-5.3-1.4-1-3.3-1.7-4.9-2.2-1-.3-2.1-.7-3-1.3-1.2-.8-1.8-2-1.8-3.4"/><path d="m198.8 3.8c0-.2-.2-.4-.4-.4h-1.7c-.2 0-.4.2-.4.4v17.1c0 .5-.2.6-.4.3L178.9 3.6c-.2-.2-.4-.2-.6-.2h-1.3c-.2 0-.4.2-.4.4v24.6c0 .2.2.4.4.4h1.7c.2 0 .4-.2.4-.4V11.1c0-.7.4-.3.6-.1l16.8 17.7c.2.3.4.3.6.3h1.1c.2 0 .4-.2.4-.4V3.8z"/><path d="m170.4 3.8c0-.2-.2-.4-.4-.4h-1.8c-.2 0-.4.2-.4.4v17.1c0 .5-.1.6-.4.3l-16.7-17.6c-.2-.2-.4-.2-.5-.2h-1.4c-.2 0-.4.2-.4.4v24.6c0 .2.2.4.4.4h1.7c.2 0 .4-.2.4-.4V11.1c0-.7.4-.3.6-.1l16.8 17.7c.2.3.4.3.6.3h1.1c.2 0 .4-.2.4-.4V3.8z"/><path d="M20.4 28.1c-.4-.5-7.8-9.9-8.2-10.5-.2-.2-.1-.4.3-.6 1.1-.4 4.8-2.1 5-6.5.2-3.7-2.4-7.2-6.5-7.2H1c-.2 0-.4.2-.4.4v24.6c0 .2.2.4.4.4h3.1c.2 0 .4-.1.4-.4V17.6c0-.2.2-.4.4-.4h1.8c.1 0 .4 0 .7.3l8.2 10.6c.2.2.4.3.5.3h3.8c.3 0 .6-.4.3-.7zM6.6 15.2H5c-.2 0-.4-.2-.4-.4V6c0-.2.2-.4.4-.4h2.7c2.8 0 5.5.8 5.5 4.5 0 1.8-.9 5.2-6.5 5.2z"/></g></svg>',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.rossmann.de' || hostname === 'rossmann.de'
    } catch {
      return false
    }
  },

  async discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult> {
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages, debug = false } = options
    const savedProgress = options.progress as RossmannProductDiscoveryProgress | undefined

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

      function scrapeProductCards() {
        return page.$$eval(
          '[data-testid="product-card"]',
          (cards) =>
            cards.map((card) => {
              const gtin = card.getAttribute('data-item-ean') || ''
              const name = card.getAttribute('data-item-name') || ''
              const brand = card.getAttribute('data-item-brand') || ''
              const imageLink = card.querySelector('figure[data-testid="product-image"] a[href]')
              const href = imageLink?.getAttribute('href') || ''
              const priceEl = card.querySelector('[data-testid="product-price"] .sr-only')
              const priceText = priceEl?.textContent || ''
              const priceMatch = priceText.match(/([\d]+[,.][\d]+)\s*€/)
              let priceCents: number | null = null
              if (priceMatch) {
                priceCents = Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
              }
              const ratingsContainer = card.querySelector('[data-testid="product-ratings"]')
              let rating: number | null = null
              let ratingCount: number | null = null
              if (ratingsContainer) {
                const filledStars = ratingsContainer.querySelectorAll('svg.text-red')
                rating = filledStars.length
                const partialContainer = ratingsContainer.querySelector('[style*="width"]')
                if (partialContainer) {
                  const style = partialContainer.getAttribute('style') || ''
                  const widthMatch = style.match(/width:\s*([\d.]+)%/)
                  if (widthMatch) {
                    rating = (rating > 0 ? rating - 1 : 0) + parseFloat(widthMatch[1]) / 100
                  }
                }
                const spans = ratingsContainer.querySelectorAll('span')
                const lastSpan = spans[spans.length - 1]
                if (lastSpan) {
                  const countMatch = lastSpan.textContent?.match(/(\d+)/)
                  if (countMatch) {
                    ratingCount = parseInt(countMatch[1], 10)
                  }
                }
              }
              return { gtin, name, brand, href, priceCents, rating, ratingCount }
            }),
        )
      }

      async function emitProducts(products: Awaited<ReturnType<typeof scrapeProductCards>>, category: string, categoryUrl: string) {
        for (const p of products) {
          const productUrl = p.href ? normalizeProductUrl(`https://www.rossmann.de${p.href}`) : null
          if (!productUrl || seenProductUrls.has(productUrl)) continue
          seenProductUrls.add(productUrl)
          await onProduct({
            gtin: p.gtin || undefined,
            productUrl,
            brandName: p.brand || undefined,
            name: p.name || undefined,
            price: p.priceCents ?? undefined,
            currency: 'EUR',
            rating: p.rating ?? undefined,
            ratingCount: p.ratingCount ?? undefined,
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
        } satisfies RossmannProductDiscoveryProgress)
      }

      // Get the 0-based index of the last page from numbered pagination links
      // e.g. data-testid="search-page-2" means last page is index 1
      function getLastPageIndex() {
        return page.$$eval(
          'a[data-testid^="search-page-"]',
          (links) => {
            let max = 0
            for (const link of links) {
              const testId = link.getAttribute('data-testid') || ''
              const match = testId.match(/search-page-(\d+)/)
              if (match) {
                const idx = parseInt(match[1], 10) - 1
                if (idx > max) max = idx
              }
            }
            return max
          },
        ).catch(() => 0)
      }

      // Resume paginating a leaf if we were mid-leaf
      if (currentLeaf) {
        const { categoryUrl, category, nextPageIndex } = currentLeaf
        let pageIndex = nextPageIndex

        while (true) {
          if (budgetExhausted()) {
            currentLeaf = { ...currentLeaf, nextPageIndex: pageIndex }
            await saveProgress()
            return { done: false, pagesUsed }
          }

          const baseUrl = categoryUrl.split('?')[0]
          const nextUrl = `${baseUrl}?pageIndex=${pageIndex}`
          log.info(`Resuming leaf page ${pageIndex}: ${nextUrl}`)

          try {
            await page.goto(nextUrl, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('[data-testid="product-card"], nav[data-testid="category-nav-desktop"]', { timeout: 15000 }).catch(() => {})
            await sleep(jitteredDelay(delay))
            pagesUsed++

            const products = await scrapeProductCards()
            await emitProducts(products, category, categoryUrl)
            log.info(`Leaf page ${pageIndex}: found ${products.length} product cards`)

            const lastIdx = await getLastPageIndex()
            if (pageIndex >= lastIdx) break
            pageIndex++
          } catch (e) {
            log.warn(`Error on page ${nextUrl}: ${e}`)
            onError?.(nextUrl)
            pagesUsed++
            break
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
          : `https://www.rossmann.de${currentUrl}`

        if (visitedUrls.has(canonicalUrl)) continue
        visitedUrls.add(canonicalUrl)

        try {
          log.info(`Visiting: ${canonicalUrl}`)
          await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded' })
          await page.waitForSelector('[data-testid="product-card"], nav[data-testid="category-nav-desktop"]', { timeout: 15000 }).catch(() => {})
          await sleep(jitteredDelay(delay))
          pagesUsed++

          const navInfo = await page.$$eval(
            'nav[data-testid="category-nav-desktop"] ul li a',
            (links) => links.map((a) => ({
              href: a.getAttribute('href') || '',
              isBold: a.classList.contains('font-bold'),
            })),
          )

          const isLeaf = navInfo.some((link) => link.isBold)

          if (isLeaf) {
            const category = buildCategoryFromUrl(canonicalUrl)
            const products = await scrapeProductCards()
            await emitProducts(products, category, canonicalUrl)
            log.info(`Leaf page 0: found ${products.length} product cards`)

            await saveProgress()

            // Check for next page and paginate
            let pageIndex = 0
            while (true) {
              const lastIdx = await getLastPageIndex()
              if (pageIndex >= lastIdx) break

              pageIndex++

              if (budgetExhausted()) {
                currentLeaf = { categoryUrl: canonicalUrl, category, nextPageIndex: pageIndex }
                await saveProgress()
                return { done: false, pagesUsed }
              }

              const baseUrl = canonicalUrl.split('?')[0]
              const nextUrl = `${baseUrl}?pageIndex=${pageIndex}`
              log.info(`Navigating to next page: ${nextUrl}`)

              try {
                await page.goto(nextUrl, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector('[data-testid="product-card"]', { timeout: 15000 }).catch(() => {})
                await sleep(jitteredDelay(delay))
                pagesUsed++

                const pageProducts = await scrapeProductCards()
                await emitProducts(pageProducts, category, canonicalUrl)
                log.info(`Leaf page ${pageIndex}: found ${pageProducts.length} product cards`)
              } catch (e) {
                log.warn(`Error on page ${nextUrl}: ${e}`)
                onError?.(nextUrl)
                pagesUsed++
                break
              }

              await saveProgress()
            }
          } else {
            const childHrefs = navInfo.map((link) => link.href).filter(Boolean)

            if (childHrefs.length === 0) {
              log.info(`No nav links on ${canonicalUrl}, skipping`)
            } else {
              log.info(`Parent page with ${childHrefs.length} child categories`)
              for (const href of childHrefs) {
                const childUrl = href.startsWith('http')
                  ? href
                  : `https://www.rossmann.de${href}`
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
        await page.waitForSelector('.rm-product__title', { timeout: 15000 }).catch(() => {})
        await sleep(randomDelay(1000, 2000))

        // Wait for BazaarVoice rating widget to render (loads async via JS)
        await page
          .waitForSelector('.bv_avgRating_component_container', {
            timeout: 15000,
          })
          .catch(() => {})

        if (debug) {
          log.info(`Debug mode: browser kept open for ${sourceUrl}. Press Ctrl+C to continue.`)
          await page.pause()
        }

        // Scrape all fields in one page.evaluate call
        const scraped = await page.evaluate(() => {
          const nameEl = document.querySelector('.rm-product__title')
          const name = nameEl?.textContent?.trim() || null

          const brandEl = document.querySelector('.rm-product__brand')
          const brandName = brandEl?.textContent?.trim() || null

          const danEl = document.querySelector('[data-jsevent="obj:product__dan"]')
          const sourceArticleNumber = danEl?.getAttribute('data-value') || null

          const eanEl = document.querySelector('[data-item-ean]')
          const gtinFromPage = eanEl?.getAttribute('data-item-ean') || null

          const descriptionSections: string[] = []
          const headings = document.querySelectorAll('h2')
          headings.forEach((h2) => {
            const headingText = (h2 as HTMLElement).innerText?.trim()
            if (!headingText) return
            const parent = h2.parentElement
            if (!parent) return
            const bodyDiv = parent.querySelector(':scope > div') as HTMLElement | null
            const bodyText = bodyDiv?.innerText?.trim()
            if (bodyText) {
              descriptionSections.push(`## ${headingText}\n\n${bodyText}`)
            }
          })
          const description = descriptionSections.length > 0
            ? descriptionSections.join('\n\n')
            : null

          const ingredientsSection = document.getElementById('GRP_INHALTSSTOFFE')
          const ingredientsRaw = ingredientsSection
            ?.querySelector('.rm-cms')
            ?.textContent?.trim() || null

          const priceMeta = document.querySelector('meta[itemprop="price"]')
          const priceValue = priceMeta?.getAttribute('content')
          const priceCents = priceValue
            ? Math.round(parseFloat(priceValue) * 100)
            : null

          const currencyMeta = document.querySelector('meta[itemprop="priceCurrency"]')
          const currency = currencyMeta?.getAttribute('content') || 'EUR'

          const unitsEl = document.querySelector('.rm-product__units')
          const unitsText = unitsEl?.textContent?.trim() || ''
          let amount: number | null = null
          let amountUnit: string | null = null
          const amountMatch = unitsText.match(/^([\d,.]+)\s*(\w+)/)
          if (amountMatch) {
            amount = parseFloat(amountMatch[1].replace(',', '.'))
            amountUnit = amountMatch[2]
          }

          const imageSlides = document.querySelectorAll(
            '.rm-product__image-main:first-of-type .swiper-slide:not(.swiper-slide-duplicate) .rm-product__lens[data-image]',
          )
          const images: Array<{ url: string; alt: string | null }> = []
          imageSlides.forEach((slide) => {
            const url = slide.getAttribute('data-image')
            if (url) {
              const imgEl = slide.querySelector('img[itemprop="image"]')
              const alt = imgEl?.getAttribute('alt') || null
              images.push({ url, alt })
            }
          })

          const variants: Array<{
            dimension: string
            options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }>
          }> = []
          const variantList = document.querySelector('.rm-variations__list')
          if (variantList) {
            const typeEl = variantList.querySelector('[class*="rm-variations__"]')
            let dimension = 'Variant'
            if (typeEl) {
              const classMatch = typeEl.className.match(/rm-variations__(\w+)/)
              if (classMatch && classMatch[1] !== 'list') {
                dimension = classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1)
              }
            }
            const items = variantList.querySelectorAll('li.rm-input__option')
            const options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }> = []
            items.forEach((li) => {
              const link = li.querySelector('a') as HTMLElement | null
              const linkText = link?.textContent?.trim() || ''
              const href = link?.getAttribute('href') || ''
              const gtinMatch = href.match(/\/p\/(\d+)/)
              const optGtin = gtinMatch ? gtinMatch[1] : null
              const isSelected = li.classList.contains('active')
              if (linkText) {
                options.push({ label: linkText, value: null, gtin: optGtin, isSelected })
              }
            })
            if (options.length > 0) {
              variants.push({ dimension, options })
            }
          }

          let rating: number | null = null
          let ratingNum: number | null = null
          const bvRatingEl = document.querySelector('.bv_avgRating_component_container') as HTMLElement | null
          if (bvRatingEl) {
            const val = parseFloat(bvRatingEl.innerText.trim())
            if (!isNaN(val)) rating = val
          }
          const bvCountEl = document.querySelector('.bv_numReviews_component_container') as HTMLElement | null
          if (bvCountEl) {
            const countMatch = bvCountEl.innerText.match(/(\d+)/)
            if (countMatch) ratingNum = parseInt(countMatch[1], 10)
          }

          let categoryPath: string[] | null = null
          try {
            const dl = (window as unknown as Record<string, unknown[]>).dataLayer
            if (Array.isArray(dl)) {
              for (const entry of dl) {
                const e = entry as Record<string, unknown>
                // Rossmann pushes view_item at the top level, not inside ecommerce
                const viewItem = (e.view_item ?? (e.ecommerce as Record<string, unknown> | undefined)?.view_item) as Record<string, unknown> | undefined
                const items = viewItem?.items as Array<Record<string, unknown>> | undefined
                const itemCategory = items?.[0]?.item_category as string | undefined
                if (itemCategory) {
                  categoryPath = itemCategory.split('/').filter(Boolean)
                  break
                }
              }
            }
          } catch { /* dataLayer not available */ }

          return {
            name,
            brandName,
            sourceArticleNumber,
            gtinFromPage,
            description,
            ingredientsRaw,
            priceCents,
            currency,
            amount,
            amountUnit,
            images,
            variants,
            rating,
            ratingNum,
            categoryPath,
          }
        })

        if (!scraped.name) {
          log.info(`No product name found on page for ${sourceUrl}`)
          return null
        }

        const gtin = scraped.gtinFromPage || sourceUrl.match(/\/p\/(\d+)/)?.[1] || null

        // Raw ingredients text (stored as-is, parsed during aggregation)
        const ingredientsText = scraped.ingredientsRaw || undefined
        if (ingredientsText) {
          log.info(`Found ingredients text (${ingredientsText.length} chars)`)
        }

        // Calculate per-unit price from amount
        let perUnitAmount: number | undefined
        let perUnitQuantity: number | undefined
        let perUnitUnit: string | undefined
        if (scraped.priceCents && scraped.amount && scraped.amountUnit) {
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

        const warnings: string[] = []

        return {
          gtin: gtin ?? undefined,
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
          categoryBreadcrumbs: scraped.categoryPath ?? undefined,
          perUnitAmount,
          perUnitQuantity,
          perUnitUnit,
          warnings,
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
