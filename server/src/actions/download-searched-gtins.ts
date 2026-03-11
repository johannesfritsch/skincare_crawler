'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadSearchedSourceUrls(
  searchId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  // Get all source-product IDs from search results (depth 1 to populate sourceProduct)
  const results = await payload.find({
    collection: 'search-results',
    where: { search: { equals: searchId } },
    limit: 50000,
    depth: 1,
  })

  const sourceUrls = results.docs
    .map((doc) => {
      const sp = doc.sourceProduct
      if (typeof sp === 'object' && sp !== null && 'sourceUrl' in sp) {
        return sp.sourceUrl as string
      }
      return null
    })
    .filter(Boolean) as string[]

  const unique = [...new Set(sourceUrls)]

  return { success: true, data: unique.join('\n') }
}
