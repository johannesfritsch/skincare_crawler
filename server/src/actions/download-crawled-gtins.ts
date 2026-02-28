'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadCrawledGtins(
  crawlId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  // Get all source-product IDs from crawl results
  const results = await payload.find({
    collection: 'crawl-results',
    where: { crawl: { equals: crawlId } },
    limit: 50000,
    depth: 0,
  })

  const sourceProductIds = results.docs
    .map((doc) => (typeof doc.sourceProduct === 'number' ? doc.sourceProduct : null))
    .filter(Boolean) as number[]

  if (sourceProductIds.length === 0) {
    return { success: true, data: '' }
  }

  const uniqueProductIds = [...new Set(sourceProductIds)]

  // Query source-variants for GTINs belonging to these source-products
  const variants = await payload.find({
    collection: 'source-variants',
    where: {
      and: [
        { sourceProduct: { in: uniqueProductIds } },
        { gtin: { exists: true } },
      ],
    },
    limit: 50000,
    depth: 0,
  })

  const gtins = variants.docs
    .map((doc) => doc.gtin)
    .filter(Boolean) as string[]

  const unique = [...new Set(gtins)]

  return { success: true, data: unique.join('\n') }
}
