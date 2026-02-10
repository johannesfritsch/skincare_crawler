import type { Payload, Where } from 'payload'
import type { SourceDriver, DiscoveredProduct } from '../types'
import { parseIngredients } from '@/lib/parse-ingredients'

const DM_PRODUCT_API = 'https://products.dm.de/product/products/detail/DE/gtin'

// Match source='dm' OR source IS NULL (legacy data created before the source field existed)
const SOURCE_DM_FILTER: Where = {
  or: [
    { source: { equals: 'dm' } },
    { source: { exists: false } },
  ],
}

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

// Parse per-unit price from price.infos, e.g. "0,3 l (2,17 € je 1 l)"
function parsePerUnitPrice(infos?: string[]): { amount: number; unit: string } | null {
  if (!infos) return null
  for (const info of infos) {
    const match = info.match(/\(([\d,]+)\s*€\s*je\s*[\d,]*\s*(\w+)\)/)
    if (match) {
      return {
        amount: Math.round(parseFloat(match[1].replace(',', '.')) * 100),
        unit: match[2],
      }
    }
  }
  return null
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
    gtin: string,
    payload: Payload,
  ): Promise<number | null> {
    try {
      // Fetch product details from DM API
      const res = await fetch(`${DM_PRODUCT_API}/${gtin}`)
      if (!res.ok) {
        console.log(`[DM] API returned ${res.status} for GTIN ${gtin}`)
        return null
      }
      const data: DmProductDetail = await res.json()

      const name = data.title?.headline
      if (!name) {
        console.log(`[DM] No product name in API response for GTIN ${gtin}`)
        return null
      }

      // Extract description as markdown
      const description = data.descriptionGroups
        ? descriptionGroupsToMarkdown(data.descriptionGroups)
        : null

      // Extract raw ingredients text from Inhaltsstoffe section
      let ingredients: string[] = []
      const ingredientsGroup = data.descriptionGroups?.find((g) => g.header === 'Inhaltsstoffe')
      if (ingredientsGroup) {
        const rawText = ingredientsGroup.contentBlock
          .flatMap((b) => b.texts || [])
          .join(' ')
          .trim()
        if (rawText) {
          console.log(`[DM] Raw ingredients for GTIN ${gtin}:`, rawText)
          ingredients = await parseIngredients(rawText)
          console.log(`[DM] Parsed ${ingredients.length} ingredients`)
        }
      }

      // Parse prices
      const priceCents = data.metadata?.price != null
        ? Math.round(data.metadata.price * 100)
        : null
      const perUnit = parsePerUnitPrice(data.price?.infos)

      // Build source URL
      const sourceUrl = data.self ? `https://www.dm.de${data.self}` : null

      // Extract new structured fields
      const sourceArticleNumber = data.dan != null ? String(data.dan) : null
      const type = data.breadcrumbs?.length ? data.breadcrumbs.join(' > ') : undefined
      const labels = data.pills?.length ? data.pills.map((p) => ({ label: p })) : []
      const images =
        data.images
          ?.filter((img) => img.zoomSrc)
          .map((img) => ({
            url: img.zoomSrc!,
            alt: img.alt ?? null,
          })) ?? []

      const variants: Array<{
        dimension: string
        options: Array<{
          label: string
          value: string | null
          gtin: string | null
          isSelected: boolean
        }>
      }> = []
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

      // Find existing product
      const existing = await payload.find({
        collection: 'source-products',
        where: { and: [{ gtin: { equals: gtin } }, SOURCE_DM_FILTER] },
        limit: 1,
      })

      const now = new Date().toISOString()
      const priceEntry = {
        recordedAt: now,
        amount: priceCents,
        currency: data.metadata?.currency ?? 'EUR',
        perUnitAmount: perUnit?.amount ?? null,
        perUnitCurrency: perUnit ? 'EUR' : null,
        unit: perUnit?.unit ?? null,
      }

      const existingHistory = existing.docs.length > 0
        ? (existing.docs[0].priceHistory ?? [])
        : []

      const productPayload = {
        status: 'crawled' as const,
        sourceArticleNumber,
        brandName: data.brand?.name ?? null,
        name,
        type,
        description,
        labels,
        images,
        variants,
        priceHistory: [...existingHistory, priceEntry],
        rating: data.rating?.ratingValue ?? null,
        ratingNum: data.rating?.ratingCount ?? null,
        ingredients: ingredients.map((n: string) => ({ name: n })),
        sourceUrl,
        crawledAt: now,
      }

      let productId: number

      if (existing.docs.length > 0) {
        productId = existing.docs[0].id
        await payload.update({
          collection: 'source-products',
          id: productId,
          data: { source: 'dm', ...productPayload },
        })
      } else {
        const newProduct = await payload.create({
          collection: 'source-products',
          data: {
            gtin,
            source: 'dm',
            ...productPayload,
          },
        })
        productId = newProduct.id
      }

      console.log(`[DM] Crawled product ${gtin}: ${name} (id: ${productId})`)
      return productId
    } catch (error) {
      console.error(`[DM] Error crawling product (gtin: ${gtin}):`, error)
      return null
    }
  },

  async findUncrawledProducts(
    payload: Payload,
    options: { gtins?: string[]; limit: number },
  ): Promise<Array<{ id: number; gtin: string; sourceUrl: string | null }>> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_DM_FILTER]
    if (options.gtins && options.gtins.length > 0) {
      where.push({ gtin: { in: options.gtins.join(',') } })
    }

    const result = await payload.find({
      collection: 'source-products',
      where: { and: where },
      limit: options.limit,
    })

    console.log(`[DM] findUncrawledProducts: found ${result.docs.length} (query: gtins=${options.gtins?.join(',') ?? 'all'}, limit=${options.limit})`)

    return result.docs.map((doc) => ({
      id: doc.id,
      gtin: doc.gtin!,
      sourceUrl: doc.sourceUrl || null,
    }))
  },

  async markProductStatus(payload: Payload, productId: number, status: 'crawled' | 'failed'): Promise<void> {
    await payload.update({
      collection: 'source-products',
      id: productId,
      data: { status },
    })
  },

  async countUncrawled(payload: Payload, options?: { gtins?: string[] }): Promise<number> {
    const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_DM_FILTER]
    if (options?.gtins && options.gtins.length > 0) {
      where.push({ gtin: { in: options.gtins.join(',') } })
    }

    const result = await payload.count({
      collection: 'source-products',
      where: { and: where },
    })

    console.log(`[DM] countUncrawled: ${result.totalDocs}`)
    return result.totalDocs
  },

  async resetProducts(payload: Payload, gtins?: string[], crawledBefore?: Date): Promise<void> {
    if (gtins && gtins.length === 0) return

    const conditions: Where[] = [{ status: { in: 'crawled,failed' } }, SOURCE_DM_FILTER]
    if (gtins) {
      conditions.push({ gtin: { in: gtins.join(',') } })
    }
    if (crawledBefore) {
      conditions.push({
        or: [
          { crawledAt: { less_than: crawledBefore.toISOString() } },
          { crawledAt: { exists: false } },
        ],
      })
    }

    await payload.update({
      collection: 'source-products',
      where: conditions.length === 1 ? conditions[0] : { and: conditions },
      data: { status: 'uncrawled' },
    })
  },
}
