'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadDiscoveredUrls(
  discoveryId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  // Get all source-product IDs from discovery results
  const results = await payload.find({
    collection: 'discovery-results',
    where: { discovery: { equals: discoveryId } },
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

  // Query source-variants for URLs belonging to these source-products
  const variants = await payload.find({
    collection: 'source-variants',
    where: { sourceProduct: { in: uniqueProductIds } },
    limit: 50000,
    depth: 0,
  })

  const urls = variants.docs
    .map((doc) => doc.sourceUrl)
    .filter(Boolean) as string[]

  const unique = [...new Set(urls)]

  return { success: true, data: unique.join('\n') }
}
