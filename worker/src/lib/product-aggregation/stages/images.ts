/**
 * Stage 4: Images
 *
 * Per variant: collects ALL images from all source-variants (across all stores),
 * downloads each, uploads to product-media, and sets them on the product-variant.
 *
 * The "best" image (selected by imageSourcePriority) is marked visibility: 'public'
 * and placed first in the array. All other images are marked visibility: 'recognition_only' —
 * they are not shown in the frontend but are used for object detection + CLIP embedding,
 * giving the video search pipeline a much richer reference database to match against.
 *
 * Each image entry tracks which store it came from via the `source` field.
 */

import { aggregateSourceVariantsToVariant, type SourceImage } from '@/lib/aggregate-product'
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
    if (!vd || vd.allImages.length === 0) continue

    // Find the product-variant for this GTIN
    const pvResult = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: v.gtin } },
      limit: 1,
    })
    if (pvResult.docs.length === 0) continue
    const variantId = (pvResult.docs[0] as { id: number }).id

    // Determine which URL is the "public" one (the best by priority)
    const publicUrl = vd.selectedImageUrl ?? null

    const imageEntries: Array<{ image: number; visibility: string; source: string }>  = []
    let publicEntry: { image: number; visibility: string; source: string } | null = null
    let downloaded = 0
    let failed = 0

    for (const srcImg of vd.allImages) {
      try {
        const imageRes = await fetch(srcImg.url)
        if (!imageRes.ok) {
          failed++
          log.debug('Image download failed', { url: srcImg.url, status: imageRes.status })
          continue
        }

        const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
        const buffer = Buffer.from(await imageRes.arrayBuffer())
        const urlPath = new URL(srcImg.url).pathname
        const filename = urlPath.split('/').pop() || `variant-${variantId}-${downloaded}.jpg`

        const mediaDoc = await payload.create({
          collection: 'product-media',
          data: { alt: srcImg.alt || productName || `Variant ${v.gtin}` },
          file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
        })
        const mediaId = (mediaDoc as { id: number }).id

        const isPublic = srcImg.url === publicUrl
        const entry = {
          image: mediaId,
          visibility: isPublic ? 'public' : 'recognition_only',
          source: srcImg.source,
        }

        if (isPublic) {
          publicEntry = entry
        } else {
          imageEntries.push(entry)
        }

        downloaded++
      } catch (error) {
        failed++
        log.debug('Image download error', { url: srcImg.url, error: error instanceof Error ? error.message : String(error) })
      }
    }

    // Assemble final array: public image first, then recognition-only images
    const finalImages = publicEntry ? [publicEntry, ...imageEntries] : imageEntries

    if (finalImages.length > 0) {
      await payload.update({
        collection: 'product-variants',
        id: variantId,
        data: { images: finalImages },
      })

      jlog.event('aggregation.image_uploaded', {
        gtin: v.gtin,
        total: finalImages.length,
        public: publicEntry ? 1 : 0,
        recognitionOnly: finalImages.length - (publicEntry ? 1 : 0),
        failed,
      })
      log.info('Images uploaded for variant', { gtin: v.gtin, total: finalImages.length, failed })
    } else {
      jlog.event('aggregation.warning', { gtin: v.gtin, warning: `All ${vd.allImages.length} image downloads failed` })
    }

    await ctx.heartbeat()
  }

  log.info('Images stage complete', { productId })
  return { success: true, productId }
}
