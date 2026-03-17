/**
 * Stage 6: Embed Images
 *
 * Per variant: takes recognition image crops (from stage 5 object detection),
 * computes DINOv2-small embedding vectors (384-dim), and
 * writes them to pgvector via the server's /api/embeddings/:namespace/write
 * endpoint.
 *
 * These embeddings enable visual similarity search — given a video screenshot,
 * you can find the closest product-variant by cosine distance in the DB.
 *
 * Model is selected via EMBEDDING_MODEL env var (default: 'dinov2').
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * The model is lazily loaded on first call and reused across all subsequent
 * invocations (cached in .cache/huggingface).
 */

import { computeImageEmbedding } from '@/lib/models/clip'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

const EMBEDDING_NAMESPACE = 'recognition-images'

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

    // Get recognition images that don't have embeddings yet
    const recognitionImages = pv.recognitionImages as
      | Array<{
          id: string
          image: number | { id: number; url?: string }
          score: number
          hasEmbedding?: boolean
        }>
      | null

    if (!recognitionImages || recognitionImages.length === 0) {
      log.info('No recognition images on variant, skipping', { gtin: v.gtin })
      continue
    }

    log.info('Computing image embeddings', { gtin: v.gtin, count: recognitionImages.length })

    const writeItems: Array<{ id: string; embedding: number[] }> = []

    for (const ri of recognitionImages) {
      // Resolve the media URL for this crop
      const imageRef = ri.image
      let mediaUrl: string | undefined

      if (typeof imageRef === 'number') {
        const mediaDoc = (await payload.findByID({ collection: 'detection-media', id: imageRef })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaUrl = imageRef.url
      }

      if (!mediaUrl) {
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: `No media URL for recognition image ${ri.id}` })
        continue
      }

      // Construct full URL if relative
      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${payload.serverUrl}${mediaUrl}`

      try {
        const embedding = await computeImageEmbedding(fullUrl)
        if (!embedding) {
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Embedding returned null for recognition image ${ri.id}` })
          continue
        }
        writeItems.push({ id: ri.id, embedding })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Embedding failed for recognition image ${ri.id}: ${msg}` })
      }
    }

    // Batch write embeddings via the server endpoint
    // The embeddings write endpoint sets BOTH the vector AND has_embedding = true
    // in a single SQL UPDATE per item (see server/src/endpoints/embeddings.ts).
    // We must NOT update the recognitionImages array via Payload REST API afterwards,
    // because Payload's array handling deletes all existing rows and reinserts them
    // with new auto-generated IDs — this would orphan the pgvector embeddings that
    // were just written to the old row IDs.
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
