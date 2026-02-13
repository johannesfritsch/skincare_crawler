import type { Payload, Where } from 'payload'
import type { SourceDriver, DiscoveredProduct } from '../types'
import { launchBrowser } from '@/lib/browser'

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

      function collectProducts(products: Awaited<ReturnType<typeof scrapeProductTiles>>, category: string) {
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
          collectProducts(products, category)
          console.log(`[Mueller] Page 1: found ${products.length} product tiles (${allProducts.length} total unique)`)

          // Paginate through remaining pages
          for (let pageNum = 2; pageNum <= lastPage; pageNum++) {
            const baseUrl = pageUrl.split('?')[0]
            const pagedUrl = `${baseUrl}?page=${pageNum}`
            console.log(`[Mueller] Navigating to page ${pageNum}: ${pagedUrl}`)
            await page.goto(pagedUrl, { waitUntil: 'networkidle' })
            await sleep(randomDelay(500, 1500))

            const pageProducts = await scrapeProductTiles()
            collectProducts(pageProducts, category)
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
    _payload: Payload,
    _options?: { debug?: boolean },
  ): Promise<number | null> {
    console.log(`[Mueller] crawlProduct not implemented yet for ${sourceUrl}`)
    return null
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
