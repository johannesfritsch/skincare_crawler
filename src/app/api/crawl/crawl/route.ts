import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { launchBrowser } from '@/lib/browser'
import { getDriverById, getDriverByUrl, getAllDrivers } from '@/lib/crawl-drivers'
import type { CrawlDriver } from '@/lib/crawl-drivers'

export const runtime = 'nodejs'
export const maxDuration = 300

interface CrawlItem {
  gtin?: string | null
  productUrl?: string | null
}

async function crawlItems(
  payload: Awaited<ReturnType<typeof getPayload>>,
  driver: CrawlDriver,
  items: CrawlItem[],
) {
  const browser = await launchBrowser()
  const page = await browser.newPage()

  try {
    // Navigate to site and accept cookies
    await page.goto(`https://${driver.hostnames[0]}`, { waitUntil: 'domcontentloaded' })
    await driver.acceptCookies(page)

    const results: { identifier: string; success: boolean; productId?: number; error?: string }[] =
      []

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      const identifier = item.productUrl || item.gtin || 'unknown'
      console.log(`Crawling product ${identifier}...`)

      const productData = await driver.scrapeProduct(
        page,
        item.gtin || null,
        item.productUrl || null,
      )

      if (productData && productData.name) {
        const productId = await driver.saveProduct(payload, productData)
        results.push({ identifier, success: true, productId })
      } else {
        results.push({ identifier, success: false, error: 'Failed to scrape product data' })
      }

      // Delay between requests
      if (i < items.length - 1) {
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 1000)
      }
    }

    return Response.json({
      success: true,
      driver: driver.id,
      processed: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    })
  } finally {
    await browser.close()
  }
}

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const crawlId = body.crawlId as number | undefined
    const itemId = body.itemId as number | undefined
    const gtins = body.gtins as string[] | undefined
    const productUrls = body.productUrls as string[] | undefined
    const driverId = body.driver as string | undefined
    const url = body.url as string | undefined
    const limit = (body.limit as number) || 10

    // Mode 1: Direct crawl by productUrls or GTINs (needs driver or url to determine driver)
    const hasDirectItems =
      (productUrls && Array.isArray(productUrls) && productUrls.length > 0) ||
      (gtins && Array.isArray(gtins) && gtins.length > 0)

    if (hasDirectItems) {
      let driver: CrawlDriver | null = null

      if (driverId) {
        driver = getDriverById(driverId)
      } else if (url) {
        driver = getDriverByUrl(url)
      } else if (productUrls && productUrls.length > 0) {
        // Try to determine driver from first productUrl
        driver = getDriverByUrl(productUrls[0])
      }

      if (!driver) {
        return Response.json(
          {
            success: false,
            error:
              'For direct crawl, provide "driver" (e.g., "dm") or "url" to determine the driver.',
            availableDrivers: getAllDrivers().map((d) => ({ id: d.id, name: d.name })),
          },
          { status: 400 },
        )
      }

      // Build items list from productUrls and/or gtins
      const items: CrawlItem[] = []

      if (productUrls) {
        for (const productUrl of productUrls) {
          items.push({ productUrl })
        }
      }

      if (gtins) {
        for (const gtin of gtins) {
          // Only add if not already covered by a productUrl
          if (!items.some((item) => item.gtin === gtin)) {
            items.push({ gtin })
          }
        }
      }

      return await crawlItems(payload, driver, items)
    }

    // Mode 2: Crawl from a crawl session
    if (!crawlId) {
      return Response.json(
        {
          success: false,
          error: 'Either gtins array (with driver/url) or crawlId is required.',
        },
        { status: 400 },
      )
    }

    // Find the crawl session and determine the driver
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let crawl: any = null
    let driver: CrawlDriver | null = null

    for (const d of getAllDrivers()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const found = await (payload.findByID as any)({
          collection: d.collections.crawls,
          id: crawlId,
        })
        if (found) {
          crawl = found
          driver = d
          break
        }
      } catch {
        // Not found in this collection, try next
      }
    }

    if (!crawl || !driver) {
      return Response.json(
        { success: false, error: `Crawl session ${crawlId} not found` },
        { status: 404 },
      )
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let itemsToProcess: any[]

    if (itemId) {
      // Crawl a specific item by ID
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = await (payload.findByID as any)({
        collection: driver.collections.crawlItems,
        id: itemId,
      })

      if (!item) {
        return Response.json({ success: false, error: `Item ${itemId} not found` }, { status: 404 })
      }

      itemsToProcess = [item]
    } else {
      // Get pending items from the crawl items collection
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pendingItemsResult = await (payload.find as any)({
        collection: driver.collections.crawlItems,
        where: {
          crawl: { equals: crawlId },
          status: { equals: 'pending' },
        },
        limit,
      })

      itemsToProcess = pendingItemsResult.docs

      if (itemsToProcess.length === 0) {
        // Mark as completed if no more pending items
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (payload.update as any)({
          collection: driver.collections.crawls,
          id: crawlId,
          data: {
            status: 'completed',
            completedAt: new Date().toISOString(),
          },
        })

        return Response.json({
          success: true,
          message: 'All items have been crawled',
          itemsCrawled: crawl.itemsCrawled || 0,
          status: 'completed',
        })
      }
    }

    // Update status to crawling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.update as any)({
      collection: driver.collections.crawls,
      id: crawlId,
      data: { status: 'crawling' },
    })

    // Launch browser
    const browser = await launchBrowser()
    const page = await browser.newPage()

    // Accept cookies once
    await page.goto(`https://${driver.hostnames[0]}`, { waitUntil: 'domcontentloaded' })
    await driver.acceptCookies(page)

    const results: { gtin: string; success: boolean; productId?: number; error?: string }[] = []
    let crawledCount = 0

    try {
      for (const item of itemsToProcess) {
        const gtin = item.gtin
        const productUrl = item.productUrl || null

        console.log(`Crawling product ${gtin}...`)

        const productData = await driver.scrapeProduct(page, gtin, productUrl)

        if (productData && productData.name) {
          const productId = await driver.saveProduct(payload, productData)

          // Update item status to crawled
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (payload.update as any)({
            collection: driver.collections.crawlItems,
            id: item.id,
            data: { status: 'crawled' },
          })

          results.push({ gtin, success: true, productId })
          crawledCount++
        } else {
          // Update item status to failed
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (payload.update as any)({
            collection: driver.collections.crawlItems,
            id: item.id,
            data: { status: 'failed' },
          })

          results.push({ gtin, success: false, error: 'Failed to scrape product data' })
        }

        // Random delay between requests
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 1000)
      }
    } finally {
      await browser.close()
    }

    // Check remaining pending items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const remainingResult = await (payload.count as any)({
      collection: driver.collections.crawlItems,
      where: {
        crawl: { equals: crawlId },
        status: { equals: 'pending' },
      },
    })

    const remainingPending = remainingResult.totalDocs
    const newCrawledCount = (crawl.itemsCrawled || 0) + crawledCount
    const newStatus = remainingPending === 0 ? 'completed' : 'crawling'

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (payload.update as any)({
      collection: driver.collections.crawls,
      id: crawlId,
      data: {
        itemsCrawled: newCrawledCount,
        status: newStatus,
        ...(newStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
      },
    })

    return Response.json({
      success: true,
      driver: driver.id,
      crawlId,
      processed: results.length,
      successful: crawledCount,
      failed: results.length - crawledCount,
      totalCrawled: newCrawledCount,
      remainingPending,
      status: newStatus,
      results,
    })
  } catch (error) {
    console.error('Crawl error:', error)
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Crawl API',
    usage: 'POST /api/crawl/crawl',
    modes: {
      directUrls:
        '{ "productUrls": ["/product-p123.html"], "driver": "dm" } - Crawl by product URLs (preferred)',
      directGtins: '{ "gtins": ["123", "456"], "driver": "dm" } - Crawl by GTINs (fallback)',
      fromSession: '{ "crawlId": "...", "limit": 10 } - Crawl pending items from a session',
      singleItem: '{ "crawlId": "...", "itemId": "..." } - Crawl a specific item from a session',
    },
    parameters: {
      productUrls: 'Optional. Array of product URLs to crawl directly (preferred over gtins).',
      gtins: 'Optional. Array of GTINs to crawl directly.',
      driver:
        'Required with productUrls/gtins. Driver ID (e.g., "dm"). Auto-detected from URLs if possible.',
      url: 'Alternative to driver. URL to determine driver from hostname.',
      crawlId: 'Required if productUrls/gtins not provided. The crawl session ID.',
      itemId: 'Optional. Crawl a specific item by ID from a session.',
      limit: 'Optional. Number of items to crawl per request (default: 10).',
    },
    availableDrivers: getAllDrivers().map((d) => ({
      id: d.id,
      name: d.name,
      hostnames: d.hostnames,
    })),
  })
}
