import type { PayloadRestClient, Where } from './payload-client'

export type SourceSlug = 'dm' | 'mueller' | 'rossmann'

const SOURCE_FILTERS: Record<SourceSlug, Where> = {
  dm: { or: [{ source: { equals: 'dm' } }, { source: { exists: false } }] },
  mueller: { source: { equals: 'mueller' } },
  rossmann: { source: { equals: 'rossmann' } },
}

const URL_MATCHERS: Array<{ slug: SourceSlug; hosts: string[] }> = [
  { slug: 'dm', hosts: ['www.dm.de', 'dm.de'] },
  { slug: 'mueller', hosts: ['www.mueller.de', 'mueller.de'] },
  { slug: 'rossmann', hosts: ['www.rossmann.de', 'rossmann.de'] },
]

/**
 * Normalize a product URL by stripping ALL query parameters, fragments, and trailing slashes.
 * Used for base source-product deduplication (the product page, not the specific variant).
 */
export function normalizeProductUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.href.replace(/\/+$/, '')
  } catch {
    // If it's not a valid URL, just strip query string and trailing slashes
    return url.split('?')[0].split('#')[0].replace(/\/+$/, '')
  }
}

/**
 * Normalize a variant URL — preserves the `itemId` query parameter for Mueller
 * (which uses it to distinguish variants), strips all other query params and fragments.
 * For DM/Rossmann where each variant has its own path, this behaves like normalizeProductUrl.
 */
export function normalizeVariantUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const itemId = parsed.searchParams.get('itemId')
    parsed.search = ''
    parsed.hash = ''
    if (itemId) {
      parsed.searchParams.set('itemId', itemId)
    }
    return parsed.href.replace(/\/+$/, '')
  } catch {
    return url.split('#')[0].replace(/\/+$/, '')
  }
}

export function getSourceSlugFromUrl(url: string): SourceSlug | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    for (const matcher of URL_MATCHERS) {
      if (matcher.hosts.includes(hostname)) return matcher.slug
    }
    return null
  } catch {
    return null
  }
}

/**
 * Find uncrawled source-variants (whose parent source-product has status=uncrawled).
 * Returns the source-variant ID + sourceUrl, plus the parent source-product ID and source.
 *
 * When `sourceProductIds` is provided, only variants for those specific source-products are returned
 * (used when crawlVariants=true to find sibling variants beyond the original URL set).
 * When `sourceUrls` is provided, only variants matching those URLs are returned.
 * Both can be combined, but typically only one is used at a time.
 */
export async function findUncrawledVariants(
  payload: PayloadRestClient,
  source: SourceSlug,
  options: { sourceUrls?: string[]; sourceProductIds?: number[]; limit: number },
): Promise<Array<{ sourceVariantId: number; sourceUrl: string; sourceProductId: number; gtin?: string }>> {
  // We need to find source-variants whose parent source-product is uncrawled + matches source.
  // Payload REST doesn't support cross-collection joins in where, so we first find
  // uncrawled source-products, then find their variants.
  const spWhere: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_FILTERS[source]]
  if (options.sourceProductIds && options.sourceProductIds.length > 0) {
    spWhere.push({ id: { in: options.sourceProductIds.join(',') } })
  }

  const spResult = await payload.find({
    collection: 'source-products',
    where: { and: spWhere },
    limit: options.limit * 3, // fetch more than needed since we filter by variant URL below
  })

  if (spResult.docs.length === 0) return []

  const spIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)

  // Find source-variants for these source-products (exclude already-crawled variants)
  const svWhere: Where[] = [
    { sourceProduct: { in: spIds.join(',') } },
    { crawledAt: { exists: false } },
  ]
  if (options.sourceUrls && options.sourceUrls.length > 0) {
    svWhere.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
  }

  const svResult = await payload.find({
    collection: 'source-variants',
    where: svWhere.length === 1 ? svWhere[0] : { and: svWhere },
    limit: options.limit,
  })

  return svResult.docs.map((doc) => {
    const sv = doc as Record<string, unknown>
    const spRef = sv.sourceProduct as number | Record<string, unknown>
    const spId = typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
    return {
      sourceVariantId: sv.id as number,
      sourceUrl: (sv.sourceUrl as string) || '',
      sourceProductId: spId,
      gtin: (sv.gtin as string) || undefined,
    }
  })
}

/**
 * Count uncrawled source-variants for a given source.
 *
 * When `sourceUrls` is provided, counts only variants matching those URLs whose parent is uncrawled.
 * When `sourceProductIds` is provided, counts uncrawled variants for those specific source-products.
 * When neither is provided, counts all uncrawled source-products for this source.
 */
export async function countUncrawled(
  payload: PayloadRestClient,
  source: SourceSlug,
  options?: { sourceUrls?: string[]; sourceProductIds?: number[] },
): Promise<number> {
  const hasUrls = options?.sourceUrls && options.sourceUrls.length > 0
  const hasProductIds = options?.sourceProductIds && options.sourceProductIds.length > 0

  if (hasUrls || hasProductIds) {
    // Scoped count: find uncrawled source-products, then count their uncrawled variants
    const spWhere: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_FILTERS[source]]
    if (hasProductIds) {
      spWhere.push({ id: { in: options!.sourceProductIds!.join(',') } })
    }

    const spResult = await payload.find({
      collection: 'source-products',
      where: { and: spWhere },
      limit: 100000,
    })
    if (spResult.docs.length === 0) return 0

    const spIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)
    const svWhere: Where[] = [
      { sourceProduct: { in: spIds.join(',') } },
      { crawledAt: { exists: false } },
    ]
    if (hasUrls) {
      svWhere.push({ sourceUrl: { in: options!.sourceUrls!.join(',') } })
    }

    const svResult = await payload.count({
      collection: 'source-variants',
      where: { and: svWhere },
    })
    return svResult.totalDocs
  }

  // Simple case: just count uncrawled source-products for this source
  const result = await payload.count({
    collection: 'source-products',
    where: { and: [{ status: { equals: 'uncrawled' } }, SOURCE_FILTERS[source]] },
  })

  return result.totalDocs
}

export async function resetProducts(
  payload: PayloadRestClient,
  source: SourceSlug,
  sourceUrls?: string[],
  crawledBefore?: Date,
): Promise<void> {
  if (sourceUrls && sourceUrls.length === 0) return

  if (sourceUrls && sourceUrls.length > 0) {
    // Find source-variants matching these URLs, then reset their parent source-products
    const svResult = await payload.find({
      collection: 'source-variants',
      where: { sourceUrl: { in: sourceUrls.join(',') } },
      limit: 100000,
    })
    if (svResult.docs.length === 0) return

    const spIds = [...new Set(svResult.docs.map((doc) => {
      const sv = doc as Record<string, unknown>
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      return typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
    }))]

    const conditions: Where[] = [
      { status: { equals: 'crawled' } },
      SOURCE_FILTERS[source],
      { id: { in: spIds.join(',') } },
    ]
    if (crawledBefore) {
      conditions.push({ updatedAt: { less_than: crawledBefore.toISOString() } })
    }

    await payload.update({
      collection: 'source-products',
      where: { and: conditions },
      data: { status: 'uncrawled' },
    })

    // Also clear crawledAt on the matching source-variants so they're eligible for re-crawling
    await payload.update({
      collection: 'source-variants',
      where: {
        and: [
          { sourceProduct: { in: spIds.join(',') } },
          { crawledAt: { exists: true } },
        ],
      },
      data: { crawledAt: null as unknown as string },
    })
  } else {
    // Reset all crawled source-products for this source
    const conditions: Where[] = [{ status: { equals: 'crawled' } }, SOURCE_FILTERS[source]]
    if (crawledBefore) {
      conditions.push({ updatedAt: { less_than: crawledBefore.toISOString() } })
    }

    // Find the source-product IDs being reset so we can clear their variant crawledAt
    const spResult = await payload.find({
      collection: 'source-products',
      where: conditions.length === 1 ? conditions[0] : { and: conditions },
      limit: 100000,
    })

    await payload.update({
      collection: 'source-products',
      where: conditions.length === 1 ? conditions[0] : { and: conditions },
      data: { status: 'uncrawled' },
    })

    // Clear crawledAt on variants of the reset source-products
    if (spResult.docs.length > 0) {
      const spIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)
      await payload.update({
        collection: 'source-variants',
        where: {
          and: [
            { sourceProduct: { in: spIds.join(',') } },
            { crawledAt: { exists: true } },
          ],
        },
        data: { crawledAt: null as unknown as string },
      })
    }
  }
}
