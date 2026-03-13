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

import type { StageContext, StageResult, AggregationWorkItem } from './index'

// ─── CLIP singleton ───

const CLIP_MODEL_ID = 'Xenova/clip-vit-base-patch32'
const EMBEDDING_NAMESPACE = 'recognition-images'
const EMBEDDING_DIMENSIONS = 512

// Lazy-loaded pipeline singleton — created once per worker process
let extractorPromise: Promise<CLIPFeatureExtractor> | null = null

interface CLIPFeatureExtractor {
  (images: string | string[], options?: { pool?: boolean | null }): Promise<{
    data: Float32Array
    dims: number[]
  }>
}

async function getExtractor(): Promise<CLIPFeatureExtractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      // Dynamic import — @huggingface/transformers is ESM
      const { pipeline, env } = await import('@huggingface/transformers')

      // Prefer local cache dir for models
      env.cacheDir = './.cache/huggingface'

      const extractor = await pipeline('image-feature-extraction', CLIP_MODEL_ID, {
        dtype: 'fp32',
      })
      return extractor as unknown as CLIPFeatureExtractor
    })()
  }
  return extractorPromise
}

// ─── Stage Implementation ───

export async function executeEmbedImages(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // Lazily load the CLIP model
  log.info('Loading CLIP model (first call may download ~350MB)')
  const extractor = await getExtractor()
  log.info('CLIP model ready')

  let totalEmbedded = 0
  let totalSkipped = 0

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
      totalSkipped++
      continue
    }

    // Filter to only items without embeddings
    const pending = recognitionImages.filter((ri) => !ri.hasEmbedding)
    if (pending.length === 0) {
      log.info('All recognition images already have embeddings', { gtin: v.gtin })
      totalSkipped++
      continue
    }

    log.info('Computing CLIP embeddings', { gtin: v.gtin, pending: pending.length, total: recognitionImages.length })

    const writeItems: Array<{ id: string; embedding: number[] }> = []

    for (const ri of pending) {
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
        // Run CLIP image feature extraction
        // image-feature-extraction pipeline accepts URLs, file paths, or RawImage objects
        // For CLIP, returns image_embeds directly (512-dim projected vector)
        const output = await extractor(fullUrl)

        // Extract and L2-normalize the 512-dim embedding vector
        // Normalization ensures cosine similarity via pgvector's <=> operator
        const raw = output.data.slice(0, EMBEDDING_DIMENSIONS)
        const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0))
        const embedding = norm > 0
          ? Array.from(raw, (v) => v / norm)
          : Array.from(raw)

        if (embedding.length !== EMBEDDING_DIMENSIONS) {
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Unexpected embedding dimensions: got ${embedding.length}, expected ${EMBEDDING_DIMENSIONS}` })
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
          hasEmbedding: ri.hasEmbedding || writtenIds.has(ri.id),
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

  if (totalEmbedded > 0 || totalSkipped > 0) {
    jlog.event('aggregation.images_embedded', {
      gtin: workItem.gtins.join(', '),
      embedded: totalEmbedded,
      skipped: totalSkipped,
    })
  }

  log.info('Embed images stage complete', { productId, embedded: totalEmbedded, skipped: totalSkipped })
  return { success: true, productId }
}
