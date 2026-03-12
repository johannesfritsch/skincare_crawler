/**
 * Stage 4: Images
 *
 * Per variant: selects the best image from sources (by priority),
 * downloads it, uploads to the media collection, and sets it on
 * the product-variant.
 */

import { aggregateSourceVariantsToVariant } from '@/lib/aggregate-product'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeImages(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // Get the product name for alt text
  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
  const productName = (product.name as string) || `Product ${productId}`

  for (const v of workItem.variants) {
    const vd = aggregateSourceVariantsToVariant(v.sources, {
      imageSourcePriority: config.imageSourcePriority,
    })
    if (!vd?.selectedImageUrl) continue

    // Find the product-variant for this GTIN
    const pvResult = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: v.gtin } },
      limit: 1,
    })
    if (pvResult.docs.length === 0) continue
    const variantId = (pvResult.docs[0] as { id: number }).id

    try {
      log.info('Downloading image for variant', { gtin: v.gtin, url: vd.selectedImageUrl })
      const imageRes = await fetch(vd.selectedImageUrl)
      if (!imageRes.ok) {
        log.warn('Image download failed', { gtin: v.gtin, status: imageRes.status })
        continue
      }

      const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
      const buffer = Buffer.from(await imageRes.arrayBuffer())
      const urlPath = new URL(vd.selectedImageUrl).pathname
      const filename = urlPath.split('/').pop() || `variant-${variantId}.jpg`

      const mediaDoc = await payload.create({
        collection: 'media',
        data: { alt: vd.selectedImageAlt || productName || `Variant ${v.gtin}` },
        file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
      })
      const mediaId = (mediaDoc as { id: number }).id

      await payload.update({
        collection: 'product-variants',
        id: variantId,
        data: { images: [{ image: mediaId }] },
      })

      jlog.event('aggregation.image_uploaded', { mediaId })
      log.info('Image uploaded for variant', { gtin: v.gtin, mediaId })
    } catch (error) {
      log.warn('Image upload failed', { gtin: v.gtin, error: error instanceof Error ? error.message : String(error) })
    }

    await ctx.heartbeat()
  }

  log.info('Images stage complete', { productId })
  return { success: true, productId }
}
