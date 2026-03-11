'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadSearchedSourceUrls(
  searchId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const search = await payload.findByID({
    collection: 'product-searches',
    id: searchId,
    depth: 0,
  })

  const urls = (search.productUrls ?? '').trim()
  if (!urls) {
    return { success: true, data: '' }
  }

  return { success: true, data: urls }
}
