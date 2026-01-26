import { getPayload, type Payload } from 'payload'
import configPromise from '@payload-config'
import chromium from '@sparticuz/chromium'
import { chromium as pwChromium, type Page } from 'playwright-core'

export const runtime = 'nodejs'
export const maxDuration = 300

async function launchBrowser() {
  const isVercel = !!process.env.VERCEL
  if (isVercel) {
    const executablePath = await chromium.executablePath()
    return pwChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    })
  } else {
    return pwChromium.launch({
      channel: 'chrome',
      headless: true,
    })
  }
}

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
    // Search for the product by GTIN to get the product tile with structured data
    await page.goto(`https://www.dm.de/search?query=${gtin}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-dmid="product-tile"]', { timeout: 10000 }).catch(() => null)

    // Extract data from the product tile on the search results page
    // The .sr-only span inside the tile contains all the structured data
    const productData = await page.evaluate((searchGtin) => {
      const tile = document.querySelector(`[data-dmid="product-tile"][data-gtin="${searchGtin}"]`)
      if (!tile) return null

      // Get all info from the sr-only span (most reliable)
      const srOnly = tile.querySelector('.sr-only')
      const srText = srOnly?.textContent || ''

      // Parse brand from sr-only: "Marke: BRAND;"
      const brandMatch = srText.match(/Marke:\s*([^;]+)/)
      const brandName = brandMatch ? brandMatch[1].trim() : null

      // Parse product name from sr-only: "Produktname: NAME;"
      const nameMatch = srText.match(/Produktname:\s*([^;]+)/)
      const name = nameMatch ? nameMatch[1].trim() : ''

      // Parse price from sr-only: "Preis: 12,95 €;"
      const priceMatch = srText.match(/Preis:\s*([\d,]+)\s*€/)
      const price = priceMatch
        ? Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
        : null

      // Parse price per unit: "Grundpreis: 0,029 l (146,55 € je 1 l)"
      const pricePerMatch = srText.match(/Grundpreis:[^(]*\(([\d,]+)\s*€\s*je\s*[\d,]*\s*(\w+)\)/)
      const pricePerValue = pricePerMatch
        ? Math.round(parseFloat(pricePerMatch[1].replace(',', '.')) * 100)
        : null
      const pricePerUnit = pricePerMatch ? pricePerMatch[2] : null

      // Parse rating: "4,718 von 5 Sternen bei 277 Bewertungen"
      const ratingMatch = srText.match(/([\d,]+)\s*von\s*5\s*Sternen\s*bei\s*([\d.]+)\s*Bewertungen/)
      const rating = ratingMatch
        ? parseFloat(ratingMatch[1].replace(',', '.'))
        : null
      const ratingNum = ratingMatch
        ? parseInt(ratingMatch[2].replace('.', ''), 10)
        : null

      // Parse labels from eyecatchers
      const labels: string[] = []
      const eyecatchers = tile.querySelectorAll('[data-dmid="eyecatchers"] img')
      eyecatchers.forEach((img) => {
        const alt = img.getAttribute('alt') || ''
        if (alt.includes('Neues Produkt')) labels.push('Neu')
        if (alt.includes('Limitiert')) labels.push('Limitiert')
        if (alt.includes('Marke von dm')) labels.push('dm-Marke')
      })

      // Get the product URL from the tile link
      const link = tile.querySelector('a[href]')
      const tileProductUrl = link ? link.getAttribute('href') : null

      return {
        brandName,
        name,
        price,
        pricePerUnit,
        pricePerValue,
        rating,
        ratingNum,
        labels,
        sourceUrl: tileProductUrl ? `https://www.dm.de${tileProductUrl}` : null,
      }
    }, gtin)

    if (!productData || !productData.name) {
      console.log(`No product data found for GTIN ${gtin}`)
      return null
    }

    return {
      gtin,
      ...productData,
    }
  } catch (error) {
    console.error(`Error scraping GTIN ${gtin}:`, error)
    return null
  }
}

async function crawlByGtins(payload: Payload, gtins: string[]) {
  const browser = await launchBrowser()
  const page = await browser.newPage()

  try {
    // Accept cookies once
    await page.goto('https://www.dm.de', { waitUntil: 'domcontentloaded' })
    await page.click('button:has-text("Alles akzeptieren")', { timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)

    const results: { gtin: string; success: boolean; productId?: number; error?: string }[] = []

    for (const gtin of gtins) {
      console.log(`Crawling product ${gtin}...`)

      const productData = await scrapeProductByUrl(page, gtin, null)

      if (productData && productData.name) {
        // Upsert into DmProducts
        const existing = await payload.find({
          collection: 'dm-products',
          where: { gtin: { equals: gtin } },
          limit: 1,
        })

        let productId: number

        if (existing.docs.length > 0) {
          productId = existing.docs[0].id
          await payload.update({
            collection: 'dm-products',
            id: productId,
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
          const newProduct = await payload.create({
            collection: 'dm-products',
            data: {
              gtin,
              brandName: productData.brandName,
              name: productData.name,
              type: 'Product',
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
          productId = newProduct.id
        }

        results.push({ gtin, success: true, productId })
      } else {
        results.push({ gtin, success: false, error: 'Failed to scrape product data' })
      }

      // Delay between requests
      if (gtins.indexOf(gtin) < gtins.length - 1) {
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 1000)
      }
    }

    return Response.json({
      success: true,
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
    const crawlId = body.crawlId
    const itemId = body.itemId // Optional: crawl a specific item by its ID
    const gtins = body.gtins as string[] | undefined // Optional: crawl specific GTINs directly
    const limit = body.limit || 10

    // Mode 1: Direct GTIN crawl (no crawl session needed)
    if (gtins && Array.isArray(gtins) && gtins.length > 0) {
      return await crawlByGtins(payload, gtins)
    }

    // Mode 2: Crawl from a crawl session
    if (!crawlId) {
      return Response.json(
        {
          success: false,
          error: 'Either gtins array or crawlId is required.',
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

    let itemsToProcess

    if (itemId) {
      // Crawl a specific item by ID
      const item = await payload.findByID({
        collection: 'dm-crawl-items',
        id: itemId,
      })

      if (!item) {
        return Response.json(
          { success: false, error: `Item ${itemId} not found` },
          { status: 404 }
        )
      }

      itemsToProcess = [item]
    } else {
      // Get pending items from the crawl items collection
      const pendingItemsResult = await payload.find({
        collection: 'dm-crawl-items',
        where: {
          crawl: { equals: crawlId },
          status: { equals: 'pending' },
        },
        limit,
      })

      itemsToProcess = pendingItemsResult.docs

      if (itemsToProcess.length === 0) {
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
    }

    // Update status to crawling
    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        status: 'crawling',
      },
    })

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

    const results: { gtin: string; success: boolean; productId?: number; error?: string }[] = []
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

          let productId: number

          if (existing.docs.length > 0) {
            // Update existing
            productId = existing.docs[0].id
            await payload.update({
              collection: 'dm-products',
              id: productId,
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
            const newProduct = await payload.create({
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
            productId = newProduct.id
          }

          // Update item status to crawled
          await payload.update({
            collection: 'dm-crawl-items',
            id: item.id,
            data: { status: 'crawled' },
          })

          results.push({ gtin, success: true, productId })
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
    usage: 'POST /api/crawl/dm/crawl',
    modes: {
      directGtins: '{ "gtins": ["123", "456"] } - Crawl specific GTINs directly without a crawl session',
      fromSession: '{ "crawlId": "...", "limit": 10 } - Crawl pending items from a session',
      singleItem: '{ "crawlId": "...", "itemId": "..." } - Crawl a specific item from a session',
    },
    parameters: {
      gtins: 'Optional. Array of GTINs to crawl directly. Creates/updates products without a crawl session.',
      crawlId: 'Required if gtins not provided. The crawl session ID from /api/crawl/dm/discover.',
      itemId: 'Optional. Crawl a specific item by ID from a session.',
      limit: 'Optional. Number of items to crawl per request (default: 10).',
    },
    description:
      'Crawls products from dm.de and upserts them into DmProducts. Use gtins for direct crawl, or crawlId for session-based crawling.',
  })
}
