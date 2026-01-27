import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { launchBrowser } from '@/lib/browser'
import { getDriverByUrl, getSupportedHostnames, getAllDrivers } from '@/lib/crawl-drivers'
import type { CrawlDriver } from '@/lib/crawl-drivers'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const crawlId = body.crawlId as number | undefined
    let url = body.url as string | undefined

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let crawl: any = null
    let driver: CrawlDriver | null = null

    if (crawlId) {
      // Use existing crawl - find it and get the URL
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
            url = found.sourceUrl
            break
          }
        } catch {
          // Not found in this collection, try next
        }
      }

      if (!crawl || !driver) {
        return Response.json(
          { success: false, error: `Crawl session ${crawlId} not found` },
          { status: 404 }
        )
      }

      if (!url) {
        return Response.json(
          { success: false, error: 'Crawl session has no sourceUrl' },
          { status: 400 }
        )
      }

      // Update status to discovering
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (payload.update as any)({
        collection: driver.collections.crawls,
        id: crawlId,
        data: { status: 'discovering' },
      })

      console.log(`Using existing crawl ${crawl.id} with driver "${driver.name}", starting discovery of ${url}...`)
    } else {
      // Create new crawl
      if (!url) {
        return Response.json(
          { success: false, error: 'url is required (or crawlId to use existing crawl)' },
          { status: 400 }
        )
      }

      // Get the appropriate driver based on URL hostname
      driver = getDriverByUrl(url)
      if (!driver) {
        return Response.json(
          {
            success: false,
            error: `No driver found for URL. Supported hostnames: ${getSupportedHostnames().join(', ')}`,
          },
          { status: 400 }
        )
      }

      // Create a new crawl entry
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      crawl = await (payload.create as any)({
        collection: driver.collections.crawls,
        data: {
          sourceUrl: url,
          status: 'discovering',
        },
      })

      console.log(`Created crawl ${crawl.id} using driver "${driver.name}", starting discovery of ${url}...`)
    }

    const browser = await launchBrowser()
    const page = await browser.newPage()

    try {
      const { totalCount, products } = await driver.discoverProducts(page, url)
      console.log(`Discovered ${products.length} products (total reported: ${totalCount})`)

      // Create crawl items
      for (const product of products) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (payload.create as any)({
          collection: driver.collections.crawlItems,
          data: {
            crawl: crawl.id,
            gtin: product.gtin,
            productUrl: product.productUrl,
            status: 'pending',
          },
        })
      }

      // Update the crawl with counts
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (payload.update as any)({
        collection: driver.collections.crawls,
        id: crawl.id,
        data: {
          status: 'discovered',
          totalCount,
          itemsDiscovered: products.length,
          itemsCrawled: 0,
          discoveredAt: new Date().toISOString(),
        },
      })

      return Response.json({
        success: true,
        driver: driver.id,
        crawlId: crawl.id,
        totalCount,
        itemsDiscovered: products.length,
        status: 'discovered',
        message: `Discovered ${products.length} products. Use /api/sources/crawl with crawlId=${crawl.id} to start crawling.`,
      })
    } catch (error) {
      // Update crawl as failed
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (payload.update as any)({
        collection: driver.collections.crawls,
        id: crawl.id,
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      })
      throw error
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('Discovery error:', error)
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Discovery API',
    usage: 'POST /api/sources/discover',
    modes: {
      newCrawl: '{ "url": "https://..." } - Create new crawl and discover',
      existingCrawl: '{ "crawlId": 123 } - Discover using existing crawl session',
    },
    parameters: {
      url: 'Required for new crawl. The category/listing URL to discover products from.',
      crawlId: 'Optional. Use existing crawl session (will use its sourceUrl).',
    },
    supportedHostnames: getSupportedHostnames(),
    description:
      'Discovers all products on a category page. Creates a new crawl session or uses existing one. Driver is auto-selected based on URL hostname.',
  })
}
