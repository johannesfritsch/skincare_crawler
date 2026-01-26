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

async function scrapeProductByGtin(page: Page, gtin: string): Promise<ProductData | null> {
  try {
    await page.goto(`https://www.dm.de/search?query=${gtin}`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-dmid="product-tile"]', { timeout: 10000 }).catch(() => null)

    const productData = await page.evaluate((searchGtin) => {
      const tile = document.querySelector(`[data-dmid="product-tile"][data-gtin="${searchGtin}"]`)
      if (!tile) return null

      const srOnly = tile.querySelector('.sr-only')
      const srText = srOnly?.textContent || ''

      const brandMatch = srText.match(/Marke:\s*([^;]+)/)
      const brandName = brandMatch ? brandMatch[1].trim() : null

      const nameMatch = srText.match(/Produktname:\s*([^;]+)/)
      const name = nameMatch ? nameMatch[1].trim() : ''

      const priceMatch = srText.match(/Preis:\s*([\d,]+)\s*€/)
      const price = priceMatch
        ? Math.round(parseFloat(priceMatch[1].replace(',', '.')) * 100)
        : null

      const pricePerMatch = srText.match(/Grundpreis:[^(]*\(([\d,]+)\s*€\s*je\s*[\d,]*\s*(\w+)\)/)
      const pricePerValue = pricePerMatch
        ? Math.round(parseFloat(pricePerMatch[1].replace(',', '.')) * 100)
        : null
      const pricePerUnit = pricePerMatch ? pricePerMatch[2] : null

      const ratingMatch = srText.match(/([\d,]+)\s*von\s*5\s*Sternen\s*bei\s*([\d.]+)\s*Bewertungen/)
      const rating = ratingMatch
        ? parseFloat(ratingMatch[1].replace(',', '.'))
        : null
      const ratingNum = ratingMatch
        ? parseInt(ratingMatch[2].replace('.', ''), 10)
        : null

      const labels: string[] = []
      const eyecatchers = tile.querySelectorAll('[data-dmid="eyecatchers"] img')
      eyecatchers.forEach((img) => {
        const alt = img.getAttribute('alt') || ''
        if (alt.includes('Neues Produkt')) labels.push('Neu')
        if (alt.includes('Limitiert')) labels.push('Limitiert')
        if (alt.includes('Marke von dm')) labels.push('dm-Marke')
      })

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

export const POST = async (request: Request) => {
  try {
    const payload = await getPayload({ config: configPromise })
    const body = await request.json().catch(() => ({}))
    const { gtin, productId } = body

    if (!gtin) {
      return Response.json({ success: false, error: 'gtin is required' }, { status: 400 })
    }

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

    try {
      // Accept cookies
      await page.goto('https://www.dm.de', { waitUntil: 'domcontentloaded' })
      await page.click('button:has-text("Alles akzeptieren")', { timeout: 5000 }).catch(() => {})
      await page.waitForTimeout(500)

      const productData = await scrapeProductByGtin(page, gtin)

      if (!productData || !productData.name) {
        return Response.json({ success: false, error: 'Failed to scrape product data' }, { status: 404 })
      }

      // Update the product
      if (productId) {
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
        // Find by GTIN and update
        const existing = await payload.find({
          collection: 'dm-products',
          where: { gtin: { equals: gtin } },
          limit: 1,
        })

        if (existing.docs.length > 0) {
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
        }
      }

      return Response.json({ success: true, productData })
    } finally {
      await browser.close()
    }
  } catch (error) {
    console.error('Product crawl error:', error)
    return Response.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
