import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ScrapedProductData } from '../types'
import { stealthFetch } from '@/lib/stealth-fetch'
import { parseIngredients } from '@/lib/parse-ingredients'
import { createLogger } from '@/lib/logger'

const log = createLogger('DM')

const DM_PRODUCT_API = 'https://products.dm.de/product/products/detail/DE/gtin'
const DM_REFERER = 'https://www.dm.de/'

// Common headers for all DM API calls (browser sends these from www.dm.de)
const DM_HEADERS: HeadersInit = {
  'Referer': DM_REFERER,
}

// Extra headers for product search API specifically
function dmSearchHeaders(): HeadersInit {
  // Token is a random numeric ID generated per browser session
  const token = String(Math.floor(Math.random() * 90000000000000) + 10000000000000)
  return {
    ...DM_HEADERS,
    'x-dm-product-search-tags': 'presentation:grid;search-type:editorial;channel:web;editorial-type:category',
    'x-dm-product-search-token': token,
  }
}

// Lazily generated per-process search headers (token stays consistent within a session)
let _searchHeaders: HeadersInit | null = null
function getSearchHeaders(): HeadersInit {
  if (!_searchHeaders) _searchHeaders = dmSearchHeaders()
  return _searchHeaders
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

// DM product detail API response shapes
interface DmContentBlock {
  bulletpoints?: string[]
  texts?: string[]
  descriptionList?: { title: string; description: string }[]
}

interface DmDescriptionGroup {
  header: string
  contentBlock: DmContentBlock[]
}

interface DmImage {
  alt?: string
  src?: string
  thumbnailSrc?: string
  zoomSrc?: string
}

interface DmVariantOption {
  gtin?: number
  dan?: number
  hex?: string
  colorLabel?: string
  label?: string
  href?: string
  isSelected?: boolean
}

interface DmVariantGroup {
  heading?: string
  options?: DmVariantOption[]
}

interface DmProductDetail {
  gtin: number
  dan?: number
  brand?: { name: string }
  title?: { headline: string }
  breadcrumbs?: string[]
  rating?: { ratingValue: number; ratingCount: number }
  metadata?: { price: number; currency: string }
  price?: { infos?: string[] }
  self?: string
  descriptionGroups?: DmDescriptionGroup[]
  images?: DmImage[]
  pills?: string[]
  variants?: { colors?: DmVariantGroup[] }
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
    const res = await stealthFetch(url, { headers: DM_HEADERS })
    if (!res.ok) {
      log.info(`Content page fetch failed for ${link}: ${res.status}`)
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
    log.error(`Error fetching category ID for ${link}: ${String(error)}`)
    return null
  }
}

// DM-specific progress type for resumable discovery
interface DmProductDiscoveryProgress {
  categoryLeaves: Array<{
    link: string
    breadcrumb: string
    categoryId: string | null
  }>
  currentLeafIndex: number
  currentProductPage: number
  totalProductPages: number | null
}

// Fetch a single page of products for a category ID
async function fetchProductPage(
  categoryId: string,
  page: number,
  pageSize: number = 60,
): Promise<{ products: Array<Record<string, unknown>>; totalPages: number } | null> {
  const url = `https://product-search.services.dmtech.com/de/search/static?allCategories.id=${categoryId}&pageSize=${pageSize}&currentPage=${page}&sort=relevance&searchType=editorial-search&type=search-static`
  try {
    const res = await stealthFetch(url, { headers: getSearchHeaders() })
    if (!res.ok) {
      log.info(`Product search failed for category ${categoryId} page ${page}: ${res.status}`)
      return null
    }
    const data = await res.json()
    return {
      products: data.products ?? [],
      totalPages: data.totalPages ?? 1,
    }
  } catch (error) {
    log.error(`Error fetching products for category ${categoryId} page ${page}: ${String(error)}`)
    return null
  }
}

function jitteredDelay(baseDelay: number): number {
  const jitter = baseDelay * 0.25
  return baseDelay + Math.floor(Math.random() * jitter * 2 - jitter)
}

// Convert descriptionGroups from the product detail API into markdown
function descriptionGroupsToMarkdown(groups: DmDescriptionGroup[]): string | null {
  const sections: string[] = []
  for (const group of groups) {
    const parts: string[] = []
    for (const block of group.contentBlock) {
      if (block.bulletpoints) {
        parts.push(block.bulletpoints.map((bp) => `- ${bp}`).join('\n'))
      }
      if (block.texts) {
        parts.push(block.texts.join('\n'))
      }
      if (block.descriptionList) {
        parts.push(block.descriptionList.map((dl) => `**${dl.title}:** ${dl.description}`).join('\n'))
      }
    }
    if (parts.length > 0) {
      sections.push(`## ${group.header}\n\n${parts.join('\n\n')}`)
    }
  }
  return sections.length > 0 ? sections.join('\n\n') : null
}

// Parse product amount from price.infos, e.g. "0,055 l (271,82 € je 1 l)" → { amount: 55, unit: "ml" }
function parseProductAmount(infos?: string[]): { amount: number; unit: string } | null {
  if (!infos) return null
  for (const info of infos) {
    const match = info.match(/^([\d,]+)\s*(\w+)\s*\(/)
    if (match) {
      let amount = parseFloat(match[1].replace(',', '.'))
      let unit = match[2]
      // Normalize: 0.055 l → 55 ml, 0.25 kg → 250 g
      if (unit === 'l' && amount < 1) {
        amount = Math.round(amount * 1000)
        unit = 'ml'
      } else if (unit === 'kg' && amount < 1) {
        amount = Math.round(amount * 1000)
        unit = 'g'
      }
      return { amount, unit }
    }
  }
  return null
}

// Parse per-unit price from price.infos, e.g. "0,3 l (2,17 € je 1 l)"
function parsePerUnitPrice(infos?: string[]): { amount: number; quantity: number; unit: string } | null {
  if (!infos) return null
  for (const info of infos) {
    const match = info.match(/\(([\d,]+)\s*€\s*je\s*([\d,]*)\s*(\w+)\)/)
    if (match) {
      return {
        amount: Math.round(parseFloat(match[1].replace(',', '.')) * 100),
        quantity: match[2] ? parseFloat(match[2].replace(',', '.')) : 1,
        unit: match[3],
      }
    }
  }
  return null
}

// Extract GTIN from a DM product URL like /produkt-name-p12345.html
function extractGtinFromDmUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/-p(\d+)\.html/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export const dmDriver: SourceDriver = {
  slug: 'dm',
  label: 'DM',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.dm.de' || hostname === 'dm.de'
    } catch {
      return false
    }
  },

  async discoverProducts(
    options: ProductDiscoveryOptions,
  ): Promise<ProductDiscoveryResult> {
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages } = options
    const savedProgress = options.progress as DmProductDiscoveryProgress | undefined

    log.info(`Starting API-based discovery for ${url} (delay=${delay}ms, maxPages=${maxPages ?? 'unlimited'})`)

    let pagesUsed = 0

    // Helper to check budget
    function budgetExhausted(): boolean {
      return maxPages !== undefined && pagesUsed >= maxPages
    }

    // Step 1: Build category leaves (from progress or fresh)
    let categoryLeaves: DmProductDiscoveryProgress['categoryLeaves']
    let currentLeafIndex: number
    let currentProductPage: number
    let totalProductPages: number | null

    if (savedProgress) {
      categoryLeaves = savedProgress.categoryLeaves
      currentLeafIndex = savedProgress.currentLeafIndex
      currentProductPage = savedProgress.currentProductPage
      totalProductPages = savedProgress.totalProductPages
      log.info(`Resuming: ${categoryLeaves.length} leaves, at leaf ${currentLeafIndex}, page ${currentProductPage}`)
    } else {
      // Fresh start: build leaves from nav tree
      const targetPath = new URL(url).pathname.replace(/\/$/, '') || '/'
      log.info(`Target path: ${targetPath}`)

      const navRes = await stealthFetch('https://content.services.dmtech.com/rootpage-dm-shop-de-de?view=navigation&mrclx=true', { headers: DM_HEADERS })
      if (!navRes.ok) {
        throw new Error(`Failed to fetch navigation tree: ${navRes.status}`)
      }
      const navData = await navRes.json()
      const navRoot: NavNode | undefined = navData.navigation
      const navChildren: NavNode[] = navRoot?.children ?? []

      let subtree: NavNode | null = null
      for (const child of navChildren) {
        subtree = findSubtree(child, targetPath)
        if (subtree) break
      }

      categoryLeaves = []

      if (!subtree) {
        log.info(`No subtree in nav tree for ${targetPath}, treating as direct leaf`)
        const breadcrumb = targetPath.split('/').filter(Boolean)
          .map((seg) => seg.replace(/-und-/g, ' & ').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
          .join(' -> ')
        categoryLeaves.push({
          link: targetPath,
          breadcrumb,
          categoryId: null, // Will be resolved on first access
        })
      } else {
        log.info(`Found subtree: ${subtree.title} (${subtree.id})`)
        const leaves = collectLeaves(subtree)
        log.info(`Found ${leaves.length} leaf categories`)

        for (const leaf of leaves) {
          categoryLeaves.push({
            link: leaf.node.link,
            breadcrumb: leaf.breadcrumb,
            categoryId: null,
          })
        }
      }

      currentLeafIndex = 0
      currentProductPage = 0
      totalProductPages = null
    }

    // Step 2: Process leaves one at a time, respecting page budget
    while (currentLeafIndex < categoryLeaves.length) {
      if (budgetExhausted()) break

      const leaf = categoryLeaves[currentLeafIndex]
      const leafCategoryUrl = `https://www.dm.de${leaf.link}`

      // Resolve categoryId if not yet known (costs 1 page from budget)
      if (!leaf.categoryId) {
        const categoryId = await fetchCategoryId(leaf.link)
        if (!categoryId) {
          log.info(`No category ID found for ${leaf.link}, skipping`)
          onError?.(leafCategoryUrl)
          currentLeafIndex++
          currentProductPage = 0
          totalProductPages = null
          continue
        }
        leaf.categoryId = categoryId
        pagesUsed++
        log.info(`Resolved ${leaf.link} -> category ${categoryId}`)

        await onProgress?.({
          categoryLeaves,
          currentLeafIndex,
          currentProductPage,
          totalProductPages,
        } satisfies DmProductDiscoveryProgress)

        await sleep(jitteredDelay(delay))

        if (budgetExhausted()) break
      }

      // Fetch product pages
      const result = await fetchProductPage(leaf.categoryId, currentProductPage)
      pagesUsed++

      if (!result) {
        log.info(`Failed to fetch products for category ${leaf.categoryId} page ${currentProductPage}`)
        onError?.(leafCategoryUrl)
        currentLeafIndex++
        currentProductPage = 0
        totalProductPages = null

        await onProgress?.({
          categoryLeaves,
          currentLeafIndex,
          currentProductPage,
          totalProductPages,
        } satisfies DmProductDiscoveryProgress)

        await sleep(jitteredDelay(delay))
        continue
      }

      totalProductPages = result.totalPages
      log.info(`Category ${leaf.categoryId} page ${currentProductPage}/${totalProductPages}: ${result.products.length} products (${leaf.breadcrumb})`)

      // Emit each product via callback
      for (const product of result.products) {
        const gtin = String((product as Record<string, unknown>).gtin ?? '')
        const tileData = (product as Record<string, unknown>).tileData as Record<string, unknown> | undefined
        const productUrl = tileData?.self ? `https://www.dm.de${tileData.self}` : (gtin ? `https://www.dm.de/p${gtin}.html` : null)
        if (!productUrl) continue

        const trackingData = tileData?.trackingData as Record<string, unknown> | undefined
        const ratingData = tileData?.rating as Record<string, unknown> | undefined

        await onProduct({
          gtin: gtin || undefined,
          productUrl,
          brandName: (product as Record<string, unknown>).brandName as string | undefined,
          name: (product as Record<string, unknown>).title as string | undefined,
          price: trackingData?.price != null
            ? Math.round(Number(trackingData.price) * 100)
            : undefined,
          currency: trackingData?.currency as string | undefined,
          rating: ratingData?.ratingValue as number | undefined,
          ratingCount: ratingData?.ratingCount as number | undefined,
          category: leaf.breadcrumb,
          categoryUrl: leafCategoryUrl,
        })
      }

      currentProductPage++

      // Check if this leaf is done
      if (currentProductPage >= totalProductPages) {
        currentLeafIndex++
        currentProductPage = 0
        totalProductPages = null
      }

      await onProgress?.({
        categoryLeaves,
        currentLeafIndex,
        currentProductPage,
        totalProductPages,
      } satisfies DmProductDiscoveryProgress)

      if (!budgetExhausted()) {
        await sleep(jitteredDelay(delay))
      }
    }

    const done = currentLeafIndex >= categoryLeaves.length
    log.info(`Tick done: ${pagesUsed} pages used, done=${done}`)
    return { done, pagesUsed }
  },

  async scrapeProduct(
    sourceUrl: string,
  ): Promise<ScrapedProductData | null> {
    try {
      const warnings: string[] = []

      // Extract GTIN from URL to call DM API
      const gtin = extractGtinFromDmUrl(sourceUrl)
      if (!gtin) {
        log.info(`Could not extract GTIN from URL: ${sourceUrl}`)
        return null
      }

      // Fetch product details from DM API
      const res = await stealthFetch(`${DM_PRODUCT_API}/${gtin}`, { headers: DM_HEADERS })
      if (!res.ok) {
        log.info(`API returned ${res.status} for GTIN ${gtin}`)
        return null
      }
      const data: DmProductDetail = await res.json()

      const name = data.title?.headline
      if (!name) {
        log.info(`No product name in API response for GTIN ${gtin}`)
        return null
      }

      // Extract description as markdown
      const description = data.descriptionGroups
        ? descriptionGroupsToMarkdown(data.descriptionGroups)
        : undefined

      // Extract raw ingredients text from Inhaltsstoffe section
      let ingredientNames: string[] = []
      const ingredientsGroup = data.descriptionGroups?.find((g) => g.header === 'Inhaltsstoffe')
      if (ingredientsGroup) {
        const rawText = ingredientsGroup.contentBlock
          .flatMap((b) => b.texts || [])
          .join(' ')
          .trim()
        if (rawText) {
          log.debug(`Raw ingredients for GTIN ${gtin}: ${rawText}`)
          ingredientNames = await parseIngredients(rawText)
          log.info(`Parsed ${ingredientNames.length} ingredients`)
        }
      }

      // Parse prices and product amount
      const priceCents = data.metadata?.price != null
        ? Math.round(data.metadata.price * 100)
        : undefined
      const productAmount = parseProductAmount(data.price?.infos)
      const perUnit = parsePerUnitPrice(data.price?.infos)

      // Build canonical source URL from API response
      const canonicalUrl = data.self ? `https://www.dm.de${data.self}` : sourceUrl

      // Extract structured fields
      const sourceArticleNumber = data.dan != null ? String(data.dan) : undefined
      const labels = data.pills?.length ? data.pills : undefined
      const images =
        data.images
          ?.filter((img) => img.zoomSrc)
          .map((img) => ({
            url: img.zoomSrc!,
            alt: img.alt ?? undefined,
          })) ?? []

      const variants: ScrapedProductData['variants'] = []
      if (data.variants?.colors) {
        for (const group of data.variants.colors) {
          const options = (group.options ?? []).map((opt) => ({
            label: opt.label ?? opt.colorLabel ?? '',
            value: opt.hex ?? null,
            gtin: opt.gtin != null ? String(opt.gtin) : null,
            isSelected: opt.isSelected ?? false,
          }))
          if (options.length > 0) {
            variants.push({ dimension: group.heading ?? 'Color', options })
          }
        }
      }

      // Category breadcrumbs
      const categoryBreadcrumbs = data.breadcrumbs && data.breadcrumbs.length > 0
        ? data.breadcrumbs
        : undefined

      return {
        gtin: String(data.gtin),
        name,
        brandName: data.brand?.name ?? undefined,
        description: description ?? undefined,
        ingredientNames,
        priceCents,
        currency: data.metadata?.currency ?? 'EUR',
        priceInfos: data.price?.infos,
        amount: productAmount?.amount ?? undefined,
        amountUnit: productAmount?.unit ?? undefined,
        images,
        variants,
        labels,
        rating: data.rating?.ratingValue ?? undefined,
        ratingNum: data.rating?.ratingCount ?? undefined,
        sourceArticleNumber,
        categoryBreadcrumbs,
        canonicalUrl,
        perUnitAmount: perUnit?.amount ?? undefined,
        perUnitQuantity: perUnit?.quantity ?? undefined,
        perUnitUnit: perUnit?.unit ?? undefined,
        warnings,
      }
    } catch (error) {
      log.error(`Error scraping product (url: ${sourceUrl}): ${String(error)}`)
      return null
    }
  },
}
