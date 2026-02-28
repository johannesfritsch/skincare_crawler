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

  if (!sourceProduct.source) {
    return { success: false, error: 'Source product has no source' }
  }

  // Get the default source-variant's URL
  const variants = await payload.find({
    collection: 'source-variants',
    where: {
      and: [
        { sourceProduct: { equals: sourceProductId } },
        { isDefault: { equals: true } },
      ],
    },
    limit: 1,
    depth: 0,
  })

  const defaultVariant = variants.docs[0]
  if (!defaultVariant?.sourceUrl) {
    return { success: false, error: 'Source product has no variant with a URL' }
  }

  const crawl = await payload.create({
    collection: 'product-crawls',
    data: {
      source: sourceProduct.source,
      type: 'selected_urls',
      urls: defaultVariant.sourceUrl,
      scope: 'recrawl',
      status: 'pending',
    },
  })

  return { success: true, crawlId: crawl.id }
}
