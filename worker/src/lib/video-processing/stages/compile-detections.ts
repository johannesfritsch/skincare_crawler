/**
 * Stage 6: Compile Detections
 *
 * Synthesizes all detection sources (barcodes, recognitions, llmMatches)
 * into a unified `detections[]` array on each scene. Each detection entry
 * represents one unique product with a synthesized confidence score and
 * provenance from all contributing sources.
 *
 * Confidence scoring:
 *   - Barcode: 1.0 (definitive match)
 *   - Object detection + DINOv2: 1.0 - clipDistance (inverted distance)
 *   - LLM recognition: 0.6 (moderate confidence — LLM can hallucinate)
 *   - Multiple sources boost confidence: max of individual scores + 0.1 bonus per additional source
 */

import type { StageContext, StageResult } from './index'

interface DetectionCandidate {
  productId: number
  sources: Set<string>
  barcodeValue: string | null
  clipDistance: number | null
  llmBrand: string | null
  llmProductName: string | null
}

export async function executeCompileDetections(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Fetch all scenes for this video
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    log.info('No scenes found, skipping compile detections', { videoId })
    return { success: true }
  }

  let totalDetections = 0

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number

    // Collect all product detections from all sources into a map by product ID
    const candidates = new Map<number, DetectionCandidate>()

    function getOrCreate(productId: number): DetectionCandidate {
      let c = candidates.get(productId)
      if (!c) {
        c = { productId, sources: new Set(), barcodeValue: null, clipDistance: null, llmBrand: null, llmProductName: null }
        candidates.set(productId, c)
      }
      return c
    }

    // From barcodes (stage 1)
    const barcodes = scene.barcodes as Array<Record<string, unknown>> | undefined
    if (barcodes) {
      for (const bc of barcodes) {
        const productRef = bc.product as number | Record<string, unknown> | null
        if (!productRef) continue
        const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
        const c = getOrCreate(productId)
        c.sources.add('barcode')
        c.barcodeValue = (bc.barcode as string) ?? null
      }
    }

    // From recognitions (stage 3 — DINOv2 visual search results)
    const recognitions = scene.recognitions as Array<Record<string, unknown>> | undefined
    if (recognitions) {
      for (const rec of recognitions) {
        const productRef = rec.product as number | Record<string, unknown> | null
        if (!productRef) continue
        const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
        const c = getOrCreate(productId)
        c.sources.add('object_detection')
        const distance = rec.distance as number | null
        // Keep the best (lowest) distance if multiple objects matched the same product
        if (distance != null && (c.clipDistance === null || distance < c.clipDistance)) {
          c.clipDistance = distance
        }
      }
    }

    // From LLM matches (stage 4)
    const llmMatches = scene.llmMatches as Array<Record<string, unknown>> | undefined
    if (llmMatches) {
      for (const lm of llmMatches) {
        const productRef = lm.product as number | Record<string, unknown> | null
        if (!productRef) continue
        const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
        const c = getOrCreate(productId)
        c.sources.add('vision_llm')
        c.llmBrand = (lm.brand as string) ?? null
        c.llmProductName = (lm.productName as string) ?? null
      }
    }

    // Build the compiled detections array
    const detectionEntries: Array<Record<string, unknown>> = []

    for (const c of candidates.values()) {
      // Compute synthesized confidence
      let confidence = 0

      if (c.sources.has('barcode')) {
        confidence = Math.max(confidence, 1.0)
      }
      if (c.sources.has('object_detection') && c.clipDistance != null) {
        // Invert cosine distance: closer = higher confidence
        // Distance of 0 = perfect match = 1.0 confidence
        // Distance of 0.3 (threshold) ≈ 0.7 confidence
        const clipConfidence = Math.max(0, 1.0 - c.clipDistance)
        confidence = Math.max(confidence, clipConfidence)
      }
      if (c.sources.has('vision_llm')) {
        confidence = Math.max(confidence, 0.6)
      }

      // Multi-source bonus: +0.1 per additional source (capped at 1.0)
      const sourceCount = c.sources.size
      if (sourceCount > 1) {
        confidence = Math.min(1.0, confidence + (sourceCount - 1) * 0.1)
      }

      detectionEntries.push({
        product: c.productId,
        confidence: Math.round(confidence * 100) / 100,
        sources: Array.from(c.sources),
        barcodeValue: c.barcodeValue,
        clipDistance: c.clipDistance != null ? Math.round(c.clipDistance * 10000) / 10000 : null,
        llmBrand: c.llmBrand,
        llmProductName: c.llmProductName,
      })

      totalDetections++
    }

    // Sort by confidence descending
    detectionEntries.sort((a, b) => (b.confidence as number) - (a.confidence as number))

    // Write compiled detections to the scene (overwrite for idempotency)
    await payload.update({
      collection: 'video-scenes',
      id: sceneId,
      data: { detections: detectionEntries },
    })

    if (detectionEntries.length > 0) {
      log.info('Compiled detections for scene', {
        sceneId,
        products: detectionEntries.length,
        sources: detectionEntries.map(d => (d.sources as string[]).join('+')).join(', '),
      })
    }

    await ctx.heartbeat()
  }

  log.info('Compile detections stage complete', { videoId, totalDetections })
  return { success: true }
}
