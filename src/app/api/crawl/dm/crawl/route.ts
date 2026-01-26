import { getPayload } from 'payload'
import configPromise from '@payload-config'
import chromium from '@sparticuz/chromium'
import { chromium as pwChromium, type Page } from 'playwright-core'

export const runtime = 'nodejs'
export const maxDuration = 300

interface ProductData {
  gtin: string
  brandName: string | null
  name: string
  price: number | null
  pricePerUnit: string | null
  pricePerValue: number | null
  rating: number | null
  ratingNum: number | null
  labels: string[]
  sourceUrl: string | null
}

async function scrapeProductByUrl(page: Page, gtin: string, productUrl: string | null): Promise<ProductData | null> {
  try {
    if (!productUrl) {
      // Fallback: search for the product by GTIN
      await page.goto(`https://www.dm.de/search?query=${gtin}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-dmid="product-tile"]', { timeout: 5000 }).catch(() => null)
      const productTile = page.locator(`[data-dmid="product-tile"][data-gtin="${gtin}"] a`).first()
      if ((await productTile.count()) === 0) {
        console.log(`No product tile found for GTIN ${gtin}`)
        return null
      }
      await productTile.click()
      await page.waitForLoadState('domcontentloaded')
    } else {
      // Navigate directly to product URL
      await page.goto(`https://www.dm.de${productUrl}`, { waitUntil: 'domcontentloaded' })
    }

    const productData = await page.evaluate(() => {
      // Try to get data from structured data or page content
      const srOnly = document.querySelector('.sr-only')
      const srText = srOnly?.textContent || ''

      // Parse brand
      const brandMatch = srText.match(/Marke:\s*([^;]+)/)
      const brandName = brandMatch ? brandMatch[1].trim() : null

      // Parse product name
      const nameMatch = srText.match(/Produktname:\s*([^;]+)/)
      const name = nameMatch ? nameMatch[1].trim() : document.title.split(' | ')[0] || ''

      // Parse price
      const priceMatch = srText.match(/Preis:\s*([\d,]+)\s*€/)
      const price = priceMatch ? Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100) : null

      // Parse price per unit
      const pricePerMatch = srText.match(/Grundpreis:[^(]*\(([\d,]+)\s*€\s*je\s*[\d,]*\s*(\w+)\)/)
      const pricePerValue = pricePerMatch
        ? Math.round(parseFloat(pricePerMatch[1].replace(',', '.')) * 100)
        : null
      const pricePerUnit = pricePerMatch ? pricePerMatch[2] : null

      // Parse rating
      const ratingMatch = srText.match(/([\d,]+)\s*von\s*5\s*Sternen\s*bei\s*([\d.]+)\s*Bewertungen/)
      const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null
      const ratingNum = ratingMatch ? parseInt(ratingMatch[2].replace('.', ''), 10) : null

      // Parse labels
      const labels: string[] = []
      const eyecatchers = document.querySelectorAll('[data-dmid="eyecatchers"] img')
      eyecatchers.forEach((img) => {
        const alt = img.getAttribute('alt') || ''
        if (alt.includes('Neues Produkt')) labels.push('Neu')
        if (alt.includes('Limitiert')) labels.push('Limitiert')
        if (alt.includes('Marke von dm')) labels.push('dm-Marke')
      })

      return {
        brandName,
        name,
        price,
        pricePerUnit,
        pricePerValue,
        rating,
        ratingNum,
        labels,
        sourceUrl: window.location.href,
      }
    })

    return {
      gtin,
      ...productData,
    }
  } catch (error) {
    console.error(`Error scraping GTIN ${gtin}:`, error)
    return null
  }
}

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const crawlId = body.crawlId
    const limit = body.limit || 10

    if (!crawlId) {
      return Response.json(
        {
          success: false,
          error: 'crawlId is required. Use /api/crawl/dm/discover first to create a crawl session.',
        },
        { status: 400 }
      )
    }

    // Get the crawl session
    const crawl = await payload.findByID({
      collection: 'dm-crawls',
      id: crawlId,
    })

    if (!crawl) {
      return Response.json(
        {
          success: false,
          error: `Crawl session ${crawlId} not found`,
        },
        { status: 404 }
      )
    }

    // Get pending items from the crawl items collection
    const pendingItemsResult = await payload.find({
      collection: 'dm-crawl-items',
      where: {
        crawl: { equals: crawlId },
        status: { equals: 'pending' },
      },
      limit,
    })

    const pendingItems = pendingItemsResult.docs

    if (pendingItems.length === 0) {
      // Mark as completed if no more pending items
      await payload.update({
        collection: 'dm-crawls',
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

    // Update status to crawling
    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        status: 'crawling',
      },
    })

    // Items to process
    const itemsToProcess = pendingItems

    // Launch browser
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

    // Accept cookies once
    try {
      await page.goto('https://www.dm.de', { waitUntil: 'domcontentloaded' })
      await page.click('button:has-text("Alles akzeptieren")', { timeout: 5000 })
      await page.waitForTimeout(500)
    } catch {
      console.log('No cookie banner or already accepted')
    }

    const results: { gtin: string; success: boolean; error?: string }[] = []
    let crawledCount = 0

    try {
      for (const item of itemsToProcess) {
        const gtin = item.gtin
        const productUrl = item.productUrl || null

        console.log(`Crawling product ${gtin}...`)

        const productData = await scrapeProductByUrl(page, gtin, productUrl)

        if (productData && productData.name) {
          // Upsert into DmProducts
          const existing = await payload.find({
            collection: 'dm-products',
            where: {
              gtin: { equals: gtin },
            },
            limit: 1,
          })

          if (existing.docs.length > 0) {
            // Update existing
            await payload.update({
              collection: 'dm-products',
              id: existing.docs[0].id,
              data: {
                brandName: productData.brandName,
                name: productData.name,
                pricing: {
                  amount: productData.price,
                  currency: 'EUR',
                  perUnitAmount: productData.pricePerValue,
                  perUnitCurrency: 'EUR',
                  unit: productData.pricePerUnit,
                },
                rating: productData.rating,
                ratingNum: productData.ratingNum,
                labels: productData.labels.map((label: string) => ({ label })),
                sourceUrl: productData.sourceUrl,
                crawledAt: new Date().toISOString(),
              },
            })
          } else {
            // Create new
            await payload.create({
              collection: 'dm-products',
              data: {
                gtin: productData.gtin || gtin,
                brandName: productData.brandName,
                name: productData.name,
                type: 'Make-up',
                pricing: {
                  amount: productData.price,
                  currency: 'EUR',
                  perUnitAmount: productData.pricePerValue,
                  perUnitCurrency: 'EUR',
                  unit: productData.pricePerUnit,
                },
                rating: productData.rating,
                ratingNum: productData.ratingNum,
                labels: productData.labels.map((label: string) => ({ label })),
                sourceUrl: productData.sourceUrl,
                crawledAt: new Date().toISOString(),
              },
            })
          }

          // Update item status to crawled
          await payload.update({
            collection: 'dm-crawl-items',
            id: item.id,
            data: { status: 'crawled' },
          })

          results.push({ gtin, success: true })
          crawledCount++
        } else {
          // Update item status to failed
          await payload.update({
            collection: 'dm-crawl-items',
            id: item.id,
            data: { status: 'failed' },
          })

          results.push({ gtin, success: false, error: 'Failed to scrape product data' })
        }

        // Random delay between requests (1000-1500ms)
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 1000)
      }
    } finally {
      await browser.close()
    }

    // Check remaining pending items
    const remainingResult = await payload.count({
      collection: 'dm-crawl-items',
      where: {
        crawl: { equals: crawlId },
        status: { equals: 'pending' },
      },
    })

    const remainingPending = remainingResult.totalDocs
    const newCrawledCount = (crawl.itemsCrawled || 0) + crawledCount
    const newStatus = remainingPending === 0 ? 'completed' : 'crawling'

    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        itemsCrawled: newCrawledCount,
        status: newStatus,
        ...(newStatus === 'completed' ? { completedAt: new Date().toISOString() } : {}),
      },
    })

    return Response.json({
      success: true,
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
    message: 'DM Crawl API',
    usage: 'POST /api/crawl/dm/crawl with { "crawlId": "...", "limit": 10 }',
    parameters: {
      crawlId: 'Required. The crawl session ID from /api/crawl/dm/discover',
      limit: 'Optional. Number of items to crawl per request (default: 10)',
    },
    description:
      'Crawls pending items from a discovery session and upserts them into DmProducts. Call repeatedly until all items are processed.',
  })
}
