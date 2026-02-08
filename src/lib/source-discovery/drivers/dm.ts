import type { Payload } from 'payload'
import type { Page } from 'playwright-core'
import type { SourceDriver, DiscoveredProduct } from '../types'
import { parseIngredients } from '@/lib/parse-ingredients'

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Navigation tree node shape
interface NavNode {
  id: string
  title: string
  link: string
  hidden?: boolean
  children?: NavNode[]
}

// Find the subtree matching a target path (e.g., "/make-up/augen")
function findSubtree(node: NavNode, targetPath: string): NavNode | null {
  if (node.link === targetPath) return node
  if (node.children) {
    for (const child of node.children) {
      const found = findSubtree(child, targetPath)
      if (found) return found
    }
  }
  return null
}

// Collect leaf nodes (no children or empty children, not hidden)
function collectLeaves(node: NavNode, path: string[] = []): { node: NavNode; breadcrumb: string }[] {
  const currentPath = [...path, node.title]
  if (!node.children || node.children.length === 0) {
    if (node.hidden) return []
    return [{ node, breadcrumb: currentPath.join(' -> ') }]
  }
  const leaves: { node: NavNode; breadcrumb: string }[] = []
  for (const child of node.children) {
    if (!child.hidden) {
      leaves.push(...collectLeaves(child, currentPath))
    }
  }
  return leaves
}

// Fetch the product search category ID from a content page
async function fetchCategoryId(link: string): Promise<string | null> {
  const url = `https://content.services.dmtech.com/rootpage-dm-shop-de-de${link}?view=category&mrclx=true`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.log(`[DM] Content page fetch failed for ${link}: ${res.status}`)
      return null
    }
    const data = await res.json()
    const mainData = data?.mainData
    if (!Array.isArray(mainData)) return null

    for (const entry of mainData) {
      if (entry.type === 'DMSearchProductGrid' && entry.query?.filters) {
        const match = entry.query.filters.match(/allCategories\.id:(\S+)/)
        if (match) return match[1]
      }
    }
    return null
  } catch (error) {
    console.error(`[DM] Error fetching category ID for ${link}:`, error)
    return null
  }
}

// Fetch all products for a category ID via the product search API
async function fetchProducts(
  categoryId: string,
  pageSize: number = 60,
): Promise<{ products: Array<Record<string, unknown>>; totalCount: number }> {
  const allProducts: Array<Record<string, unknown>> = []
  let currentPage = 0
  let totalPages = 1
  let totalCount = 0

  while (currentPage < totalPages) {
    const url = `https://product-search.services.dmtech.com/de/search/static?allCategories.id=${categoryId}&pageSize=${pageSize}&currentPage=${currentPage}&sort=relevance`
    try {
      const res = await fetch(url)
      if (!res.ok) {
        console.log(`[DM] Product search failed for category ${categoryId} page ${currentPage}: ${res.status}`)
        break
      }
      const data = await res.json()
      totalPages = data.totalPages ?? 1
      totalCount = data.totalElements ?? 0
      const products = data.products ?? []
      allProducts.push(...products)
      currentPage++

      if (currentPage < totalPages) {
        await sleep(randomDelay(300, 700))
      }
    } catch (error) {
      console.error(`[DM] Error fetching products for category ${categoryId} page ${currentPage}:`, error)
      break
    }
  }

  return { products: allProducts, totalCount }
}

export const dmDriver: SourceDriver = {
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
    url: string,
  ): Promise<{ totalCount: number; products: DiscoveredProduct[] }> {
    console.log(`[DM] Starting API-based discovery for ${url}`)

    // Step 1: Parse target path from URL
    const targetPath = new URL(url).pathname.replace(/\/$/, '') || '/'
    console.log(`[DM] Target path: ${targetPath}`)

    // Step 2: Fetch navigation tree
    const navRes = await fetch('https://content.services.dmtech.com/rootpage-dm-shop-de-de?view=navigation&mrclx=true')
    if (!navRes.ok) {
      throw new Error(`Failed to fetch navigation tree: ${navRes.status}`)
    }
    const navData = await navRes.json()
    const navChildren: NavNode[] = navData.children ?? []

    // Find the subtree matching the target path
    let subtree: NavNode | null = null
    for (const child of navChildren) {
      subtree = findSubtree(child, targetPath)
      if (subtree) break
    }

    // Step 3: Collect leaf categories (or treat the URL itself as a leaf)
    const categoryLeaves: { categoryId: string; breadcrumb: string }[] = []

    if (!subtree) {
      // No subtree found — treat the URL directly as a leaf category
      console.log(`[DM] No subtree in nav tree for ${targetPath}, treating as direct leaf`)
      const categoryId = await fetchCategoryId(targetPath)
      if (!categoryId) {
        throw new Error(`No category ID found for path: ${targetPath}`)
      }
      // Build breadcrumb from the URL path segments
      const breadcrumb = targetPath.split('/').filter(Boolean)
        .map((seg) => seg.replace(/-und-/g, ' & ').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
        .join(' -> ')
      categoryLeaves.push({ categoryId, breadcrumb })
      console.log(`[DM] Direct leaf resolved: ${targetPath} -> category ${categoryId} (${breadcrumb})`)
    } else {
      console.log(`[DM] Found subtree: ${subtree.title} (${subtree.id})`)

      const leaves = collectLeaves(subtree)
      console.log(`[DM] Found ${leaves.length} leaf categories`)

      // Step 4: Resolve category IDs for each leaf
      for (const leaf of leaves) {
        const categoryId = await fetchCategoryId(leaf.node.link)
        if (categoryId) {
          categoryLeaves.push({ categoryId, breadcrumb: leaf.breadcrumb })
          console.log(`[DM] Resolved ${leaf.node.link} -> category ${categoryId}`)
        } else {
          console.log(`[DM] No category ID found for ${leaf.node.link}, skipping`)
        }
        await sleep(randomDelay(200, 500))
      }

      console.log(`[DM] Resolved ${categoryLeaves.length}/${leaves.length} category IDs`)
    }

    // Step 5: Fetch products for each category
    const allProducts: DiscoveredProduct[] = []
    let totalCount = 0
    const seenGtins = new Set<string>()

    for (const { categoryId, breadcrumb } of categoryLeaves) {
      const { products, totalCount: catTotal } = await fetchProducts(categoryId)
      totalCount += catTotal
      console.log(`[DM] Category ${categoryId}: ${products.length} products (${breadcrumb})`)

      for (const product of products) {
        const gtin = String((product as Record<string, unknown>).gtin ?? '')
        if (!gtin || seenGtins.has(gtin)) continue
        seenGtins.add(gtin)

        const tileData = (product as Record<string, unknown>).tileData as Record<string, unknown> | undefined
        const trackingData = tileData?.trackingData as Record<string, unknown> | undefined
        const ratingData = tileData?.rating as Record<string, unknown> | undefined

        allProducts.push({
          gtin,
          productUrl: tileData?.self ? `https://www.dm.de${tileData.self}` : null,
          brandName: (product as Record<string, unknown>).brandName as string | undefined,
          name: (product as Record<string, unknown>).title as string | undefined,
          price: trackingData?.price != null
            ? Math.round(Number(trackingData.price) * 100)
            : undefined,
          currency: trackingData?.currency as string | undefined,
          rating: ratingData?.ratingValue as number | undefined,
          ratingCount: ratingData?.ratingCount as number | undefined,
          category: breadcrumb,
        })
      }

      await sleep(randomDelay(300, 700))
    }

    console.log(`[DM] Discovery complete: ${allProducts.length} unique products (total reported: ${totalCount})`)
    return { totalCount, products: allProducts }
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

        // Select the correct variant by GTIN if the page has multiple variants
        try {
          const variantButton = page.locator(`[data-dmid="variant-picker"] button[data-gtin="${gtin}"], [data-gtin="${gtin}"]`).first()
          if (await variantButton.isVisible({ timeout: 3000 })) {
            const isSelected = await variantButton.getAttribute('aria-checked') === 'true'
              || await variantButton.getAttribute('aria-selected') === 'true'
              || await variantButton.evaluate((el) => el.classList.contains('selected') || el.classList.contains('active'))
            if (!isSelected) {
              console.log(`[DM] Clicking variant for GTIN ${gtin}`)
              await variantButton.click()
              await page.waitForTimeout(1000)
            }
          }
        } catch {
          // No variant picker or single-variant product — proceed normally
        }

        // Wait for the ingredients section to load
        await page.waitForSelector('[data-dmid="Inhaltsstoffe-content"]', { timeout: 5000 }).catch(() => null)

        // Extract GTIN and raw ingredients text from product page
        const pageData = await page.evaluate((expectedGtin) => {
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

          if (pageGtin && expectedGtin && pageGtin !== expectedGtin) {
            console.warn(`[DM] GTIN mismatch: page shows ${pageGtin} but expected ${expectedGtin}`)
          }

          const ingredientsEl = document.querySelector('[data-dmid="Inhaltsstoffe-content"]')
          const rawIngredients = ingredientsEl?.textContent?.trim() || null

          return { pageGtin, rawIngredients }
        }, gtin)

        if (pageData.rawIngredients) {
          console.log(`[DM] Raw ingredients text for GTIN ${gtin}:`, pageData.rawIngredients)
          ingredients = await parseIngredients(pageData.rawIngredients)
          console.log(`[DM] Parsed ${ingredients.length} ingredients:`, ingredients)
        } else {
          console.log(`[DM] No ingredients found on product page for GTIN ${gtin}`)
        }

        searchUrl = `https://www.dm.de/search?query=${gtin}`
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
        console.log(`[DM] Fetching ingredients from sourceUrl: ${productData.sourceUrl}`)
        await page.goto(productData.sourceUrl, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('[data-dmid="Inhaltsstoffe-content"]', { timeout: 5000 }).catch(() => null)
        const rawText = await page.evaluate(() => {
          const ingredientsEl = document.querySelector('[data-dmid="Inhaltsstoffe-content"]')
          return ingredientsEl?.textContent?.trim() || null
        })
        if (rawText) {
          console.log(`[DM] Raw ingredients from sourceUrl for GTIN ${gtin}:`, rawText)
          ingredients = await parseIngredients(rawText)
          console.log(`[DM] Parsed ${ingredients.length} ingredients from sourceUrl:`, ingredients)
        } else {
          console.log(`[DM] No ingredients found at sourceUrl for GTIN ${gtin}`)
        }
      }

      // Update existing product with crawled data
      const finalGtin = gtin
      const existing = await payload.find({
        collection: 'dm-products',
        where: { gtin: { equals: finalGtin } },
        limit: 1,
      })

      const productPayload = {
        status: 'crawled' as const,
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
        ingredients: ingredients.map((name: string) => ({ name })),
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
        // Create new product if it doesn't exist (edge case)
        const newProduct = await payload.create({
          collection: 'dm-products',
          data: {
            gtin: finalGtin,
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
