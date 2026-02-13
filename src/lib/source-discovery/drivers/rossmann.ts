import type { Payload, Where } from 'payload'
import type { SourceDriver, DiscoveredProduct } from '../types'
import { launchBrowser } from '@/lib/browser'
import { parseIngredients } from '@/lib/parse-ingredients'

const SOURCE_ROSSMANN_FILTER: Where = {
  source: { equals: 'rossmann' },
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    url: string,
  ): Promise<{ totalCount: number; products: DiscoveredProduct[] }> {
    console.log(`[Rossmann] Starting browser-based discovery for ${url}`)

    const browser = await launchBrowser()
    const allProducts: DiscoveredProduct[] = []
    const seenUrls = new Set<string>()

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

              // Product URL
              const imageLink = card.querySelector('figure[data-testid="product-image"] a[href]')
              const href = imageLink?.getAttribute('href') || ''

              // Price from sr-only text
              const priceEl = card.querySelector('[data-testid="product-price"] .sr-only')
              const priceText = priceEl?.textContent || ''
              const priceMatch = priceText.match(/([\d]+[,.][\d]+)\s*€/)
              let priceCents: number | null = null
              if (priceMatch) {
                priceCents = Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
              }

              // Rating: count filled star SVGs
              const ratingsContainer = card.querySelector('[data-testid="product-ratings"]')
              let rating: number | null = null
              let ratingCount: number | null = null
              if (ratingsContainer) {
                const filledStars = ratingsContainer.querySelectorAll('svg.text-red')
                rating = filledStars.length

                // Check for partial star (clip-path based width)
                const partialContainer = ratingsContainer.querySelector('[style*="width"]')
                if (partialContainer) {
                  const style = partialContainer.getAttribute('style') || ''
                  const widthMatch = style.match(/width:\s*([\d.]+)%/)
                  if (widthMatch) {
                    rating = (rating > 0 ? rating - 1 : 0) + parseFloat(widthMatch[1]) / 100
                  }
                }

                // Review count from trailing span
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

      function collectProducts(products: Awaited<ReturnType<typeof scrapeProductCards>>, category: string) {
        for (const p of products) {
          const productUrl = p.href ? `https://www.rossmann.de${p.href}` : null
          if (!productUrl || seenUrls.has(productUrl)) continue
          seenUrls.add(productUrl)
          allProducts.push({
            gtin: p.gtin || undefined,
            productUrl,
            brandName: p.brand || undefined,
            name: p.name || undefined,
            price: p.priceCents ?? undefined,
            currency: 'EUR',
            rating: p.rating ?? undefined,
            ratingCount: p.ratingCount ?? undefined,
            category,
          })
        }
      }

      // Determine if a page is a leaf by checking the category nav:
      // - Leaf page: nav shows siblings, current page is bold (font-bold class)
      // - Parent page: nav shows children, none are bold
      // Only scrape products from leaf pages.
      async function scrapeCategoryPage(pageUrl: string): Promise<void> {
        console.log(`[Rossmann] Visiting: ${pageUrl}`)
        await page.goto(pageUrl, { waitUntil: 'networkidle' })
        await sleep(randomDelay(500, 1500))

        // Check if any nav link is bold (= current page among siblings = leaf)
        const navInfo = await page.$$eval(
          'nav[data-testid="category-nav-desktop"] ul li a',
          (links) => links.map((a) => ({
            href: a.getAttribute('href') || '',
            isBold: a.classList.contains('font-bold'),
          })),
        )

        const isLeaf = navInfo.some((link) => link.isBold)

        if (isLeaf) {
          // Leaf page — scrape products and paginate
          const category = buildCategoryFromUrl(pageUrl)
          const products = await scrapeProductCards()
          collectProducts(products, category)
          console.log(`[Rossmann] Leaf page 0: found ${products.length} product cards (${allProducts.length} total unique)`)

          let pageIndex = 0
          while (true) {
            // The "Nächste Seite" link is always in the DOM, but its parent <li>
            // gets `text-grey-light pointer-events-none` when on the last page.
            const isNextDisabled = await page.$eval(
              'a[aria-label="Nächste Seite"]',
              (a) => a.closest('li')?.classList.contains('pointer-events-none') ?? true,
            ).catch(() => true)
            if (isNextDisabled) break

            pageIndex++
            const baseUrl = pageUrl.split('?')[0]
            const nextUrl = `${baseUrl}?pageIndex=${pageIndex}`
            console.log(`[Rossmann] Navigating to next page: ${nextUrl}`)
            await page.goto(nextUrl, { waitUntil: 'networkidle' })
            await sleep(randomDelay(500, 1500))

            const pageProducts = await scrapeProductCards()
            collectProducts(pageProducts, category)
            console.log(`[Rossmann] Leaf page ${pageIndex}: found ${pageProducts.length} product cards (${allProducts.length} total unique)`)
          }
        } else {
          // Parent page — nav shows children, recurse into each
          const childHrefs = navInfo.map((link) => link.href).filter(Boolean)

          if (childHrefs.length === 0) {
            console.log(`[Rossmann] No nav links on ${pageUrl}, skipping`)
            return
          }

          console.log(`[Rossmann] Parent page with ${childHrefs.length} child categories, recursing...`)
          for (const href of childHrefs) {
            const childUrl = href.startsWith('http')
              ? href
              : `https://www.rossmann.de${href}`
            await scrapeCategoryPage(childUrl)
          }
        }
      }

      await scrapeCategoryPage(url)
    } finally {
      await browser.close()
    }

    console.log(`[Rossmann] Discovery complete: ${allProducts.length} unique products`)
    return { totalCount: allProducts.length, products: allProducts }
  },

  async crawlProduct(
    sourceUrl: string,
    payload: Payload,
    options?: { debug?: boolean },
  ): Promise<number | null> {
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
        await page.goto(sourceUrl, { waitUntil: 'networkidle' })
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

          // Type from category breadcrumbs
          const cartBtn = document.querySelector('button[data-jsevent="ctrl:add-to-cart"]')
          const rawCategory = cartBtn?.getAttribute('data-product-category') || null
          const type = rawCategory
            ? rawCategory.split('/').map((s: string) => s.trim()).join(' -> ')
            : null

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

          // Current page URL (in case of redirect)
          const currentUrl = window.location.href

          return {
            name,
            brandName,
            sourceArticleNumber,
            gtinFromPage,
            type,
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
            currentUrl,
          }
        })

        console.log(`[Rossmann] Variant debug for ${sourceUrl}:`, JSON.stringify(scraped._variantDebug, null, 2))

        if (!scraped.name) {
          console.log(`[Rossmann] No product name found on page for ${sourceUrl}`)
          return null
        }

        // Extract GTIN from page or URL
        const gtin = scraped.gtinFromPage || sourceUrl.match(/\/p\/(\d+)/)?.[1] || null

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
          type: scraped.type ?? undefined,
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
          crawledAt: now,
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
        return productId
      } finally {
        await browser.close()
      }
    } catch (error) {
      console.error(`[Rossmann] Error crawling product (url: ${sourceUrl}):`, error)
      return null
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
          { crawledAt: { less_than: crawledBefore.toISOString() } },
          { crawledAt: { exists: false } },
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
