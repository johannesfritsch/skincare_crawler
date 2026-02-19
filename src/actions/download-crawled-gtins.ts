'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadCrawledGtins(
  crawlId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const results = await payload.find({
    collection: 'crawl-results',
    where: { crawl: { equals: crawlId } },
    limit: 50000,
    depth: 1,
  })

  const gtins = results.docs
    .map((doc) => (typeof doc.sourceProduct === 'object' ? doc.sourceProduct.gtin : null))
    .filter(Boolean) as string[]

  const unique = [...new Set(gtins)]

  return { success: true, data: unique.join('\n') }
}
