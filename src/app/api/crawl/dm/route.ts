import { getPayload } from 'payload'
import configPromise from '@payload-config'
import chromium from '@sparticuz/chromium'
import { chromium as pwChromium } from 'playwright-core'

export const runtime = 'nodejs'
export const maxDuration = 300

interface Product {
  gtin: string | null
  brandName: string | null
  name: string
  price: number | null
  pricePerUnit: string | null
  pricePerValue: number | null
  rating: number | null
  ratingNum: number | null
  labels: string[]
}

async function scrapeProducts(url: string): Promise<Product[]> {
  const isVercel = !!process.env.VERCEL

  let browser
  if (isVercel) {
    // Use @sparticuz/chromium on Vercel
    const executablePath = await chromium.executablePath()
    browser = await pwChromium.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    })
  } else {
    // Local development: use system Chrome or run `npx playwright install chromium`
    browser = await pwChromium.launch({
      channel: 'chrome', // Uses installed Chrome
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

    // Scroll to load more products
    console.log('Scrolling to load products...')
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight))
      await page.waitForTimeout(800)
    }

    // Scrape products using the data-dmid="product-tile" structure
    const productData: Product[] = await page.evaluate(() => {
      const items: Array<{
        gtin: string | null
        brandName: string | null
        name: string
        price: number | null
        pricePerUnit: string | null
        pricePerValue: number | null
        rating: number | null
        ratingNum: number | null
        labels: string[]
      }> = []
      const productTiles = document.querySelectorAll('[data-dmid="product-tile"]')

      productTiles.forEach((tile) => {
        const gtin = tile.getAttribute('data-gtin')

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
        const price = priceMatch ? Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100) : null

        // Parse price per unit: "Grundpreis: 0,029 l (146,55 € je 1 l)"
        const pricePerMatch = srText.match(/Grundpreis:[^(]*\(([\d,]+)\s*€\s*je\s*[\d,]*\s*(\w+)\)/)
        const pricePerValue = pricePerMatch
          ? Math.round(parseFloat(pricePerMatch[1].replace(',', '.')) * 100)
          : null
        const pricePerUnit = pricePerMatch ? pricePerMatch[2] : null

        // Parse rating: "4,718 von 5 Sternen bei 277 Bewertungen"
        const ratingMatch = srText.match(/([\d,]+)\s*von\s*5\s*Sternen\s*bei\s*([\d.]+)\s*Bewertungen/)
        const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null
        const ratingNum = ratingMatch ? parseInt(ratingMatch[2].replace('.', ''), 10) : null

        // Parse labels from eyecatchers
        const labels: string[] = []
        const eyecatchers = tile.querySelectorAll('[data-dmid="eyecatchers"] img')
        eyecatchers.forEach((img) => {
          const alt = img.getAttribute('alt') || ''
          if (alt.includes('Neues Produkt')) labels.push('Neu')
          if (alt.includes('Limitiert')) labels.push('Limitiert')
          if (alt.includes('Marke von dm')) labels.push('dm-Marke')
        })

        if (name) {
          items.push({
            gtin,
            brandName,
            name,
            price,
            pricePerUnit,
            pricePerValue,
            rating,
            ratingNum,
            labels,
          })
        }
      })

      return items
    })

    return productData
  } finally {
    await browser.close()
  }
}

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const url = body.url || 'https://www.dm.de/make-up'

    console.log(`Starting crawl of ${url}...`)
    const scrapedProducts = await scrapeProducts(url)
    console.log(`Scraped ${scrapedProducts.length} products`)

    // Insert into Payload
    const insertedProducts = []
    for (const product of scrapedProducts) {
      const inserted = await payload.create({
        collection: 'dm-products',
        data: {
          gtin: product.gtin,
          brandName: product.brandName,
          name: product.name,
          type: 'Make-up',
          pricing: {
            amount: product.price,
            currency: 'EUR',
            perUnitAmount: product.pricePerValue,
            perUnitCurrency: 'EUR',
            unit: product.pricePerUnit,
          },
          rating: product.rating,
          ratingNum: product.ratingNum,
          labels: product.labels.map((label) => ({ label })),
          sourceUrl: url,
          crawledAt: new Date().toISOString(),
        },
      })
      insertedProducts.push(inserted)
    }

    return Response.json({
      success: true,
      message: `Crawled and inserted ${insertedProducts.length} products`,
      count: insertedProducts.length,
      sampleProducts: scrapedProducts.slice(0, 5),
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
    message: 'DM Crawler API',
    usage: 'POST /api/crawl/dm with optional { "url": "https://www.dm.de/..." }',
    defaultUrl: 'https://www.dm.de/make-up',
  })
}
