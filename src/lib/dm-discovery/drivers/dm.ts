import type { Payload } from 'payload'
import type { Page } from 'playwright-core'
import type { DmDiscoveryDriver, DiscoveredProduct } from '../types'
import { parseIngredients } from '@/lib/parse-ingredients'

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export const dmDriver: DmDiscoveryDriver = {
  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.dm.de' || hostname === 'dm.de'
    } catch {
      return false
    }
  },

  getBaseUrl(): string {
    return 'https://www.dm.de'
  },

  async acceptCookies(page: Page): Promise<void> {
    try {
      await page.click('button:has-text("Alles akzeptieren")', { timeout: 5000 })
      await page.waitForTimeout(500)
    } catch {
      console.log('[DM] No cookie banner found or already accepted')
    }
  },

  async discoverProducts(
    page: Page,
    url: string,
  ): Promise<{ totalCount: number; products: DiscoveredProduct[] }> {
    console.log(`[DM] Starting discovery for ${url}`)
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await this.acceptCookies(page)

    // Extract total count from [data-dmid="total-count"]
    const totalCount = await page.evaluate(() => {
      const countEl = document.querySelector('[data-dmid="total-count"]')
      if (!countEl) return 0
      const text = countEl.getAttribute('title') || countEl.textContent || ''
      const match = text.match(/(\d+)/)
      return match ? parseInt(match[1], 10) : 0
    })

    console.log(`[DM] Total products reported: ${totalCount}`)

    // Click "Mehr laden" button repeatedly until all products are loaded
    let previousCount = 0
    let currentCount = 0
    let noNewProductsCount = 0

    while (noNewProductsCount < 3) {
      currentCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-dmid="product-tile"]').length
      })

      console.log(`[DM] Products loaded: ${currentCount}`)

      if (currentCount === previousCount) {
        noNewProductsCount++
      } else {
        noNewProductsCount = 0
      }

      previousCount = currentCount

      if (currentCount >= totalCount) {
        console.log('[DM] All products loaded')
        break
      }

      try {
        const loadMoreButton = page.locator('[data-dmid="load-more-products-button"]')
        const isVisible = await loadMoreButton.isVisible()

        if (isVisible) {
          await loadMoreButton.click()
          await page.waitForTimeout(randomDelay(1000, 1500))
        } else {
          console.log('[DM] Load more button not visible')
          noNewProductsCount++
        }
      } catch (error) {
        console.log('[DM] Could not click load more button:', error)
        noNewProductsCount++
      }
    }

    // Extract all product GTINs and URLs
    const products = await page.evaluate(() => {
      const items: Array<{ gtin: string; productUrl: string | null }> = []
      const productTiles = document.querySelectorAll('[data-dmid="product-tile"]')

      productTiles.forEach((tile) => {
        const gtin = tile.getAttribute('data-gtin')
        const link = tile.querySelector('a[href]')
        const productUrl = link ? link.getAttribute('href') : null

        if (gtin) {
          items.push({ gtin, productUrl })
        }
      })

      return items
    })

    console.log(`[DM] Discovered ${products.length} products`)
    return { totalCount, products }
  },

  async crawlProduct(
    page: Page,
    gtin: string,
    productUrl: string | null,
    payload: Payload,
  ): Promise<number | null> {
    try {
      let searchUrl: string
      let ingredients: string[] = []

      if (productUrl) {
        // Use productUrl - navigate to product page and extract GTIN + ingredients
        const fullUrl = productUrl.startsWith('http') ? productUrl : `https://www.dm.de${productUrl}`
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded' })

        // Wait for the ingredients section to load
        await page.waitForSelector('[data-dmid="Inhaltsstoffe-content"]', { timeout: 5000 }).catch(() => null)

        // Extract GTIN and raw ingredients text from product page
        const pageData = await page.evaluate(() => {
          let pageGtin: string | null = null
          const gtinEl = document.querySelector('[data-gtin]')
          if (gtinEl) {
            pageGtin = gtinEl.getAttribute('data-gtin')
          } else {
            const jsonLd = document.querySelector('script[type="application/ld+json"]')
            if (jsonLd) {
              try {
                const data = JSON.parse(jsonLd.textContent || '')
                if (data.gtin13) pageGtin = data.gtin13
                else if (data.gtin) pageGtin = data.gtin
              } catch {
                // ignore parse errors
              }
            }
          }

          const ingredientsEl = document.querySelector('[data-dmid="Inhaltsstoffe-content"]')
          const rawIngredients = ingredientsEl?.textContent?.trim() || null

          return { pageGtin, rawIngredients }
        })

        if (pageData.rawIngredients) {
          ingredients = await parseIngredients(pageData.rawIngredients)
        }

        if (pageData.pageGtin) {
          searchUrl = `https://www.dm.de/search?query=${pageData.pageGtin}`
          gtin = pageData.pageGtin
        } else {
          searchUrl = `https://www.dm.de/search?query=${gtin}`
        }
      } else {
        searchUrl = `https://www.dm.de/search?query=${gtin}`
      }

      // Search for the product by GTIN to get the product tile with structured data
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[data-dmid="product-tile"]', { timeout: 10000 }).catch(() => null)

      const productData = await page.evaluate((searchGtin) => {
        const tile = searchGtin
          ? document.querySelector(`[data-dmid="product-tile"][data-gtin="${searchGtin}"]`)
          : document.querySelector('[data-dmid="product-tile"]')
        if (!tile) return null

        const tileGtin = tile.getAttribute('data-gtin')

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
        const rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null
        const ratingNum = ratingMatch ? parseInt(ratingMatch[2].replace('.', ''), 10) : null

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
          gtin: tileGtin,
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
        console.log(`[DM] No product data found for GTIN ${gtin}`)
        return null
      }

      // If we didn't have a productUrl but now have sourceUrl, fetch ingredients
      if (ingredients.length === 0 && productData.sourceUrl) {
        await page.goto(productData.sourceUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('[data-dmid="Inhaltsstoffe-content"]', { timeout: 5000 }).catch(() => null)
        const rawText = await page.evaluate(() => {
          const ingredientsEl = document.querySelector('[data-dmid="Inhaltsstoffe-content"]')
          return ingredientsEl?.textContent?.trim() || null
        })
        if (rawText) {
          ingredients = await parseIngredients(rawText)
        }
      }

      // Save to database
      const finalGtin = productData.gtin || gtin
      const existing = await payload.find({
        collection: 'dm-products',
        where: { gtin: { equals: finalGtin } },
        limit: 1,
      })

      const productPayload = {
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
        labels: productData.labels.map((label) => ({ label })),
        ingredients: ingredients.map((name) => ({ name })),
        sourceUrl: productData.sourceUrl,
        crawledAt: new Date().toISOString(),
      }

      let productId: number

      if (existing.docs.length > 0) {
        productId = existing.docs[0].id
        await payload.update({
          collection: 'dm-products',
          id: productId,
          data: productPayload,
        })
      } else {
        const newProduct = await payload.create({
          collection: 'dm-products',
          data: {
            gtin: finalGtin,
            type: 'Product',
            ...productPayload,
          },
        })
        productId = newProduct.id
      }

      console.log(`[DM] Crawled product ${finalGtin}: ${productData.name} (id: ${productId})`)
      return productId
    } catch (error) {
      console.error(`[DM] Error crawling product (gtin: ${gtin}, url: ${productUrl}):`, error)
      return null
    }
  },
}
