import type { Payload, Where } from 'payload'
import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, CrawlProductResult } from '../types'
import { launchBrowser } from '@/lib/browser'
import { parseIngredients } from '@/lib/parse-ingredients'
import { lookupCategoryByPath } from '@/lib/lookup-source-category'

const SOURCE_ROSSMANN_FILTER: Where = {
  source: { equals: 'rossmann' },
}

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

    console.log(`[Rossmann] Starting browser-based discovery for ${url} (delay=${delay}ms, maxPages=${maxPages ?? 'unlimited'})`)

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
          console.log(`[Rossmann] Resuming leaf page ${pageIndex}: ${nextUrl}`)

          try {
            await page.goto(nextUrl, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('[data-testid="product-card"], nav[data-testid="category-nav-desktop"]', { timeout: 15000 }).catch(() => {})
            await sleep(jitteredDelay(delay))
            pagesUsed++

            const products = await scrapeProductCards()
            await emitProducts(products, category, categoryUrl)
            console.log(`[Rossmann] Leaf page ${pageIndex}: found ${products.length} product cards`)

            const lastIdx = await getLastPageIndex()
            if (pageIndex >= lastIdx) break
            pageIndex++
          } catch (e) {
            console.warn(`[Rossmann] Error on page ${nextUrl}: ${e}`)
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
          console.log(`[Rossmann] Visiting: ${canonicalUrl}`)
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
            console.log(`[Rossmann] Leaf page 0: found ${products.length} product cards`)

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
              console.log(`[Rossmann] Navigating to next page: ${nextUrl}`)

              try {
                await page.goto(nextUrl, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector('[data-testid="product-card"]', { timeout: 15000 }).catch(() => {})
                await sleep(jitteredDelay(delay))
                pagesUsed++

                const pageProducts = await scrapeProductCards()
                await emitProducts(pageProducts, category, canonicalUrl)
                console.log(`[Rossmann] Leaf page ${pageIndex}: found ${pageProducts.length} product cards`)
              } catch (e) {
                console.warn(`[Rossmann] Error on page ${nextUrl}: ${e}`)
                onError?.(nextUrl)
                pagesUsed++
                break
              }

              await saveProgress()
            }
          } else {
            const childHrefs = navInfo.map((link) => link.href).filter(Boolean)

            if (childHrefs.length === 0) {
              console.log(`[Rossmann] No nav links on ${canonicalUrl}, skipping`)
            } else {
              console.log(`[Rossmann] Parent page with ${childHrefs.length} child categories`)
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
          console.warn(`[Rossmann] Error visiting ${canonicalUrl}: ${e}`)
          onError?.(canonicalUrl)
          await saveProgress()
        }
      }
    } finally {
      await browser.close()
    }

    const done = queue.length === 0 && !currentLeaf
    console.log(`[Rossmann] Tick done: ${pagesUsed} pages used, done=${done}`)
    return { done, pagesUsed }
  },

  async crawlProduct(
    sourceUrl: string,
    payload: Payload,
    options?: { debug?: boolean },
  ): Promise<CrawlProductResult> {
    const warnings: string[] = []
    try {
      // Find existing source-product by sourceUrl
      const existing = await payload.find({
        collection: 'source-products',
        where: { and: [{ sourceUrl: { equals: sourceUrl } }, SOURCE_ROSSMANN_FILTER] },
        limit: 1,
      })

      console.log(`[Rossmann] Crawling product: ${sourceUrl}`)

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
          console.log(`[Rossmann] Debug mode: browser kept open for ${sourceUrl}. Press Ctrl+C to continue.`)
          await page.pause()
        }

        // Scrape all fields in one page.evaluate call
        const scraped = await page.evaluate(() => {
          // Name
          const nameEl = document.querySelector('.rm-product__title')
          const name = nameEl?.textContent?.trim() || null

          // Brand
          const brandEl = document.querySelector('.rm-product__brand')
          const brandName = brandEl?.textContent?.trim() || null

          // Source article number (DAN)
          const danEl = document.querySelector('[data-jsevent="obj:product__dan"]')
          const sourceArticleNumber = danEl?.getAttribute('data-value') || null

          // GTIN from EAN data attribute or URL
          const eanEl = document.querySelector('[data-item-ean]')
          const gtinFromPage = eanEl?.getAttribute('data-item-ean') || null

          // Category is now handled via sourceCategory relationship (no type string needed)

          // Description: find all h2 headings, take innerText, then
          // go to parent and get the first direct child div's innerText as body
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

          // Ingredients raw text
          const ingredientsSection = document.getElementById('GRP_INHALTSSTOFFE')
          const ingredientsRaw = ingredientsSection
            ?.querySelector('.rm-cms')
            ?.textContent?.trim() || null

          // Price
          const priceMeta = document.querySelector('meta[itemprop="price"]')
          const priceValue = priceMeta?.getAttribute('content')
          const priceCents = priceValue
            ? Math.round(parseFloat(priceValue) * 100)
            : null

          // Currency
          const currencyMeta = document.querySelector('meta[itemprop="priceCurrency"]')
          const currency = currencyMeta?.getAttribute('content') || 'EUR'

          // Product amount from units text, e.g. "3 ml", "100 ml (23,02 € je 100 ml)"
          const unitsEl = document.querySelector('.rm-product__units')
          const unitsText = unitsEl?.textContent?.trim() || ''
          let amount: number | null = null
          let amountUnit: string | null = null
          const amountMatch = unitsText.match(/^([\d,.]+)\s*(\w+)/)
          if (amountMatch) {
            amount = parseFloat(amountMatch[1].replace(',', '.'))
            amountUnit = amountMatch[2]
          }

          // Images from product gallery
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

          // Variants from rm-variations__list
          const variants: Array<{
            dimension: string
            options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }>
          }> = []
          const _variantDebug: Record<string, unknown> = {}
          const variantList = document.querySelector('.rm-variations__list')
          _variantDebug.found = !!variantList
          if (!variantList) {
            // Try broader search for debug
            const byId = document.getElementById('sortOptions')
            const byClass = document.querySelector('[class*="rm-variations"]')
            _variantDebug.byId = byId ? byId.className : null
            _variantDebug.byClass = byClass ? byClass.className : null
          }
          if (variantList) {
            _variantDebug.html = (variantList as HTMLElement).innerHTML.substring(0, 500)
            // Derive dimension from the child element class, e.g. "rm-variations__color" → "Color"
            const typeEl = variantList.querySelector('[class*="rm-variations__"]')
            let dimension = 'Variant'
            _variantDebug.typeElClass = typeEl?.className || null
            if (typeEl) {
              const classMatch = typeEl.className.match(/rm-variations__(\w+)/)
              if (classMatch && classMatch[1] !== 'list') {
                dimension = classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1)
              }
            }
            _variantDebug.dimension = dimension
            const items = variantList.querySelectorAll('li.rm-input__option')
            _variantDebug.itemCount = items.length
            const options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }> = []
            items.forEach((li, i) => {
              const link = li.querySelector('a') as HTMLElement | null
              const linkText = link?.textContent?.trim() || ''
              const href = link?.getAttribute('href') || ''
              const gtinMatch = href.match(/\/p\/(\d+)/)
              const optGtin = gtinMatch ? gtinMatch[1] : null
              const isSelected = li.classList.contains('active')
              ;(_variantDebug as Record<string, unknown>)[`item${i}`] = { linkText, href, optGtin }
              if (linkText) {
                options.push({ label: linkText, value: null, gtin: optGtin, isSelected })
              }
            })
            _variantDebug.optionCount = options.length
            if (options.length > 0) {
              variants.push({ dimension, options })
            }
          }

          // Rating from BazaarVoice widget
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

          // Category path from dataLayer
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

          // Current page URL (in case of redirect)
          const currentUrl = window.location.href

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
            _variantDebug,
            rating,
            ratingNum,
            categoryPath,
            currentUrl,
          }
        })

        console.log(`[Rossmann] Variant debug for ${sourceUrl}:`, JSON.stringify(scraped._variantDebug, null, 2))

        if (!scraped.name) {
          console.log(`[Rossmann] No product name found on page for ${sourceUrl}`)
          return { productId: null, warnings }
        }

        // Extract GTIN from page or URL
        const gtin = scraped.gtinFromPage || sourceUrl.match(/\/p\/(\d+)/)?.[1] || null

        // Look up SourceCategory by path
        let sourceCategoryId: number | null = null
        if (scraped.categoryPath && scraped.categoryPath.length > 0) {
          sourceCategoryId = await lookupCategoryByPath(payload, scraped.categoryPath, 'rossmann')
          if (!sourceCategoryId) {
            warnings.push(`No SourceCategory found for path: ${scraped.categoryPath.join(' > ')}`)
          }
        }

        // Parse ingredients
        let ingredients: string[] = []
        if (scraped.ingredientsRaw) {
          console.log(`[Rossmann] Raw ingredients for ${sourceUrl}:`, scraped.ingredientsRaw)
          ingredients = await parseIngredients(scraped.ingredientsRaw)
          console.log(`[Rossmann] Parsed ${ingredients.length} ingredients`)
        }

        // Build price history entry with per-unit price calculated from amount
        const now = new Date().toISOString()
        let perUnitAmount: number | null = null
        let perUnitQuantity: number | null = null
        let perUnitUnit: string | null = null
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
        const priceEntry = {
          recordedAt: now,
          amount: scraped.priceCents,
          currency: scraped.currency,
          perUnitAmount,
          perUnitCurrency: perUnitAmount ? scraped.currency : null,
          perUnitQuantity,
          unit: perUnitUnit,
        }

        const existingHistory = existing.docs.length > 0
          ? (existing.docs[0].priceHistory ?? [])
          : []

        const productPayload = {
          ...(gtin ? { gtin } : {}),
          status: 'crawled' as const,
          sourceArticleNumber: scraped.sourceArticleNumber,
          brandName: scraped.brandName,
          name: scraped.name,
          ...(sourceCategoryId ? { sourceCategory: sourceCategoryId } : {}),
          description: scraped.description,
          amount: scraped.amount,
          amountUnit: scraped.amountUnit,
          images: scraped.images,
          variants: scraped.variants,
          priceHistory: [priceEntry, ...existingHistory],
          rating: scraped.rating,
          ratingNum: scraped.ratingNum,
          ingredients: ingredients.map((n: string) => ({ name: n })),
          sourceUrl,
        }

        let productId: number

        if (existing.docs.length > 0) {
          productId = existing.docs[0].id
          await payload.update({
            collection: 'source-products',
            id: productId,
            data: { source: 'rossmann', ...productPayload },
          })
        } else {
          const newProduct = await payload.create({
            collection: 'source-products',
            data: {
              source: 'rossmann',
              ...productPayload,
            },
          })
          productId = newProduct.id
        }

        console.log(`[Rossmann] Crawled product ${sourceUrl}: ${scraped.name} (id: ${productId})`)
        return { productId, warnings }
      } finally {
        await browser.close()
      }
    } catch (error) {
      console.error(`[Rossmann] Error crawling product (url: ${sourceUrl}):`, error)
      return { productId: null, warnings }
    }
  },

  async findUncrawledProducts(
    payload: Payload,
    options: { sourceUrls?: string[]; limit: number },
  ): Promise<Array<{ id: number; sourceUrl: string; gtin?: string }>> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_ROSSMANN_FILTER]
    if (options.sourceUrls && options.sourceUrls.length > 0) {
      where.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
    }

    const result = await payload.find({
      collection: 'source-products',
      where: { and: where },
      limit: options.limit,
    })

    console.log(`[Rossmann] findUncrawledProducts: found ${result.docs.length} (query: sourceUrls=${options.sourceUrls?.join(',') ?? 'all'}, limit=${options.limit})`)

    return result.docs.map((doc) => ({
      id: doc.id,
      sourceUrl: doc.sourceUrl || '',
      gtin: doc.gtin || undefined,
    }))
  },

  async markProductStatus(payload: Payload, productId: number, status: 'crawled' | 'failed'): Promise<void> {
    await payload.update({
      collection: 'source-products',
      id: productId,
      data: { status },
    })
  },

  async countUncrawled(payload: Payload, options?: { sourceUrls?: string[] }): Promise<number> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_ROSSMANN_FILTER]
    if (options?.sourceUrls && options.sourceUrls.length > 0) {
      where.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
    }

    const result = await payload.count({
      collection: 'source-products',
      where: { and: where },
    })

    console.log(`[Rossmann] countUncrawled: ${result.totalDocs}`)
    return result.totalDocs
  },

  async resetProducts(payload: Payload, sourceUrls?: string[], crawledBefore?: Date): Promise<void> {
    if (sourceUrls && sourceUrls.length === 0) return

    const conditions: Where[] = [{ status: { in: 'crawled,failed' } }, SOURCE_ROSSMANN_FILTER]
    if (sourceUrls) {
      conditions.push({ sourceUrl: { in: sourceUrls.join(',') } })
    }
    if (crawledBefore) {
      conditions.push({
        or: [
          { updatedAt: { less_than: crawledBefore.toISOString() } },
        ],
      })
    }

    await payload.update({
      collection: 'source-products',
      where: conditions.length === 1 ? conditions[0] : { and: conditions },
      data: { status: 'uncrawled' },
    })
  },
}
