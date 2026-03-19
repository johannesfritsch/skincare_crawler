/**
 * Stage 6: Embed Images
 *
 * Per variant: takes recognition image crops (from stage 5 object detection),
 * generates 8 perspective augmentations per crop (original + 7 transforms via sharp),
 * computes DINOv2-base embedding vectors (768-dim) for each, and writes them to
 * pgvector via the server's /api/embeddings/:namespace/write endpoint.
 *
 * The augmentations (rotations, flips, perspective skews) help match products
 * seen at angles in video frames against clean store product photos.
 * Augmented images are transient — generated in memory, embedded, then discarded.
 * Only the embedding vectors are stored.
 *
 * Model is selected via EMBEDDING_MODEL env var (default: 'dinov2').
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * The model is lazily loaded on first call and reused across all subsequent
 * invocations (cached in .cache/huggingface).
 */

import sharp from 'sharp'
import { computeImageEmbedding, computeImageEmbeddingFromBuffer } from '@/lib/models/clip'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

const EMBEDDING_NAMESPACE = 'recognition-images'

/**
 * Augmentation definitions. Each produces a transformed PNG buffer from the original.
 * The 'original' type uses the source URL directly (no sharp transform).
 */
const AUGMENTATIONS: Array<{
  type: string
  transform: ((img: sharp.Sharp) => sharp.Sharp) | null
}> = [
  { type: 'original', transform: null },
  { type: 'rot15', transform: (img) => img.rotate(15, { background: '#000' }) },
  { type: 'rot-15', transform: (img) => img.rotate(-15, { background: '#000' }) },
  { type: 'rot30', transform: (img) => img.rotate(30, { background: '#000' }) },
  { type: 'rot-30', transform: (img) => img.rotate(-30, { background: '#000' }) },
  { type: 'flip', transform: (img) => img.flop() },
  { type: 'skew-l', transform: (img) => img.affine([[0.9, 0.1], [0, 1]]) },
  { type: 'skew-r', transform: (img) => img.affine([[0.9, -0.1], [0, 1]]) },
]

export async function executeEmbedImages(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  let totalEmbedded = 0

  for (const v of workItem.variants) {
    // Find the product-variant for this GTIN
    const pvResult = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: v.gtin } },
      limit: 1,
    })
    if (pvResult.docs.length === 0) continue
    const pv = pvResult.docs[0] as Record<string, unknown>
    const variantId = (pv as { id: number }).id

    // Get recognition images
    const recognitionImages = pv.recognitionImages as
      | Array<{
          id: string
          image: number | { id: number; url?: string }
          score: number
        }>
      | null

    if (!recognitionImages || recognitionImages.length === 0) {
      log.info('No recognition images on variant, skipping', { gtin: v.gtin })
      continue
    }

    log.info('Computing image embeddings with augmentations', {
      gtin: v.gtin,
      crops: recognitionImages.length,
      augmentations: AUGMENTATIONS.length,
      totalEmbeddings: recognitionImages.length * AUGMENTATIONS.length,
    })

    const writeItems: Array<Record<string, unknown>> = []

    for (const ri of recognitionImages) {
      // Resolve the media URL and ID for this crop
      const imageRef = ri.image
      let mediaUrl: string | undefined
      let detectionMediaId: number

      if (typeof imageRef === 'number') {
        detectionMediaId = imageRef
        const mediaDoc = (await payload.findByID({ collection: 'detection-media', id: imageRef })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        detectionMediaId = imageRef.id
        mediaUrl = imageRef.url
      }

      if (!mediaUrl) {
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: `No media URL for recognition image ${ri.id}` })
        continue
      }

      // Construct full URL if relative
      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${payload.serverUrl}${mediaUrl}`

      // Download the image buffer once for all augmentations
      let imageBuffer: Buffer | null = null
      try {
        const response = await fetch(fullUrl)
        if (!response.ok) {
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Failed to fetch image ${ri.id}: HTTP ${response.status}` })
          continue
        }
        imageBuffer = Buffer.from(await response.arrayBuffer())
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Failed to fetch image ${ri.id}: ${msg}` })
        continue
      }

      // Generate embeddings for each augmentation
      for (const aug of AUGMENTATIONS) {
        try {
          let embedding: number[] | null

          if (!aug.transform) {
            // Original — embed from URL directly (no transform needed)
            embedding = await computeImageEmbedding(fullUrl)
          } else {
            // Apply sharp transform → PNG buffer → embed from buffer
            const augBuffer = await aug.transform(sharp(imageBuffer)).png().toBuffer()
            embedding = await computeImageEmbeddingFromBuffer(augBuffer)
          }

          if (!embedding) {
            jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Embedding returned null for ${ri.id}/${aug.type}` })
            continue
          }

          writeItems.push({
            product_variant_id: variantId,
            detection_media_id: detectionMediaId,
            augmentation_type: aug.type,
            embedding,
          })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Embedding failed for ${ri.id}/${aug.type}: ${msg}` })
        }
      }
    }

    // Batch write embeddings via the server endpoint.
    // Uses INSERT ... ON CONFLICT (product_variant_id, detection_media_id, augmentation_type) DO UPDATE
    // so embeddings are keyed by stable identifiers that survive Payload array rewrites.
    if (writeItems.length > 0) {
      try {
        const result = await payload.embeddings.write(EMBEDDING_NAMESPACE, writeItems)
        log.info('Embeddings written', { gtin: v.gtin, written: result.written })
        totalEmbedded += result.written
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Failed to write embeddings batch: ${msg}` })
      }
    }

    await ctx.heartbeat()
  }

  if (totalEmbedded > 0) {
    jlog.event('aggregation.images_embedded', {
      gtin: workItem.gtins.join(', '),
      embedded: totalEmbedded,
      skipped: 0,
    })
  }

  log.info('Embed images stage complete', { productId, embedded: totalEmbedded })
  return { success: true, productId }
}
