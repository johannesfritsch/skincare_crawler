'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

export async function downloadVariantGtins(
  sourceProductId: number,
): Promise<{ success: boolean; data?: string; error?: string }> {
  const payload = await getPayload({ config })

  const variants = await payload.find({
    collection: 'source-variants',
    where: {
      and: [
        { sourceProduct: { equals: sourceProductId } },
        { gtin: { exists: true } },
      ],
    },
    limit: 10000,
    depth: 0,
  })

  const gtins = variants.docs
    .map((doc) => doc.gtin)
    .filter(Boolean) as string[]

  const unique = [...new Set(gtins)]

  return { success: true, data: unique.join('\n') }
}
