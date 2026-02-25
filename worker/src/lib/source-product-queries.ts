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
 * Normalize a product URL by stripping query parameters, fragments, and trailing slashes.
 * This ensures consistent URL matching regardless of tracking params or formatting.
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

export async function findUncrawledProducts(
  payload: PayloadRestClient,
  source: SourceSlug,
  options: { sourceUrls?: string[]; limit: number },
): Promise<Array<{ id: number; sourceUrl: string; gtin?: string }>> {
  const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_FILTERS[source]]
  if (options.sourceUrls && options.sourceUrls.length > 0) {
    where.push({ sourceUrl: { in: options.sourceUrls.map(normalizeProductUrl).join(',') } })
  }

  const result = await payload.find({
    collection: 'source-products',
    where: { and: where },
    limit: options.limit,
  })

  return result.docs.map((doc) => ({
    id: (doc as Record<string, unknown>).id as number,
    sourceUrl: ((doc as Record<string, unknown>).sourceUrl as string) || '',
    gtin: ((doc as Record<string, unknown>).gtin as string) || undefined,
  }))
}

export async function countUncrawled(
  payload: PayloadRestClient,
  source: SourceSlug,
  options?: { sourceUrls?: string[] },
): Promise<number> {
  const where: Where[] = [{ status: { equals: 'uncrawled' } }, SOURCE_FILTERS[source]]
  if (options?.sourceUrls && options.sourceUrls.length > 0) {
    where.push({ sourceUrl: { in: options.sourceUrls.map(normalizeProductUrl).join(',') } })
  }

  const result = await payload.count({
    collection: 'source-products',
    where: { and: where },
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

  const conditions: Where[] = [{ status: { equals: 'crawled' } }, SOURCE_FILTERS[source]]
  if (sourceUrls) {
    conditions.push({ sourceUrl: { in: sourceUrls.map(normalizeProductUrl).join(',') } })
  }
  if (crawledBefore) {
    conditions.push({
      or: [{ updatedAt: { less_than: crawledBefore.toISOString() } }],
    })
  }

  await payload.update({
    collection: 'source-products',
    where: conditions.length === 1 ? conditions[0] : { and: conditions },
    data: { status: 'uncrawled' },
  })
}
