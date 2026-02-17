'use server'

import config from '@payload-config'
import { getPayload } from 'payload'

const DEFAULT_PRODUCT_TYPES = [
  { slug: 'cleanser', name: 'Cleanser', nameDE: 'Reinigung' },
  { slug: 'toner', name: 'Toner', nameDE: 'Gesichtswasser' },
  { slug: 'moisturizer', name: 'Moisturizer', nameDE: 'Feuchtigkeitspflege' },
  { slug: 'sunCream', name: 'Sun Cream', nameDE: 'Sonnencreme' },
  { slug: 'peeling', name: 'Peeling', nameDE: 'Peeling' },
  { slug: 'treatment', name: 'Treatment', nameDE: 'Behandlung' },
  { slug: 'mask', name: 'Mask', nameDE: 'Maske' },
  { slug: 'eyeCream', name: 'Eye Cream', nameDE: 'Augencreme' },
  { slug: 'lipcare', name: 'Lip Care', nameDE: 'Lippenpflege' },
  { slug: 'serum', name: 'Serum', nameDE: 'Serum' },
  { slug: 'eyelashSerum', name: 'Eyelash Serum', nameDE: 'Wimpernserum' },
  { slug: 'other', name: 'Other', nameDE: 'Sonstiges' },
]

export async function seedProductTypes(): Promise<{ success: boolean; message: string; created: number }> {
  const payload = await getPayload({ config })

  const existing = await payload.count({ collection: 'product-types' })
  if (existing.totalDocs > 0) {
    return { success: true, message: 'Product types already seeded', created: 0 }
  }

  for (const pt of DEFAULT_PRODUCT_TYPES) {
    await payload.create({
      collection: 'product-types',
      data: pt,
    })
  }

  return { success: true, message: `Created ${DEFAULT_PRODUCT_TYPES.length} product types`, created: DEFAULT_PRODUCT_TYPES.length }
}
