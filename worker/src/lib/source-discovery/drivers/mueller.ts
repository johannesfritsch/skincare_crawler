import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ScrapedProductData } from '../types'
import { launchBrowser } from '@/lib/browser'
import { parseIngredients } from '@/lib/parse-ingredients'

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
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages } = options
    const savedProgress = options.progress as MuellerProductDiscoveryProgress | undefined

    console.log(`[Mueller] Starting browser-based discovery for ${url} (delay=${delay}ms, maxPages=${maxPages ?? 'unlimited'})`)

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
          const productUrl = p.href
            ? (p.href.startsWith('http') ? p.href : `https://www.mueller.de${p.href}`)
            : null
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
          console.log(`[Mueller] Resuming leaf page ${pageNum}: ${pagedUrl}`)

          try {
            await page.goto(pagedUrl, { waitUntil: 'domcontentloaded' })
            await page.waitForSelector('[class*="product-tile"], [class*="category-navigation"]', { timeout: 15000 }).catch(() => {})
            await sleep(jitteredDelay(delay))
            pagesUsed++

            const products = await scrapeProductTiles()
            await emitProducts(products, category, categoryUrl)
            console.log(`[Mueller] Page ${pageNum}: found ${products.length} product tiles`)
          } catch (e) {
            console.warn(`[Mueller] Error on page ${pagedUrl}: ${e}`)
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
          console.log(`[Mueller] Visiting: ${canonicalUrl}`)
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

            console.log(`[Mueller] Leaf page, ${lastPage} page(s) detected`)

            // Scrape page 1 (already loaded)
            const products = await scrapeProductTiles()
            await emitProducts(products, category, canonicalUrl)
            console.log(`[Mueller] Page 1: found ${products.length} product tiles`)

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
              console.log(`[Mueller] Navigating to page ${pageNum}: ${pagedUrl}`)

              try {
                await page.goto(pagedUrl, { waitUntil: 'domcontentloaded' })
                await page.waitForSelector('[class*="product-tile"]', { timeout: 15000 }).catch(() => {})
                await sleep(jitteredDelay(delay))
                pagesUsed++

                const pageProducts = await scrapeProductTiles()
                await emitProducts(pageProducts, category, canonicalUrl)
                console.log(`[Mueller] Page ${pageNum}: found ${pageProducts.length} product tiles`)
              } catch (e) {
                console.warn(`[Mueller] Error on page ${pagedUrl}: ${e}`)
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
              console.log(`[Mueller] No category nav links on ${canonicalUrl}, skipping`)
            } else {
              console.log(`[Mueller] Non-leaf page with ${childHrefs.length} child categories`)
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
          console.warn(`[Mueller] Error visiting ${canonicalUrl}: ${e}`)
          onError?.(canonicalUrl)
          await saveProgress()
        }
      }
    } finally {
      await browser.close()
    }

    const done = queue.length === 0 && !currentLeaf
    console.log(`[Mueller] Tick done: ${pagesUsed} pages used, done=${done}`)
    return { done, pagesUsed }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: { debug?: boolean },
  ): Promise<ScrapedProductData | null> {
    try {
      console.log(`[Mueller] Scraping product: ${sourceUrl}`)

      const debug = options?.debug ?? false
      const browser = await launchBrowser({ headless: !debug })
      try {
        const page = await browser.newPage()
        await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('h1, [class*="product-info"]', { timeout: 15000 }).catch(() => {})
        await sleep(randomDelay(1000, 2000))

        if (debug) {
          console.log(`[Mueller] Debug mode: browser kept open for ${sourceUrl}. Press Ctrl+C to continue.`)
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
          for (const script of ldScripts) {
            try {
              const parsed = JSON.parse(script.textContent || '')
              if (parsed['@type'] === 'BreadcrumbList' && Array.isArray(parsed.itemListElement)) {
                const items = parsed.itemListElement as Array<{ item?: string }>
                const categoryItems = items.slice(1, -1).filter((el: { item?: string }) => el.item)
                if (categoryItems.length > 0) {
                  const deepest = categoryItems[categoryItems.length - 1]
                  categoryUrl = deepest.item ?? null
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
          console.log(`[Mueller] No product name found on page for ${sourceUrl}`)
          return null
        }

        // Parse ingredients
        let ingredientNames: string[] = []
        if (scraped.ingredientsRaw) {
          console.log(`[Mueller] Raw ingredients for ${sourceUrl}:`, scraped.ingredientsRaw)
          ingredientNames = await parseIngredients(scraped.ingredientsRaw)
          console.log(`[Mueller] Parsed ${ingredientNames.length} ingredients`)
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

        return {
          gtin: scraped.gtin ?? undefined,
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
      console.error(`[Mueller] Error scraping product (url: ${sourceUrl}):`, error)
      return null
    }
  },

}
