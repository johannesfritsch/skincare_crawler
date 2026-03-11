'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadDiscoveredUrls(
  discoveryId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const discovery = await payload.findByID({
    collection: 'product-discoveries',
    id: discoveryId,
    depth: 0,
  })

  const urls = (discovery.productUrls ?? '').trim()
  if (!urls) {
    return { success: true, data: '' }
  }

  return { success: true, data: urls }
}
