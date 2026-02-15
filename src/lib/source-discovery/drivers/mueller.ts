import type { Payload, Where } from 'payload'
import type { SourceDriver, DiscoveredProduct } from '../types'
import { launchBrowser } from '@/lib/browser'
import { parseIngredients } from '@/lib/parse-ingredients'

const SOURCE_MUELLER_FILTER: Where = {
  source: { equals: 'mueller' },
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
    url: string,
  ): Promise<{ totalCount: number; products: DiscoveredProduct[] }> {
    console.log(`[Mueller] Starting browser-based discovery for ${url}`)

    const browser = await launchBrowser()
    const allProducts: DiscoveredProduct[] = []
    const seenUrls = new Set<string>()

    try {
      const page = await browser.newPage()

      function scrapeProductTiles() {
        return page.$$eval(
          '[class*="product-tile"]',
          (tiles) =>
            tiles
              .filter((el) => el.tagName === 'ARTICLE' || el.querySelector('a[data-track-id="product"]'))
              .map((tile) => {
                // Product URL
                const link = tile.querySelector('a[data-track-id="product"]') as HTMLAnchorElement | null
                const href = link?.getAttribute('href') || ''

                // Product name
                const nameEl = tile.querySelector('[class*="product-tile__product-name"]')
                const name = nameEl?.textContent?.trim() || ''

                // Price: "0,99 €" → cents
                const priceEl = tile.querySelector('[class*="product-price__main-price-accent"]')
                const priceText = priceEl?.textContent?.trim() || ''
                const priceMatch = priceText.match(/([\d]+[,.][\d]+)\s*€/)
                let priceCents: number | null = null
                if (priceMatch) {
                  priceCents = Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
                }

                // Capacity: e.g. "/225 ml"
                const capacityEl = tile.querySelector('[class*="product-price__capacity"]')
                const capacity = capacityEl?.textContent?.trim() || ''

                // Rating: count filled star icons (non-empty, i.e. not star-rating-empty.svg)
                const starImages = tile.querySelectorAll('[class*="star-rating"] img, [class*="star-rating"] svg')
                let rating: number | null = null
                if (starImages.length > 0) {
                  let filled = 0
                  starImages.forEach((img) => {
                    const src = img.getAttribute('src') || img.getAttribute('href') || ''
                    const cls = img.getAttribute('class') || ''
                    // Count as filled if NOT empty
                    if (!src.includes('star-rating-empty') && !cls.includes('empty')) {
                      filled++
                    }
                  })
                  rating = filled
                }

                return { href, name, priceCents, capacity, rating }
              }),
        )
      }

      function collectProducts(products: Awaited<ReturnType<typeof scrapeProductTiles>>, category: string, categoryUrl: string) {
        for (const p of products) {
          const productUrl = p.href
            ? (p.href.startsWith('http') ? p.href : `https://www.mueller.de${p.href}`)
            : null
          if (!productUrl || seenUrls.has(productUrl)) continue
          seenUrls.add(productUrl)
          allProducts.push({
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

      async function scrapeCategoryPage(pageUrl: string): Promise<void> {
        console.log(`[Mueller] Visiting: ${pageUrl}`)
        await page.goto(pageUrl, { waitUntil: 'networkidle' })
        await sleep(randomDelay(500, 1500))

        // Leaf detection: check for an element with class containing "category-navigation__option--selected"
        const isLeaf = await page.$('[class*="category-navigation__option--selected"]') !== null

        if (isLeaf) {
          // Leaf page — scrape products and paginate
          const category = buildCategoryFromUrl(pageUrl)

          // Determine last page from paginator
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
          collectProducts(products, category, pageUrl)
          console.log(`[Mueller] Page 1: found ${products.length} product tiles (${allProducts.length} total unique)`)

          // Paginate through remaining pages
          for (let pageNum = 2; pageNum <= lastPage; pageNum++) {
            const baseUrl = pageUrl.split('?')[0]
            const pagedUrl = `${baseUrl}?page=${pageNum}`
            console.log(`[Mueller] Navigating to page ${pageNum}: ${pagedUrl}`)
            await page.goto(pagedUrl, { waitUntil: 'networkidle' })
            await sleep(randomDelay(500, 1500))

            const pageProducts = await scrapeProductTiles()
            collectProducts(pageProducts, category, pageUrl)
            console.log(`[Mueller] Page ${pageNum}: found ${pageProducts.length} product tiles (${allProducts.length} total unique)`)
          }
        } else {
          // Non-leaf page — extract child category links and recurse
          const childHrefs = await page.$$eval(
            '[class*="category-navigation__list"] a[href]',
            (links) => links.map((a) => a.getAttribute('href') || '').filter(Boolean),
          )

          if (childHrefs.length === 0) {
            console.log(`[Mueller] No category nav links on ${pageUrl}, skipping`)
            return
          }

          console.log(`[Mueller] Non-leaf page with ${childHrefs.length} child categories, recursing...`)
          for (const href of childHrefs) {
            const childUrl = href.startsWith('http')
              ? href
              : `https://www.mueller.de${href}`
            await scrapeCategoryPage(childUrl)
          }
        }
      }

      await scrapeCategoryPage(url)
    } finally {
      await browser.close()
    }

    console.log(`[Mueller] Discovery complete: ${allProducts.length} unique products`)
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
        where: { and: [{ sourceUrl: { equals: sourceUrl } }, SOURCE_MUELLER_FILTER] },
        limit: 1,
      })

      console.log(`[Mueller] Crawling product: ${sourceUrl}`)

      const debug = options?.debug ?? false
      const browser = await launchBrowser({ headless: !debug })
      try {
        const page = await browser.newPage()
        await page.goto(sourceUrl, { waitUntil: 'networkidle' })
        await sleep(randomDelay(1000, 2000))

        if (debug) {
          console.log(`[Mueller] Debug mode: browser kept open for ${sourceUrl}. Press Ctrl+C to continue.`)
          await page.pause()
        }

        // Scrape all fields in one page.evaluate call
        const scraped = await page.evaluate(() => {
          // --- JSON-LD structured data (most reliable source for GTIN, brand, price) ---
          let jsonLd: Record<string, unknown> | null = null
          const ldScripts = document.querySelectorAll('script[type="application/ld+json"]')
          for (const script of ldScripts) {
            try {
              const parsed = JSON.parse(script.textContent || '')
              if (parsed['@type'] === 'Product') {
                jsonLd = parsed
                break
              }
            } catch { /* ignore non-Product LD+JSON */ }
          }

          // Name
          const h1 = document.querySelector('h1')
          const name = h1?.textContent?.trim() || (jsonLd?.name as string) || null

          // Brand — from brand link img alt, strip "Markenbild von " prefix
          let brandName: string | null = null
          const brandImg = document.querySelector('a[class*="product-info"][class*="brand"] img')
          if (brandImg) {
            const alt = brandImg.getAttribute('alt') || ''
            brandName = alt.replace(/^Markenbild von\s*/i, '').trim() || null
          }
          // Fallback to JSON-LD brand
          if (!brandName && jsonLd) {
            const brand = jsonLd.brand as Record<string, unknown> | undefined
            brandName = (brand?.name as string) || null
          }

          // Article number from data-product-id or article-nr element
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
          // Fallback to JSON-LD sku
          if (!sourceArticleNumber && jsonLd) {
            sourceArticleNumber = (jsonLd.sku as string) || null
          }

          // GTIN — from JSON-LD first, then from image URLs
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

          // Category URL from last breadcrumb link
          const breadcrumbLinks = document.querySelectorAll('[class*="breadcrumps_component_breadcrumbs__item"] a')
          let categoryUrl: string | null = null
          if (breadcrumbLinks.length > 0) {
            const lastLink = breadcrumbLinks[breadcrumbLinks.length - 1] as HTMLAnchorElement
            const href = lastLink.getAttribute('href')
            if (href) {
              categoryUrl = href.startsWith('http') ? href : `https://www.mueller.de${href}`
            }
          }

          // Price — from JSON-LD offers first, then from priceContainer
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

          // Per-unit price from base-price span, e.g. "0,15 € / 1 ml"
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

          // Mutable state set inside forEach callbacks (avoids TS narrowing issues with let + closures)
          const mutable = {
            amount: null as number | null,
            amountUnit: null as string | null,
            ingredientsRaw: null as string | null,
          }

          // Rating — count filled star icons
          let rating: number | null = null
          let ratingNum: number | null = null
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

          // Images from carousel
          const images: Array<{ url: string; alt: string | null }> = []
          // Best source: JSON-LD image array (clean static URLs)
          if (jsonLd?.image) {
            const ldImages = jsonLd.image as string[]
            if (Array.isArray(ldImages)) {
              ldImages.forEach((url) => {
                images.push({ url, alt: null })
              })
            }
          }
          // Fallback: scrape from carousel
          if (images.length === 0) {
            const carouselImgs = document.querySelectorAll('[class*="carousel_component_carousel__item"] img[class*="image-section"]')
            const seenUrls = new Set<string>()
            carouselImgs.forEach((img) => {
              let src = img.getAttribute('src') || ''
              // Decode CDN wrapper URL: /_next/image/?url=...&w=...&q=...
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

          // Description — from accordion sections
          const descriptionSections: string[] = []

          const accordionEntries = document.querySelectorAll('section[class*="accordion_component_accordion-entry"]')
          accordionEntries.forEach((section) => {
            const headingEl = section.querySelector('span[role="heading"]') as HTMLElement | null
            const headingText = headingEl?.innerText?.trim() || headingEl?.textContent?.trim()
            if (!headingText) return

            const contentEl = section.querySelector('[class*="accordion-entry__contents"]') as HTMLElement | null
            if (!contentEl) return

            // Check for specifications table
            const specsTable = contentEl.querySelector('table[class*="specifications-table"]')
            if (specsTable) {
              const rows = specsTable.querySelectorAll('tr')
              const rowParts: string[] = []
              rows.forEach((tr) => {
                const cells = tr.querySelectorAll('td, th')
                if (cells.length >= 2) {
                  const label = (cells[0] as HTMLElement).innerText?.trim() || (cells[0] as HTMLElement).textContent?.trim() || ''
                  const value = (cells[1] as HTMLElement).innerText?.trim() || (cells[1] as HTMLElement).textContent?.trim() || ''

                  // Extract amount from "Inhalt" row
                  if (label === 'Inhalt' && !mutable.amount) {
                    const amountMatch = value.match(/([\d]+(?:[,.]\d+)?)\s*(\w+)/)
                    if (amountMatch) {
                      mutable.amount = parseFloat(amountMatch[1].replace(',', '.'))
                      mutable.amountUnit = amountMatch[2]
                    }
                  }

                  // Extract raw ingredients
                  if (label === 'Inhaltsstoffe') {
                    mutable.ingredientsRaw = value
                  }

                  rowParts.push(`### ${label}\n${value}`)
                }
              })
              descriptionSections.push(`## ${headingText}\n\n${rowParts.join('\n\n')}`)
            } else {
              // Plain text content
              const bodyText = contentEl.innerText?.trim() || contentEl.textContent?.trim() || ''
              if (bodyText) {
                descriptionSections.push(`## ${headingText}\n\n${bodyText}`)
              }
            }
          })

          const description = descriptionSections.length > 0
            ? descriptionSections.join('\n\n')
            : null

          // Variants — from product-attribute-list
          const variants: Array<{
            dimension: string
            options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }>
          }> = []
          const attrWrappers = document.querySelectorAll('[class*="product-attribute-list__attribute-wrapper"]')
          attrWrappers.forEach((wrapper) => {
            // Dimension label from "Farbe: BUBBLE RUSH - 21" text
            const dimEl = wrapper.querySelector('div.text-lg') as HTMLElement | null
            if (!dimEl) return
            const dimText = dimEl.textContent?.trim() || ''
            const colonIdx = dimText.indexOf(':')
            // Skip non-variant attribute wrappers (e.g. "Inhalt: 8 ml / 8 ml")
            const dimension = colonIdx > 0 ? dimText.substring(0, colonIdx).trim() : dimText
            if (!dimension) return

            // Check if there's a tile list (variant tiles) vs just a text value
            const tileList = wrapper.querySelector('[class*="product-attribute-tile-list"]')
            if (!tileList) return

            const options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }> = []
            const tiles = tileList.querySelectorAll(':scope > div')
            tiles.forEach((tile) => {
              // Label from img alt inside the tooltip trigger
              const img = tile.querySelector('img[alt]')
              const label = img?.getAttribute('alt') || ''
              if (!label) return

              // GTIN from image URL: _default_upload_bucket/(\d{8,14})_
              let tileGtin: string | null = null
              const imgSrc = img?.getAttribute('src') || img?.getAttribute('srcset') || ''
              const decoded = decodeURIComponent(imgSrc)
              const gtinMatch = decoded.match(/_default_upload_bucket\/(\d{8,14})_/)
              if (gtinMatch) tileGtin = gtinMatch[1]

              // Selected state: content span has --selected class
              const contentEl = tile.querySelector('[class*="product-attribute-tile__content"]')
              const isSelected = contentEl?.className?.includes('--selected') ?? false

              // Value: itemId from href if available
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

          // Current page URL (in case of redirect)
          const currentUrl = window.location.href

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
            currentUrl,
          }
        })

        if (!scraped.name) {
          console.log(`[Mueller] No product name found on page for ${sourceUrl}`)
          return null
        }

        // Look up SourceCategory by URL
        let sourceCategoryId: number | null = null
        if (scraped.categoryUrl) {
          const catMatch = await payload.find({
            collection: 'source-categories',
            where: { and: [{ url: { equals: scraped.categoryUrl } }, { source: { equals: 'mueller' } }] },
            limit: 1,
          })
          if (catMatch.docs.length > 0) sourceCategoryId = catMatch.docs[0].id
        }

        // Parse ingredients
        let ingredients: string[] = []
        if (scraped.ingredientsRaw) {
          console.log(`[Mueller] Raw ingredients for ${sourceUrl}:`, scraped.ingredientsRaw)
          ingredients = await parseIngredients(scraped.ingredientsRaw)
          console.log(`[Mueller] Parsed ${ingredients.length} ingredients`)
        }

        // Build price history entry
        const now = new Date().toISOString()
        // If per-unit price wasn't found in the DOM, calculate from amount
        let perUnitAmount = scraped.perUnitAmount
        let perUnitQuantity = scraped.perUnitQuantity
        let perUnitUnit = scraped.perUnitUnit
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
        const priceEntry = {
          recordedAt: now,
          amount: scraped.priceCents,
          currency: scraped.currency,
          perUnitAmount: perUnitAmount ?? null,
          perUnitCurrency: perUnitAmount ? scraped.currency : null,
          perUnitQuantity: perUnitQuantity ?? null,
          unit: perUnitUnit ?? null,
        }

        // Collect variant records with GTINs
        const variantRecords: Array<{ gtin: string; label: string; variantSourceUrl: string; isPageSelected: boolean }> = []
        const baseUrl = sourceUrl.split('?')[0].split('#')[0]

        for (const dim of scraped.variants) {
          for (const opt of dim.options) {
            if (!opt.gtin) continue
            let variantSourceUrl: string
            if (opt.isSelected) {
              variantSourceUrl = sourceUrl
            } else if (opt.value) {
              variantSourceUrl = `${baseUrl}?itemId=${opt.value}`
            } else {
              variantSourceUrl = `${baseUrl}#gtin=${opt.gtin}`
            }
            variantRecords.push({ gtin: opt.gtin, label: opt.label, variantSourceUrl, isPageSelected: opt.isSelected })
          }
        }

        let primaryProductId: number | null = null

        if (variantRecords.length > 0) {
          // Upsert one source-product per variant
          for (const variant of variantRecords) {
            // Build adjusted variants array with only this variant marked as selected
            const adjustedVariants = scraped.variants.map((dim) => ({
              dimension: dim.dimension,
              options: dim.options.map((opt) => ({
                ...opt,
                isSelected: opt.gtin === variant.gtin,
              })),
            }))

            // Look up existing source-product by this variant's URL
            const existingVariant = await payload.find({
              collection: 'source-products',
              where: { and: [{ sourceUrl: { equals: variant.variantSourceUrl } }, SOURCE_MUELLER_FILTER] },
              limit: 1,
            })

            const existingHistory = existingVariant.docs.length > 0
              ? (existingVariant.docs[0].priceHistory ?? [])
              : []

            const variantName = variant.label
              ? `${scraped.name} (${variant.label})`
              : scraped.name

            const productPayload = {
              gtin: variant.gtin,
              status: 'crawled' as const,
              sourceArticleNumber: scraped.sourceArticleNumber,
              brandName: scraped.brandName,
              name: variantName,
              sourceCategory: sourceCategoryId,
              description: scraped.description,
              amount: scraped.amount,
              amountUnit: scraped.amountUnit,
              images: scraped.images,
              variants: adjustedVariants,
              priceHistory: [priceEntry, ...existingHistory],
              rating: scraped.rating,
              ratingNum: scraped.ratingNum,
              ingredients: ingredients.map((n: string) => ({ name: n })),
              sourceUrl: variant.variantSourceUrl,
              crawledAt: now,
            }

            let productId: number

            if (existingVariant.docs.length > 0) {
              productId = existingVariant.docs[0].id
              await payload.update({
                collection: 'source-products',
                id: productId,
                data: { source: 'mueller', ...productPayload },
              })
            } else {
              const newProduct = await payload.create({
                collection: 'source-products',
                data: {
                  source: 'mueller',
                  ...productPayload,
                },
              })
              productId = newProduct.id
            }

            console.log(`[Mueller] Crawled variant ${variant.gtin} (url: ${variant.variantSourceUrl}, id: ${productId})`)

            // Track the primary product (the one matching the original sourceUrl)
            if (variant.variantSourceUrl === sourceUrl) {
              primaryProductId = productId
            }
          }

          // If no variant matched the original sourceUrl (shouldn't happen, but be safe),
          // use the first variant's product
          if (primaryProductId === null) {
            primaryProductId = (await payload.find({
              collection: 'source-products',
              where: { and: [{ sourceUrl: { equals: variantRecords[0].variantSourceUrl } }, SOURCE_MUELLER_FILTER] },
              limit: 1,
            })).docs[0]?.id ?? null
          }

          console.log(`[Mueller] Crawled product ${sourceUrl}: ${scraped.name} — ${variantRecords.length} variant(s)`)
        } else {
          // No-variant fallback: single product behavior
          const existingHistory = existing.docs.length > 0
            ? (existing.docs[0].priceHistory ?? [])
            : []

          const productPayload = {
            ...(scraped.gtin ? { gtin: scraped.gtin } : {}),
            status: 'crawled' as const,
            sourceArticleNumber: scraped.sourceArticleNumber,
            brandName: scraped.brandName,
            name: scraped.name,
            sourceCategory: sourceCategoryId,
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

          if (existing.docs.length > 0) {
            primaryProductId = existing.docs[0].id
            await payload.update({
              collection: 'source-products',
              id: primaryProductId,
              data: { source: 'mueller', ...productPayload },
            })
          } else {
            const newProduct = await payload.create({
              collection: 'source-products',
              data: {
                source: 'mueller',
                ...productPayload,
              },
            })
            primaryProductId = newProduct.id
          }

          console.log(`[Mueller] Crawled product ${sourceUrl}: ${scraped.name} (id: ${primaryProductId})`)
        }

        return primaryProductId
      } finally {
        await browser.close()
      }
    } catch (error) {
      console.error(`[Mueller] Error crawling product (url: ${sourceUrl}):`, error)
      return null
    }
  },

  async findUncrawledProducts(
    payload: Payload,
    options: { sourceUrls?: string[]; limit: number },
  ): Promise<Array<{ id: number; sourceUrl: string; gtin?: string }>> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_MUELLER_FILTER]
    if (options.sourceUrls && options.sourceUrls.length > 0) {
      where.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
    }

    const result = await payload.find({
      collection: 'source-products',
      where: { and: where },
      limit: options.limit,
    })

    console.log(`[Mueller] findUncrawledProducts: found ${result.docs.length} (query: sourceUrls=${options.sourceUrls?.join(',') ?? 'all'}, limit=${options.limit})`)

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
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_MUELLER_FILTER]
    if (options?.sourceUrls && options.sourceUrls.length > 0) {
      where.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
    }

    const result = await payload.count({
      collection: 'source-products',
      where: { and: where },
    })

    console.log(`[Mueller] countUncrawled: ${result.totalDocs}`)
    return result.totalDocs
  },

  async resetProducts(payload: Payload, sourceUrls?: string[], crawledBefore?: Date): Promise<void> {
    if (sourceUrls && sourceUrls.length === 0) return

    const conditions: Where[] = [{ status: { in: 'crawled,failed' } }, SOURCE_MUELLER_FILTER]
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
