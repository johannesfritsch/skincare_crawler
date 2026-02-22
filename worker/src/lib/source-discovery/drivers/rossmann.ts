import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ScrapedProductData } from '../types'
import { launchBrowser } from '@/lib/browser'
import { parseIngredients } from '@/lib/parse-ingredients'
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
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages } = options
    const savedProgress = options.progress as RossmannProductDiscoveryProgress | undefined

    log.info(`Starting browser-based discovery for ${url} (delay=${delay}ms, maxPages=${maxPages ?? 'unlimited'})`)

    const visitedUrls = new Set<string>(savedProgress?.visitedUrls ?? [])
    const seenProductUrls = new Set<string>() // within-tick dedup only, not persisted
    const queue: string[] = savedProgress?.queue ?? [url]
    let currentLeaf = savedProgress?.currentLeaf ?? undefined
    let pagesUsed = 0

    function budgetExhausted(): boolean {
      return maxPages !== undefined && pagesUsed >= maxPages
    }

    const browser = await launchBrowser()

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
          const productUrl = p.href ? `https://www.rossmann.de${p.href}` : null
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
                const ecom = (entry as Record<string, unknown>).ecommerce as Record<string, unknown> | undefined
                const viewItem = ecom?.view_item as Record<string, unknown> | undefined
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

        // Parse ingredients
        let ingredientNames: string[] = []
        if (scraped.ingredientsRaw) {
          log.debug(`Raw ingredients for ${sourceUrl}: ${scraped.ingredientsRaw}`)
          ingredientNames = await parseIngredients(scraped.ingredientsRaw)
          log.info(`Parsed ${ingredientNames.length} ingredients`)
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
          ingredientNames,
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
