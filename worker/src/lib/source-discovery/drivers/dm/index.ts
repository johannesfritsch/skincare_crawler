import type { SourceDriver, ProductDiscoveryOptions, ProductDiscoveryResult, ProductSearchOptions, ProductSearchResult, ScrapedProductData } from '../../types'
import { stealthFetch } from '@/lib/stealth-fetch'
import { launchBrowser } from '@/lib/browser'

import { normalizeProductUrl } from '@/lib/source-product-queries'
import { createLogger } from '@/lib/logger'

const log = createLogger('DM')

const DM_PRODUCT_API = 'https://products.dm.de/product/products/detail/DE/gtin'
const DM_PRODUCT_API_DAN = 'https://products.dm.de/product/products/detail/DE/dan'
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
  brand?: { name: string; image?: { alt?: string; src?: string } }
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
      log.info('Content page fetch failed', { link, status: res.status })
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
    log.error('Error fetching category ID', { link, error: String(error) })
    return null
  }
}

// DM availability API response shape
// GET https://products.dm.de/availability/api/v1/tiles/DE/{dan1},{dan2},...
// Returns an object keyed by DAN string
interface DmAvailabilityEntry {
  isPurchasable: boolean
  rows?: Array<{ icon: string; text: string }>
}

type DmAvailabilityResponse = Record<string, DmAvailabilityEntry>

const DM_AVAILABILITY_API = 'https://products.dm.de/availability/api/v1/tiles/DE'

// Fetch availability for a batch of DANs. Returns a map from DAN → 'available' | 'unavailable'.
// On failure, returns an empty map (availability stays 'unknown').
async function fetchAvailability(dans: string[]): Promise<Map<string, 'available' | 'unavailable'>> {
  const result = new Map<string, 'available' | 'unavailable'>()
  if (dans.length === 0) return result

  try {
    const url = `${DM_AVAILABILITY_API}/${dans.join(',')}`
    const res = await stealthFetch(url, { headers: DM_HEADERS })
    if (!res.ok) {
      log.info('Availability API returned error', { status: res.status, dans: dans.length })
      return result
    }
    const data: DmAvailabilityResponse = await res.json()
    for (const [dan, entry] of Object.entries(data)) {
      result.set(dan, entry.isPurchasable ? 'available' : 'unavailable')
    }
  } catch (error) {
    log.error('Error fetching availability', { dans: dans.length, error: String(error) })
  }
  return result
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
      log.info('Product search failed', { categoryId, page, status: res.status })
      return null
    }
    const data = await res.json()
    return {
      products: data.products ?? [],
      totalPages: data.totalPages ?? 1,
    }
  } catch (error) {
    log.error('Error fetching products', { categoryId, page, error: String(error) })
    return null
  }
}

// Fetch a single page of text search results
async function fetchSearchPage(
  query: string,
  page: number,
  pageSize: number = 60,
): Promise<{ products: Array<Record<string, unknown>>; totalPages: number } | null> {
  const url = `https://product-search.services.dmtech.com/de/search?query=${encodeURIComponent(query)}&pageSize=${pageSize}&currentPage=${page}&sort=relevance&searchType=search`
  try {
    const res = await stealthFetch(url, { headers: getSearchHeaders() })
    if (!res.ok) {
      log.info('Product search failed', { query, page, status: res.status })
      return null
    }
    const data = await res.json()
    return {
      products: data.products ?? [],
      totalPages: data.totalPages ?? 1,
    }
  } catch (error) {
    log.error('Error searching products', { query, page, error: String(error) })
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

// Extract GTIN from a DM product URL like /produkt-name-p12345.html (legacy format)
function extractGtinFromDmUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/-p(\d+)\.html/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// Extract DAN from a DM product URL like /p/d/3124768/product-slug (new format)
function extractDanFromDmUrl(url: string): string | null {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.match(/\/p\/d\/(\d+)\//)
    return match ? match[1] : null
  } catch {
    return null
  }
}

// BazaarVoice review API for DM
const BV_API = 'https://apps.bazaarvoice.com/bfd/v1/clients/dm-de/api-products/cv2/resources/data/reviews.json'
const BV_TOKEN = '18357,main_site,de_DE'

interface BvReview {
  Id: string
  Rating: number
  Title?: string
  ReviewText?: string
  UserNickname?: string
  SubmissionTime?: string
  IsRecommended?: boolean | null
  TotalPositiveFeedbackCount?: number
  TotalNegativeFeedbackCount?: number
  ContextDataValues?: Record<string, { Value?: string }>
  SyndicationSource?: { Name?: string } | null
}

export async function fetchDmReviews(dan: string, logger?: import('@/lib/logger').Logger): Promise<ScrapedProductData['reviews']> {
  const PAGE_SIZE = 100
  const allReviews: NonNullable<ScrapedProductData['reviews']> = []

  try {
    let offset = 0
    let totalResults = Infinity

    while (offset < totalResults) {
      const params = new URLSearchParams({
        'apiVersion': '5.4',
        'filter': `productid:eq:${dan}`,
        'limit': String(PAGE_SIZE),
        'offset': String(offset),
        'sort': 'submissiontime:desc',
      })
      const url = `${BV_API}?${params.toString()}`
      const res = await stealthFetch(url, {
        headers: {
          'bv-bfd-token': BV_TOKEN,
          'Origin': 'https://www.dm.de',
          'Referer': 'https://www.dm.de/',
        },
      })
      if (!res.ok) {
        log.info('BazaarVoice API returned error', { status: res.status, dan, offset })
        break
      }
      const data = await res.json()
      const response = data?.response ?? data
      totalResults = response?.TotalResults ?? 0
      const results: BvReview[] = response?.Results ?? []

      if (results.length === 0) break

      for (const r of results) {
        allReviews.push({
          externalId: r.Id,
          rating: r.Rating * 2, // Normalize 1-5 stars to 0-10 scale
          title: r.Title ?? undefined,
          reviewText: r.ReviewText ?? undefined,
          userNickname: r.UserNickname ?? undefined,
          submittedAt: r.SubmissionTime ?? undefined,
          isRecommended: r.IsRecommended ?? null,
          positiveFeedbackCount: r.TotalPositiveFeedbackCount ?? 0,
          negativeFeedbackCount: r.TotalNegativeFeedbackCount ?? 0,
          reviewerAge: r.ContextDataValues?.Age?.Value ?? undefined,
          reviewerGender: r.ContextDataValues?.Gender?.Value ?? undefined,
          reviewSource: r.SyndicationSource?.Name ?? undefined,
        })
      }

      offset += results.length

      if (offset < totalResults) {
        await sleep(jitteredDelay(500))
      }
    }
  } catch (error) {
    log.info('Failed to fetch reviews from BazaarVoice', { dan, fetched: allReviews.length, error: String(error) })
  }

  return allReviews
}

export const dmDriver: SourceDriver = {
  slug: 'dm',
  label: 'DM',
  hosts: ['www.dm.de', 'dm.de'],
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3 -3 163.5 108.2"><path d="m151.8 79.2c-6.9 4.7-20.8 10.7-42.2 5.3-2-.5-4-1.1-5.9-1.6-13.5-5.8-27.2-12.2-32.8-16.3 15.5 2.4 38.7 4.8 76.1-1.2 0 0 3.6 5.6 4.8 13.8m-145.3 3.8-6.5 2.3c0 0 7.4 8.9 8.8 11.8l1.8 5c0 0 23.6-13 58-11 7.8.4 14.6 2.7 14.6 2.7 0 0-14-9.1-16.8-10-13.5-3.4-26.3-4.3-33.9-4.6-13 3.5-24.1 9.4-24.1 9.4 0 0-.9-2.8-1.9-5.6" fill="#dd291e"/><path d="m157.1 74.8c0 0-1.7 2-5.3 4.4-6.9 4.7-20.8 10.7-42.2 5.3-2-.5-4-1.1-5.9-1.6-19.5-5.7-31.1-13.1-57.3-16.4-17.8.4-35.7 2.5-45.6 6.4 0 0 2.7 2.8 3.5 3.9.4.8 1.3 3.5 2.2 6.1 1 2.8 1.9 5.5 1.9 5.5 0 0 11.1-5.9 24.1-9.4 6.1-1.6 12.6-2.7 18.6-2.4 20 1.3 36.1 11.6 54 20 12.4 3.5 42.7 6.1 51.2 2.2 0 .2 1.7-8 .8-24" fill="#ffc82e"/><path d="m53.2 29.4c-8.1 0-12.8 11.3-12.8 19.3 0 3.3.8 4.8 2.6 4.8 4.6 0 12.3-13.2 13.9-21.4l.4-2.1c-1.2-.3-2.5-.6-4.1-.6m9.5 34h-11.8c.5-3.1 1.5-6.6 3.2-11.1h-.2c-3.7 6.2-9 12.2-15.7 12.2-6.8 0-10.3-4.4-10.3-13.7 0-16.3 8.5-31.2 27.4-31.2 1 0 2.1.1 3.7.3l1.9-10c-1.9-.3-4.8-.7-7.3-.9l1.7-8.1c6-.6 12.2-1 19.3-.8l-12 63.3zm71.1 0h-11.7l4.2-26.4c.9-4.3.3-6-1.7-6-4 0-11.2 10.5-12.8 20.9l-1.9 11.5h-11.7l4.4-26.4c.9-4.3.3-6-1.7-6-4 0-11 10.4-12.9 20.6l-2.3 11.8h-11.7l6.3-33.2v-.3c-1.9-.3-4.8-.7-7.3-.9l1.7-8.1c6.2-.7 12.1-1 18.6-.8-.7 3.4-1.8 7.3-3.3 11.1h.2c3.9-6.7 8.1-11.8 15.7-11.8 5.1 0 8.4 2.7 8.4 8.5 0 1-.3 2.2-.7 3.9h.1c4-7.2 8.8-12.5 16.4-12.5 8.4 0 10.1 6.1 8.5 14.1l-4.8 29.9z" fill="#002878"/></svg>',

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
    const { url, onProduct, onError, onProgress, delay = 2000, maxPages, logger } = options
    const savedProgress = options.progress as DmProductDiscoveryProgress | undefined

    log.info('Starting API-based discovery', { url, delay, maxPages: maxPages ?? 'unlimited' })

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
      log.info('Resuming discovery', { leaves: categoryLeaves.length, currentLeafIndex, currentProductPage })
    } else {
      // Fresh start: build leaves from nav tree
      const targetPath = new URL(url).pathname.replace(/\/$/, '') || '/'
      log.info('Target path resolved', { targetPath })

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
        log.info('No subtree in nav tree, treating as direct leaf', { targetPath })
        const breadcrumb = targetPath.split('/').filter(Boolean)
          .map((seg) => seg.replace(/-und-/g, ' & ').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
          .join(' -> ')
        categoryLeaves.push({
          link: targetPath,
          breadcrumb,
          categoryId: null, // Will be resolved on first access
        })
      } else {
        log.info('Found subtree', { title: subtree.title, id: subtree.id })
        const leaves = collectLeaves(subtree)
        log.info('Found leaf categories', { count: leaves.length })

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
          log.info('No category ID found, skipping', { link: leaf.link })
          onError?.(leafCategoryUrl)
          currentLeafIndex++
          currentProductPage = 0
          totalProductPages = null
          continue
        }
        leaf.categoryId = categoryId
        pagesUsed++
        log.info('Resolved category ID', { link: leaf.link, categoryId })

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
        log.info('Failed to fetch products', { categoryId: leaf.categoryId, page: currentProductPage })
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
      log.info('Fetched category products', { categoryId: leaf.categoryId, page: currentProductPage, totalPages: totalProductPages, products: result.products.length, breadcrumb: leaf.breadcrumb })
      logger?.event('discovery.page_scraped', { source: 'dm', page: currentProductPage, products: result.products.length })

      // Emit each product via callback
      for (const product of result.products) {
        const gtin = String((product as Record<string, unknown>).gtin ?? '')
        const tileData = (product as Record<string, unknown>).tileData as Record<string, unknown> | undefined
        const productUrl = tileData?.self ? normalizeProductUrl(`https://www.dm.de${tileData.self}`) : (gtin ? normalizeProductUrl(`https://www.dm.de/p${gtin}.html`) : null)
        if (!productUrl) continue

        const ratingData = tileData?.rating as Record<string, unknown> | undefined

        await onProduct({
          gtin: gtin || undefined,
          productUrl,
          brandName: (product as Record<string, unknown>).brandName as string | undefined,
          name: (product as Record<string, unknown>).title as string | undefined,
          rating: (ratingData?.ratingValue as number | undefined) || undefined,
          ratingCount: (ratingData?.ratingCount as number | undefined) || undefined,
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
    log.info('Tick done', { pagesUsed, done })
    return { done, pagesUsed }
  },

  async searchProducts(
    options: ProductSearchOptions,
  ): Promise<ProductSearchResult> {
    const { query, maxResults = 50, logger } = options
    const products: import('../../types').DiscoveredProduct[] = []
    const pageSize = 60
    let currentPage = 0
    const maxPages = Math.ceil(maxResults / pageSize)

    log.info('Searching DM', { query, maxResults })

    while (currentPage < maxPages && products.length < maxResults) {
      const result = await fetchSearchPage(query, currentPage, pageSize)
      if (!result || result.products.length === 0) break

      for (const product of result.products) {
        if (products.length >= maxResults) break

        const gtin = String((product as Record<string, unknown>).gtin ?? '')
        const tileData = (product as Record<string, unknown>).tileData as Record<string, unknown> | undefined
        const productUrl = tileData?.self ? normalizeProductUrl(`https://www.dm.de${tileData.self}`) : (gtin ? normalizeProductUrl(`https://www.dm.de/p${gtin}.html`) : null)
        if (!productUrl) continue

        const ratingData = tileData?.rating as Record<string, unknown> | undefined

        products.push({
          gtin: gtin || undefined,
          productUrl,
          brandName: (product as Record<string, unknown>).brandName as string | undefined,
          name: (product as Record<string, unknown>).title as string | undefined,
          rating: (ratingData?.ratingValue as number | undefined) || undefined,
          ratingCount: (ratingData?.ratingCount as number | undefined) || undefined,
        })
      }

      currentPage++
      if (currentPage >= result.totalPages) break
    }

    log.info('DM search complete', { query, found: products.length })
    logger?.event('search.source_complete', { source: 'dm', query, results: products.length })
    return { products }
  },

  async scrapeProduct(
    sourceUrl: string,
    options?: {
      debug?: boolean
      logger?: import('@/lib/logger').Logger
      skipReviews?: boolean
      debugContext?: {
        client: import('@/lib/payload-client').PayloadRestClient
        jobCollection: 'product-crawls' | 'product-discoveries' | 'product-searches'
        jobId: number
      }
    },
  ): Promise<ScrapedProductData | null> {
    const logger = options?.logger
    const debugCtx = options?.debug ? options.debugContext : undefined
    try {
      const scrapeStartMs = Date.now()
      const warnings: string[] = []
      logger?.event('scraper.started', { url: sourceUrl, source: 'dm' })

      // Extract GTIN or DAN from URL to call DM API
      let apiUrl: string
      const gtin = extractGtinFromDmUrl(sourceUrl)
      if (gtin) {
        apiUrl = `${DM_PRODUCT_API}/${gtin}`
      } else {
        const dan = extractDanFromDmUrl(sourceUrl)
        if (dan) {
          apiUrl = `${DM_PRODUCT_API_DAN}/${dan}`
        } else {
          log.info('Could not extract GTIN or DAN from URL', { sourceUrl })
          logger?.event('scraper.failed', { url: sourceUrl, source: 'dm', error: 'No GTIN or DAN in URL', reason: 'no_gtin' })
          return null
        }
      }

      // Fetch product details from DM API
      const res = await stealthFetch(apiUrl, { headers: DM_HEADERS })
      if (!res.ok) {
        log.info('API returned error', { status: res.status, gtin })
        logger?.event('scraper.failed', { url: sourceUrl, source: 'dm', error: 'API error', status: res.status })
        return null
      }
      const data: DmProductDetail = await res.json()

      const name = data.title?.headline
      if (!name) {
        log.info('No product name in API response', { gtin })
        logger?.event('scraper.failed', { url: sourceUrl, source: 'dm', error: 'No product name', reason: 'no_name' })
        return null
      }

      // Extract description as markdown
      const description = data.descriptionGroups
        ? descriptionGroupsToMarkdown(data.descriptionGroups)
        : undefined

      // Extract raw ingredients text from Inhaltsstoffe section (stored as-is, parsed during aggregation)
      let ingredientsText: string | undefined
      const ingredientsGroup = data.descriptionGroups?.find((g) => g.header === 'Inhaltsstoffe')
      if (ingredientsGroup) {
        const rawText = ingredientsGroup.contentBlock
          .flatMap((b) => b.texts || [])
          .join(' ')
          .trim()
        if (rawText) {
          ingredientsText = rawText
          log.info('Found ingredients text', { chars: rawText.length })
        }
      }

      // Parse prices and product amount
      const priceCents = data.metadata?.price != null
        ? Math.round(data.metadata.price * 100)
        : undefined
      const productAmount = parseProductAmount(data.price?.infos)
      const perUnit = parsePerUnitPrice(data.price?.infos)

      // Build canonical source URL from API response
      const canonicalUrl = normalizeProductUrl(data.self ? `https://www.dm.de${data.self}` : sourceUrl)

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

      // Build variants and collect DANs for availability lookup
      // danToVariantPath maps DAN → index path into variants array for later availability assignment
      const variants: ScrapedProductData['variants'] = []
      const danToVariantPath: Array<{ dan: string; groupIdx: number; optIdx: number }> = []

      if (data.variants?.colors) {
        for (const group of data.variants.colors) {
          const groupIdx = variants.length
          const options = (group.options ?? []).map((opt, optIdx) => {
            if (opt.dan != null) {
              danToVariantPath.push({ dan: String(opt.dan), groupIdx, optIdx })
            }
            return {
              label: opt.label ?? opt.colorLabel ?? '',
              value: opt.href ? normalizeProductUrl(`https://www.dm.de${opt.href}`) : null,
              gtin: opt.gtin != null ? String(opt.gtin) : null,
              isSelected: opt.isSelected ?? false,
              sourceArticleNumber: opt.dan != null ? String(opt.dan) : null,
            }
          })
          if (options.length > 0) {
            variants.push({ dimension: group.heading ?? 'Color', options })
          }
        }
      }

      // Fetch availability for the product and all its variants
      const allDans: string[] = []
      const productDan = data.dan != null ? String(data.dan) : null
      if (productDan) allDans.push(productDan)
      for (const entry of danToVariantPath) {
        if (!allDans.includes(entry.dan)) allDans.push(entry.dan)
      }

      const availabilityMap = await fetchAvailability(allDans)
      log.info('Fetched availability', { dans: allDans.length, available: [...availabilityMap.values()].filter((v) => v === 'available').length })

      // Set availability on the top-level product
      const productAvailability = productDan ? (availabilityMap.get(productDan) ?? undefined) : undefined

      // Set availability on each variant option
      for (const entry of danToVariantPath) {
        const avail = availabilityMap.get(entry.dan)
        if (avail && variants[entry.groupIdx]?.options[entry.optIdx]) {
          variants[entry.groupIdx].options[entry.optIdx].availability = avail
        }
      }

      // Extract brand URL from the rendered product page via Playwright.
      // The brand link is in the first <span> inside the <h1>:
      //   <h1 data-dmid="detail-page-headline-product-title">
      //     <span><a href="/search?query=...&searchType=brand-search">BrandName</a></span>
      //     Product Title
      //   </h1>
      let brandUrl: string | undefined
      try {
        const browser = await launchBrowser()
        try {
          const page = await browser.newPage()
          // DM is an SPA — navigate and wait for the brand link to render
          await page.goto(canonicalUrl, { waitUntil: 'commit', timeout: 30000 })
          await page.waitForSelector('h1[data-dmid="detail-page-headline-product-title"] a', { timeout: 30000 }).catch(() => {})

          // Capture debug screenshot after page renders
          if (debugCtx) {
            const { captureDebugScreenshot } = await import('@/lib/debug-screenshot')
            await captureDebugScreenshot({
              page, client: debugCtx.client, jobCollection: debugCtx.jobCollection,
              jobId: debugCtx.jobId, step: 'brand_url_extraction', label: `Brand URL — ${canonicalUrl}`,
            })
          }

          const brandHref = await page.$eval(
            'h1[data-dmid="detail-page-headline-product-title"] span:first-child a[href]',
            (a) => a.getAttribute('href'),
          ).catch(() => null)

          if (brandHref) {
            brandUrl = `https://www.dm.de${brandHref}`
            log.info('Extracted brand URL', { brandUrl })
            logger?.event('scraper.brand_url_extracted', { url: sourceUrl, source: 'dm', brandUrl })
          } else {
            log.info('No brand link found in rendered page', { url: canonicalUrl })
            logger?.event('scraper.brand_url_missing', { url: sourceUrl, source: 'dm', reason: 'selector_not_found' })
          }
        } finally {
          await browser.close()
        }
      } catch (e) {
        log.error('Could not extract brand URL via browser', { url: canonicalUrl, error: String(e) })
        logger?.event('scraper.browser_error', { url: sourceUrl, source: 'dm', error: String(e) })
      }

      // Brand image from API
      const brandImageUrl = data.brand?.image?.src

      // Category breadcrumbs
      const categoryBreadcrumbs = data.breadcrumbs && data.breadcrumbs.length > 0
        ? data.breadcrumbs
        : undefined

      // Fetch reviews from BazaarVoice (skip if requested)
      const reviews = (!options?.skipReviews && sourceArticleNumber) ? (await fetchDmReviews(sourceArticleNumber, logger)) ?? [] : []
      if (reviews.length > 0) {
        log.info('Fetched reviews', { dan: sourceArticleNumber, count: reviews.length })
      }

      const scrapeDurationMs = Date.now() - scrapeStartMs
      logger?.event('scraper.product_scraped', { url: sourceUrl, source: 'dm', name, variants: variants.length, durationMs: scrapeDurationMs, images: images.length, hasIngredients: !!ingredientsText })

      return {
        gtin: String(data.gtin),
        name,
        brandName: data.brand?.name ?? undefined,
        brandUrl,
        brandImageUrl,
        description: description ?? undefined,
        ingredientsText,
        priceCents,
        currency: data.metadata?.currency ?? 'EUR',
        priceInfos: data.price?.infos,
        amount: productAmount?.amount ?? undefined,
        amountUnit: productAmount?.unit ?? undefined,
        images,
        variants,
        labels,
        rating: data.rating?.ratingValue || undefined,
        ratingCount: data.rating?.ratingCount || undefined,
        sourceArticleNumber,
        categoryBreadcrumbs,
        canonicalUrl,
        perUnitAmount: perUnit?.amount ?? undefined,
        perUnitQuantity: perUnit?.quantity ?? undefined,
        perUnitUnit: perUnit?.unit ?? undefined,
        availability: productAvailability,
        warnings,
        reviews,
      }
    } catch (error) {
      log.error('Error scraping product', { url: sourceUrl, error: String(error) })
      logger?.event('scraper.failed', { url: sourceUrl, source: 'dm', error: String(error) })
      return null
    }
  },
}
