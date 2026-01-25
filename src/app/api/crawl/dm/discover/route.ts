import { getPayload } from 'payload'
import configPromise from '@payload-config'
import chromium from '@sparticuz/chromium'
import { chromium as pwChromium } from 'playwright-core'

export const runtime = 'nodejs'
export const maxDuration = 300

interface DiscoveredProduct {
  gtin: string
  dan: string | null
  productUrl: string | null
}

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function discoverProducts(url: string): Promise<{
  totalCount: number
  products: DiscoveredProduct[]
}> {
  const isVercel = !!process.env.VERCEL

  let browser
  if (isVercel) {
    const executablePath = await chromium.executablePath()
    browser = await pwChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    })
  } else {
    browser = await pwChromium.launch({
      channel: 'chrome',
      headless: true,
    })
  }

  const page = await browser.newPage()

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' })

    // Accept cookies
    try {
      await page.click('button:has-text("Alles akzeptieren")', { timeout: 5000 })
      await page.waitForTimeout(1000)
    } catch {
      console.log('No cookie banner found or already accepted')
    }

    // Extract total count from [data-dmid="total-count"]
    const totalCount = await page.evaluate(() => {
      const countEl = document.querySelector('[data-dmid="total-count"]')
      if (!countEl) return 0
      const text = countEl.getAttribute('title') || countEl.textContent || ''
      const match = text.match(/(\d+)/)
      return match ? parseInt(match[1], 10) : 0
    })

    console.log(`Total products reported: ${totalCount}`)

    // Click "Mehr laden" button repeatedly until all products are loaded
    let previousCount = 0
    let currentCount = 0
    let noNewProductsCount = 0

    while (noNewProductsCount < 3) {
      // Get current product count
      currentCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-dmid="product-tile"]').length
      })

      console.log(`Current products loaded: ${currentCount}`)

      if (currentCount === previousCount) {
        noNewProductsCount++
      } else {
        noNewProductsCount = 0
      }

      previousCount = currentCount

      // Check if we've loaded all products
      if (currentCount >= totalCount) {
        console.log('All products loaded')
        break
      }

      // Try to click "Mehr laden" button
      try {
        const loadMoreButton = page.locator('[data-dmid="load-more-products-button"]')
        const isVisible = await loadMoreButton.isVisible()

        if (isVisible) {
          await loadMoreButton.click()
          // Random delay between 100-300ms
          await page.waitForTimeout(randomDelay(100, 300))
        } else {
          console.log('Load more button not visible')
          noNewProductsCount++
        }
      } catch (error) {
        console.log('Could not click load more button:', error)
        noNewProductsCount++
      }
    }

    // Extract all product GTINs and URLs
    const products: DiscoveredProduct[] = await page.evaluate(() => {
      const items: Array<{
        gtin: string
        dan: string | null
        productUrl: string | null
      }> = []

      const productTiles = document.querySelectorAll('[data-dmid="product-tile"]')

      productTiles.forEach((tile) => {
        const gtin = tile.getAttribute('data-gtin')
        const dan = tile.getAttribute('data-dan')

        // Get product URL from the link
        const link = tile.querySelector('a[href]')
        const productUrl = link ? link.getAttribute('href') : null

        if (gtin) {
          items.push({
            gtin,
            dan,
            productUrl,
          })
        }
      })

      return items
    })

    return { totalCount, products }
  } finally {
    await browser.close()
  }
}

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const url = body.url || 'https://www.dm.de/make-up'

    // Create a new crawl entry
    const crawl = await payload.create({
      collection: 'dm-crawls',
      data: {
        sourceUrl: url,
        status: 'discovering',
      },
    })

    console.log(`Created crawl ${crawl.id}, starting discovery of ${url}...`)

    try {
      const { totalCount, products } = await discoverProducts(url)
      console.log(`Discovered ${products.length} products (total reported: ${totalCount})`)

      // Update the crawl with discovered items (only store GTINs for performance)
      const updatedCrawl = await payload.update({
        collection: 'dm-crawls',
        id: crawl.id,
        data: {
          status: 'discovered',
          totalCount,
          itemsDiscovered: products.length,
          itemsCrawled: 0,
          items: products.map((p) => ({
            gtin: p.gtin,
            status: 'pending',
          })),
          discoveredAt: new Date().toISOString(),
        },
      })

      return Response.json({
        success: true,
        crawlId: crawl.id,
        totalCount,
        itemsDiscovered: products.length,
        status: 'discovered',
        message: `Discovered ${products.length} products. Use /api/crawl/dm/crawl with crawlId=${crawl.id} to start crawling.`,
      })
    } catch (error) {
      // Update crawl as failed
      await payload.update({
        collection: 'dm-crawls',
        id: crawl.id,
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      })
      throw error
    }
  } catch (error) {
    console.error('Discovery error:', error)
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}

export const GET = async () => {
  return Response.json({
    message: 'DM Discovery API',
    usage: 'POST /api/crawl/dm/discover with optional { "url": "https://www.dm.de/..." }',
    defaultUrl: 'https://www.dm.de/make-up',
    description:
      'Discovers all products on a dm.de category page and creates a crawl session. Returns a crawlId to use with /api/crawl/dm/crawl.',
  })
}
