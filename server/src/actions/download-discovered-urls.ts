'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadDiscoveredUrls(
  discoveryId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const results = await payload.find({
    collection: 'discovery-results',
    where: { discovery: { equals: discoveryId } },
    limit: 50000,
    depth: 1,
  })

  const urls = results.docs
    .map((doc) => (typeof doc.sourceProduct === 'object' ? doc.sourceProduct.sourceUrl : null))
    .filter(Boolean) as string[]

  const unique = [...new Set(urls)]

  return { success: true, data: unique.join('\n') }
}
