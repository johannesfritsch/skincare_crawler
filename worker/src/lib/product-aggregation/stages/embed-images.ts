/**
 * Stage 6: Embed Images
 *
 * Per variant: takes recognition image crops (from stage 5 object detection),
 * computes CLIP ViT-B/32 embedding vectors (512-dim), and writes them to
 * pgvector via the server's /api/embeddings/:namespace/write endpoint.
 *
 * These embeddings enable visual similarity search — given a video screenshot,
 * you can find the closest product-variant by cosine distance in the DB.
 *
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * The model (Xenova/clip-vit-base-patch32) is lazily loaded on first call
 * and reused across all subsequent invocations (~350MB download, cached in
 * .cache/huggingface alongside the Grounding DINO model).
 */

import { computeClipEmbedding } from '@/lib/models/clip'
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

    log.info('Computing CLIP embeddings', { gtin: v.gtin, count: recognitionImages.length })

    const writeItems: Array<{ id: string; embedding: number[] }> = []

    for (const ri of recognitionImages) {
      // Resolve the media URL for this crop
      const imageRef = ri.image
      let mediaUrl: string | undefined

      if (typeof imageRef === 'number') {
        const mediaDoc = (await payload.findByID({ collection: 'media', id: imageRef })) as Record<string, unknown>
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
        const embedding = await computeClipEmbedding(fullUrl)
        if (!embedding) {
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Unexpected embedding dimensions for recognition image ${ri.id}` })
          continue
        }
        writeItems.push({ id: ri.id, embedding })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: `CLIP embedding failed for recognition image ${ri.id}: ${msg}` })
      }
    }

    // Batch write embeddings via the server endpoint
    if (writeItems.length > 0) {
      try {
        const result = await payload.embeddings.write(EMBEDDING_NAMESPACE, writeItems)
        log.info('Embeddings written', { gtin: v.gtin, written: result.written })

        // Update the hasEmbedding flags on the product-variant via Payload REST API
        // We need to update the full recognitionImages array with hasEmbedding set to true
        // for the items we just wrote
        const writtenIds = new Set(writeItems.map((w) => w.id))
        const updatedRecognitionImages = recognitionImages.map((ri) => ({
          ...ri,
          // Resolve image to just the ID for the update
          image: typeof ri.image === 'number' ? ri.image : ri.image.id,
          hasEmbedding: writtenIds.has(ri.id),
        }))

        await payload.update({
          collection: 'product-variants',
          id: variantId,
          data: { recognitionImages: updatedRecognitionImages },
        })

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
