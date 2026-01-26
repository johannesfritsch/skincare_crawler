import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { launchBrowser } from '@/lib/browser'
import { getDriverByUrl, getSupportedHostnames } from '@/lib/crawl-drivers'

export const runtime = 'nodejs'
export const maxDuration = 300

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const url = body.url as string | undefined

    if (!url) {
      return Response.json(
        { success: false, error: 'url is required' },
        { status: 400 }
      )
    }

    // Get the appropriate driver based on URL hostname
    const driver = getDriverByUrl(url)
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
    const crawl = await (payload.create as any)({
      collection: driver.collections.crawls,
      data: {
        sourceUrl: url,
        status: 'discovering',
      },
    })

    console.log(`Created crawl ${crawl.id} using driver "${driver.name}", starting discovery of ${url}...`)

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
        message: `Discovered ${products.length} products. Use /api/crawl/crawl with crawlId=${crawl.id} to start crawling.`,
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
    usage: 'POST /api/crawl/discover with { "url": "https://..." }',
    supportedHostnames: getSupportedHostnames(),
    description:
      'Discovers all products on a category page and creates a crawl session. The driver is automatically selected based on the URL hostname.',
  })
}
