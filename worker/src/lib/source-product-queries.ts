import type { PayloadRestClient, Where } from './payload-client'
import { getAllSourceDrivers } from './source-discovery/driver'

export type { SourceSlug } from './source-discovery/types'
import type { SourceSlug } from './source-discovery/types'

// Derive source filters and URL matchers from the driver registry — no manual slug lists needed
const SOURCE_FILTERS: Record<string, Where> = Object.fromEntries(
  getAllSourceDrivers().map((d) => [d.slug, { source: { equals: d.slug } }]),
)

const URL_MATCHERS = getAllSourceDrivers().map((d) => ({ slug: d.slug, hosts: d.hosts }))

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
 * Normalize a variant URL — preserves all query parameters (drivers include only
 * meaningful params when constructing variant URLs), strips hash fragments and
 * trailing slashes. Drivers are the source of truth for which query params matter:
 * Mueller uses `?itemId=`, PURISH uses `?variant=`, DM/Rossmann use path-based URLs.
 */
export function normalizeVariantUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
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
 * Find source-products that need crawling — they have no source-variants yet (first crawl).
 * Returns source-product ID + sourceUrl for the initial crawl pass.
 *
 * When `sourceProductIds` is provided, only those specific source-products are returned.
 * When `sourceUrls` is provided, only source-products matching those URLs are returned.
 */
export async function findUncrawledProducts(
  payload: PayloadRestClient,
  source: SourceSlug,
  options: { sourceUrls?: string[]; sourceProductIds?: number[]; limit: number },
): Promise<Array<{ sourceProductId: number; sourceUrl: string }>> {
  const spWhere: Where[] = [SOURCE_FILTERS[source]]
  if (options.sourceProductIds && options.sourceProductIds.length > 0) {
    spWhere.push({ id: { in: options.sourceProductIds.join(',') } })
  }
  if (options.sourceUrls && options.sourceUrls.length > 0) {
    spWhere.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
  }

  const spResult = await payload.find({
    collection: 'source-products',
    where: { and: spWhere },
    limit: options.limit * 3, // Over-fetch since we filter below
  })

  if (spResult.docs.length === 0) return []

  // Filter to products that have no variants yet (first crawl candidates)
  const results: Array<{ sourceProductId: number; sourceUrl: string }> = []
  for (const doc of spResult.docs) {
    const sp = doc as Record<string, unknown>
    const spId = sp.id as number
    const spUrl = sp.sourceUrl as string
    if (!spUrl) continue

    // Check if this source-product already has variants (if so, skip — use findUncrawledVariants instead)
    const variantCheck = await payload.find({
      collection: 'source-variants',
      where: { sourceProduct: { equals: spId } },
      limit: 1,
    })
    if (variantCheck.docs.length === 0) {
      results.push({ sourceProductId: spId, sourceUrl: spUrl })
    }

    if (results.length >= options.limit) break
  }

  return results
}

/**
 * Find uncrawled source-variants (where crawledAt is not set).
 * Returns the source-variant ID + sourceUrl, plus the parent source-product ID and source.
 * Used for variant crawling (after the first crawl has created variants).
 *
 * When `sourceProductIds` is provided, only variants for those specific source-products are returned
 * (used when crawlVariants=true to find sibling variants beyond the original URL set).
 */
export async function findUncrawledVariants(
  payload: PayloadRestClient,
  source: SourceSlug,
  options: { sourceProductIds?: number[]; limit: number },
): Promise<Array<{ sourceVariantId: number; sourceUrl: string; sourceProductId: number; gtin?: string }>> {
  // Find source-products for this source, then find their uncrawled variants.
  const spWhere: Where[] = [SOURCE_FILTERS[source]]
  if (options.sourceProductIds && options.sourceProductIds.length > 0) {
    spWhere.push({ id: { in: options.sourceProductIds.join(',') } })
  }

  const spResult = await payload.find({
    collection: 'source-products',
    where: { and: spWhere },
    limit: options.limit * 3,
  })

  if (spResult.docs.length === 0) return []

  const spIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)

  // Find source-variants for these source-products (exclude already-crawled variants)
  const svWhere: Where[] = [
    { sourceProduct: { in: spIds.join(',') } },
    { crawledAt: { exists: false } },
  ]

  const svResult = await payload.find({
    collection: 'source-variants',
    where: { and: svWhere },
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
 * Count items that still need crawling for a given source.
 *
 * Counts source-products that either:
 * 1. Have no source-variants at all (never been crawled), or
 * 2. Have at least one source-variant without crawledAt (partially crawled, e.g. sibling variants)
 *
 * When `sourceUrls` is provided, counts only source-products matching those URLs.
 * When `sourceProductIds` is provided, counts only those specific source-products.
 */
export async function countUncrawled(
  payload: PayloadRestClient,
  source: SourceSlug,
  options?: { sourceUrls?: string[]; sourceProductIds?: number[] },
): Promise<number> {
  const spWhere: Where[] = [SOURCE_FILTERS[source]]

  if (options?.sourceUrls && options.sourceUrls.length > 0) {
    spWhere.push({ sourceUrl: { in: options.sourceUrls.join(',') } })
  }
  if (options?.sourceProductIds && options.sourceProductIds.length > 0) {
    spWhere.push({ id: { in: options.sourceProductIds.join(',') } })
  }

  // Fetch all source-products in scope
  const spResult = await payload.find({
    collection: 'source-products',
    where: { and: spWhere },
    limit: 100000,
  })

  if (spResult.docs.length === 0) return 0

  // Count source-products that have no variants OR have uncrawled variants
  let count = 0
  for (const doc of spResult.docs) {
    const sp = doc as Record<string, unknown>
    const spId = sp.id as number

    // Check for any variants
    const allVariants = await payload.find({
      collection: 'source-variants',
      where: { sourceProduct: { equals: spId } },
      limit: 1,
    })

    if (allVariants.docs.length === 0) {
      // No variants at all — needs first crawl
      count++
      continue
    }

    // Has variants — check if any are uncrawled
    const uncrawledVariants = await payload.find({
      collection: 'source-variants',
      where: {
        and: [
          { sourceProduct: { equals: spId } },
          { crawledAt: { exists: false } },
        ],
      },
      limit: 1,
    })

    if (uncrawledVariants.docs.length > 0) {
      count++
    }
  }

  return count
}

/**
 * Reset products for re-crawling: clear crawledAt on their variants.
 * No longer changes source-product status (status field removed).
 */
export async function resetProducts(
  payload: PayloadRestClient,
  source: SourceSlug,
  sourceUrls?: string[],
  crawledBefore?: Date,
): Promise<void> {
  if (sourceUrls && sourceUrls.length === 0) return

  // Build conditions for source-products to reset
  const conditions: Where[] = [SOURCE_FILTERS[source]]

  if (sourceUrls && sourceUrls.length > 0) {
    conditions.push({ sourceUrl: { in: sourceUrls.join(',') } })
  }
  if (crawledBefore) {
    conditions.push({ updatedAt: { less_than: crawledBefore.toISOString() } })
  }

  // Find the source-product IDs being reset so we can clear their variant crawledAt
  const spResult = await payload.find({
    collection: 'source-products',
    where: { and: conditions },
    limit: 100000,
  })
  if (spResult.docs.length === 0) return

  const spIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)

  // Clear crawledAt on variants of the reset source-products so they're eligible for re-crawling
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
