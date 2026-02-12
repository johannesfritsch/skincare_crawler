import type { Payload, Where } from 'payload'
import type { SourceDriver, DiscoveredProduct } from '../types'
import { launchBrowser } from '@/lib/browser'

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
    const seenGtins = new Set<string>()

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
          if (!p.gtin || seenGtins.has(p.gtin)) continue
          seenGtins.add(p.gtin)
          allProducts.push({
            gtin: p.gtin,
            productUrl: p.href ? `https://www.rossmann.de${p.href}` : null,
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
    _gtin: string,
    _payload: Payload,
  ): Promise<number | null> {
    // Stub — not implemented yet
    console.log(`[Rossmann] crawlProduct not implemented`)
    return null
  },

  async findUncrawledProducts(
    payload: Payload,
    options: { gtins?: string[]; limit: number },
  ): Promise<Array<{ id: number; gtin: string; sourceUrl: string | null }>> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_ROSSMANN_FILTER]
    if (options.gtins && options.gtins.length > 0) {
      where.push({ gtin: { in: options.gtins.join(',') } })
    }

    const result = await payload.find({
      collection: 'source-products',
      where: { and: where },
      limit: options.limit,
    })

    console.log(`[Rossmann] findUncrawledProducts: found ${result.docs.length} (query: gtins=${options.gtins?.join(',') ?? 'all'}, limit=${options.limit})`)

    return result.docs.map((doc) => ({
      id: doc.id,
      gtin: doc.gtin!,
      sourceUrl: doc.sourceUrl || null,
    }))
  },

  async markProductStatus(payload: Payload, productId: number, status: 'crawled' | 'failed'): Promise<void> {
    await payload.update({
      collection: 'source-products',
      id: productId,
      data: { status },
    })
  },

  async countUncrawled(payload: Payload, options?: { gtins?: string[] }): Promise<number> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_ROSSMANN_FILTER]
    if (options?.gtins && options.gtins.length > 0) {
      where.push({ gtin: { in: options.gtins.join(',') } })
    }

    const result = await payload.count({
      collection: 'source-products',
      where: { and: where },
    })

    console.log(`[Rossmann] countUncrawled: ${result.totalDocs}`)
    return result.totalDocs
  },

  async resetProducts(payload: Payload, gtins?: string[], crawledBefore?: Date): Promise<void> {
    if (gtins && gtins.length === 0) return

    const conditions: Where[] = [{ status: { in: 'crawled,failed' } }, SOURCE_ROSSMANN_FILTER]
    if (gtins) {
      conditions.push({ gtin: { in: gtins.join(',') } })
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
