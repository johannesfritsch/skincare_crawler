'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadCrawledGtins(
  crawlId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const crawl = await payload.findByID({
    collection: 'product-crawls',
    id: crawlId,
    depth: 0,
  })

  const gtins = (crawl.crawledGtins ?? '').trim()
  if (!gtins) {
    return { success: true, data: '' }
  }

  return { success: true, data: gtins }
}
