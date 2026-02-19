'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadCrawledGtins(
  crawlId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const sourceProducts = await payload.find({
    collection: 'source-products',
    where: { productCrawl: { equals: crawlId } },
    limit: 50000,
    select: { gtin: true },
  })

  const gtins = sourceProducts.docs
    .map((doc) => doc.gtin)
    .filter(Boolean) as string[]

  const unique = [...new Set(gtins)]

  return { success: true, data: unique.join('\n') }
}
