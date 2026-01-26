import type { Payload } from 'payload'
import type { Page } from 'playwright-core'
import type { CrawlDriver, DiscoveryResult, ProductData } from './types'

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export const dmDriver: CrawlDriver = {
  id: 'dm',
  name: 'dm.de',
  hostnames: ['www.dm.de', 'dm.de'],

  collections: {
    products: 'dm-products',
    crawls: 'dm-crawls',
    crawlItems: 'dm-crawl-items',
  },

  async acceptCookies(page: Page): Promise<void> {
    try {
      await page.click('button:has-text("Alles akzeptieren")', { timeout: 5000 })
      await page.waitForTimeout(500)
    } catch {
      console.log('No cookie banner found or already accepted')
    }
  },

  async discoverProducts(page: Page, url: string): Promise<DiscoveryResult> {
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

    console.log(`Total products reported: ${totalCount}`)

    // Click "Mehr laden" button repeatedly until all products are loaded
    let previousCount = 0
    let currentCount = 0
    let noNewProductsCount = 0

    while (noNewProductsCount < 3) {
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

      if (currentCount >= totalCount) {
        console.log('All products loaded')
        break
      }

      try {
        const loadMoreButton = page.locator('[data-dmid="load-more-products-button"]')
        const isVisible = await loadMoreButton.isVisible()

        if (isVisible) {
          await loadMoreButton.click()
          await page.waitForTimeout(randomDelay(1000, 1500))
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

    return { totalCount, products }
  },

  async scrapeProduct(page: Page, gtin: string | null, productUrl: string | null): Promise<ProductData | null> {
    try {
      let searchUrl: string
      let ingredients: string[] = []

      if (productUrl) {
        // Use productUrl - navigate to product page and extract GTIN + ingredients
        const fullUrl = productUrl.startsWith('http') ? productUrl : `https://www.dm.de${productUrl}`
        await page.goto(fullUrl, { waitUntil: 'domcontentloaded' })

        // Extract GTIN and ingredients from product page
        const pageData = await page.evaluate(() => {
          // Try to find GTIN in the page
          let pageGtin: string | null = null
          const gtinEl = document.querySelector('[data-gtin]')
          if (gtinEl) {
            pageGtin = gtinEl.getAttribute('data-gtin')
          } else {
            // Try JSON-LD
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

          // Extract ingredients from [data-dmid="Inhaltsstoffe-content"]
          const ingredientsEl = document.querySelector('[data-dmid="Inhaltsstoffe-content"]')
          let ingredientsList: string[] = []
          if (ingredientsEl) {
            const text = ingredientsEl.textContent || ''
            // Remove "Ingredients:" prefix if present and split by comma
            const cleaned = text.replace(/^Ingredients:\s*/i, '').trim()
            if (cleaned) {
              ingredientsList = cleaned.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
            }
          }

          return { pageGtin, ingredients: ingredientsList }
        })

        ingredients = pageData.ingredients

        if (pageData.pageGtin) {
          searchUrl = `https://www.dm.de/search?query=${pageData.pageGtin}`
          gtin = pageData.pageGtin
        } else if (gtin) {
          searchUrl = `https://www.dm.de/search?query=${gtin}`
        } else {
          console.log(`Could not extract GTIN from product page: ${fullUrl}`)
          return null
        }
      } else if (gtin) {
        searchUrl = `https://www.dm.de/search?query=${gtin}`
      } else {
        console.log('No GTIN or productUrl provided')
        return null
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
        console.log(`No product data found for GTIN ${gtin}`)
        return null
      }

      // If we didn't have a productUrl but now have sourceUrl, fetch ingredients from detail page
      if (ingredients.length === 0 && productData.sourceUrl) {
        await page.goto(productData.sourceUrl, { waitUntil: 'domcontentloaded' })
        ingredients = await page.evaluate(() => {
          const ingredientsEl = document.querySelector('[data-dmid="Inhaltsstoffe-content"]')
          if (!ingredientsEl) return []
          const text = ingredientsEl.textContent || ''
          const cleaned = text.replace(/^Ingredients:\s*/i, '').trim()
          if (!cleaned) return []
          return cleaned.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
        })
      }

      return {
        gtin: productData.gtin || gtin || '',
        brandName: productData.brandName,
        name: productData.name,
        price: productData.price,
        pricePerUnit: productData.pricePerUnit,
        pricePerValue: productData.pricePerValue,
        rating: productData.rating,
        ratingNum: productData.ratingNum,
        labels: productData.labels,
        ingredients,
        sourceUrl: productData.sourceUrl,
      }
    } catch (error) {
      console.error(`Error scraping product (gtin: ${gtin}, url: ${productUrl}):`, error)
      return null
    }
  },

  async saveProduct(payload: Payload, data: ProductData): Promise<number> {
    const existing = await payload.find({
      collection: 'dm-products',
      where: { gtin: { equals: data.gtin } },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      const productId = existing.docs[0].id
      await payload.update({
        collection: 'dm-products',
        id: productId,
        data: {
          brandName: data.brandName,
          name: data.name,
          pricing: {
            amount: data.price,
            currency: 'EUR',
            perUnitAmount: data.pricePerValue,
            perUnitCurrency: 'EUR',
            unit: data.pricePerUnit,
          },
          rating: data.rating,
          ratingNum: data.ratingNum,
          labels: data.labels.map((label) => ({ label })),
          ingredients: data.ingredients.map((name) => ({ name })),
          sourceUrl: data.sourceUrl,
          crawledAt: new Date().toISOString(),
        },
      })
      return productId
    } else {
      const newProduct = await payload.create({
        collection: 'dm-products',
        data: {
          gtin: data.gtin,
          brandName: data.brandName,
          name: data.name,
          type: 'Product',
          pricing: {
            amount: data.price,
            currency: 'EUR',
            perUnitAmount: data.pricePerValue,
            perUnitCurrency: 'EUR',
            unit: data.pricePerUnit,
          },
          rating: data.rating,
          ratingNum: data.ratingNum,
          labels: data.labels.map((label) => ({ label })),
          ingredients: data.ingredients.map((name) => ({ name })),
          sourceUrl: data.sourceUrl,
          crawledAt: new Date().toISOString(),
        },
      })
      return newProduct.id
    }
  },
}
