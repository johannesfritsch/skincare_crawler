'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function crawlSourceProduct(
  sourceProductId: number,
): Promise<{ success: boolean; crawlId?: number; error?: string }> {
  const payload = await getPayload({ config })

  const sourceProduct = await payload.findByID({
    collection: 'source-products',
    id: sourceProductId,
  })

  if (!sourceProduct.sourceUrl) {
    return { success: false, error: 'Source product has no URL' }
  }

  if (!sourceProduct.source) {
    return { success: false, error: 'Source product has no source' }
  }

  const crawl = await payload.create({
    collection: 'product-crawls',
    data: {
      source: sourceProduct.source,
      type: 'selected_urls',
      urls: sourceProduct.sourceUrl,
      scope: 'recrawl',
      status: 'pending',
    },
  })

  return { success: true, crawlId: crawl.id }
}
