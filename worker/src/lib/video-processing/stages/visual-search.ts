/**
 * Stage 3: Visual Search
 *
 * Reads ALL detection crops from the scene's `objects[]` array (from stage 2:
 * object_detection). Computes transient DINOv2-base embeddings (768-dim), and
 * searches against product recognition image embeddings in pgvector.
 *
 * Stores **top-N candidates** per crop (up to searchLimit, default 3) in the
 * scene's `recognitions[]` array — not just the best match. The searchThreshold
 * acts as a pre-filter on the pgvector query to avoid totally irrelevant results.
 * Final product decisions are made by the compile_detections stage (LLM consolidation).
 *
 * Embeddings are NOT stored — they are computed in memory and discarded
 * after the search.
 *
 * Uses the shared DINOv2 singleton from @/lib/models/clip.
 */

import { computeImageEmbedding } from '@/lib/models/clip'
import type { StageContext, StageResult } from './index'

const SEARCH_NAMESPACE = 'recognition-images'

export async function executeVisualSearch(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)
  const searchThreshold = config.searchThreshold ?? 0.8
  const searchLimit = config.searchLimit ?? 3

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  jlog.info('Starting DINOv2 visual search', { threshold: searchThreshold, searchLimit, namespace: SEARCH_NAMESPACE })

  // Fetch all scenes for this video
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    jlog.info('No scenes found, skipping visual search', { videoId })
    return { success: true }
  }

  let totalSearched = 0
  let totalCandidates = 0
  let embeddingsFailed = 0
  const allMatchedProductIds = new Set<number>()
  const allBestDistances: number[] = []
  const serverUrl = payload.serverUrl

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number
    const objects = scene.objects as Array<{
      id?: string
      frame?: number | Record<string, unknown>
      crop: number | { id: number; url?: string }
      score?: number
    }> | null

    if (!objects || objects.length === 0) continue

    const recognitionEntries: Array<Record<string, unknown>> = []

    for (let objIdx = 0; objIdx < objects.length; objIdx++) {
      const obj = objects[objIdx]

      // Resolve the crop media URL
      const cropRef = obj.crop
      let mediaUrl: string | undefined

      if (typeof cropRef === 'number') {
        const mediaDoc = (await payload.findByID({ collection: 'detection-media', id: cropRef })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaUrl = cropRef.url
      }

      if (!mediaUrl) {
        jlog.event('video_processing.warning', { title, warning: `No media URL for object ${objIdx} in scene ${sceneId}` })
        continue
      }

      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

      try {
        // Compute image embedding (transient — not stored)
        const embedding = await computeImageEmbedding(fullUrl)
        if (!embedding) {
          embeddingsFailed++
          jlog.event('video_processing.visual_search_detail', {
            title,
            sceneId,
            frameId: 0,
            detectionIndex: objIdx,
            embeddingComputed: false,
            resultsReturned: 0,
            bestDistance: 0,
            bestGtin: '-',
            matched: false,
            matchedProductId: 0,
            topDistances: '-',
          })
          continue
        }

        totalSearched++

        log.debug('Embedding computed', { sceneId, objIdx, dimensions: embedding.length })

        // Search against product recognition image embeddings
        // searchThreshold acts as a pre-filter on pgvector to exclude irrelevant results
        const searchResult = await payload.embeddings.search(SEARCH_NAMESPACE, embedding, {
          limit: searchLimit,
          threshold: searchThreshold,
        })

        const allResults = searchResult.results || []
        const topDistances = allResults.map((r) => (r.distance as number).toFixed(4)).join(', ') || '-'
        const bestResult = allResults.length > 0 ? allResults[0] : null
        const bestDistance = bestResult ? (bestResult.distance as number) : 0
        const bestGtin = bestResult ? ((bestResult.gtin as string) || '-') : '-'

        if (allResults.length === 0) {
          log.debug('Search returned zero results', { sceneId, objIdx, threshold: searchThreshold })
        } else {
          log.info('Search results', {
            sceneId,
            objIdx,
            results: allResults.length,
            bestDistance: bestDistance.toFixed(4),
            bestGtin,
            topDistances,
          })
        }

        if (bestDistance > 0) {
          allBestDistances.push(bestDistance)
        }

        // Store ALL results as recognition candidates (not just the best one)
        // The compile_detections stage (LLM consolidation) will make the final decision
        for (const result of allResults) {
          const gtin = (result.gtin as string) || null
          if (!gtin) continue

          const pvResult = await payload.find({
            collection: 'product-variants',
            where: { gtin: { equals: gtin } },
            limit: 1,
          })
          if (pvResult.docs.length === 0) continue

          const pv = pvResult.docs[0] as Record<string, unknown>
          const variantId = pv.id as number
          const productRef = pv.product as number | Record<string, unknown>
          const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
          const distance = result.distance as number

          allMatchedProductIds.add(productId)
          totalCandidates++

          recognitionEntries.push({
            object: obj.id,
            product: productId,
            productVariant: variantId,
            gtin,
            distance: Math.round(distance * 10000) / 10000,
          })
        }

        // Emit per-detection detail event
        jlog.event('video_processing.visual_search_detail', {
          title,
          sceneId,
          frameId: 0,
          detectionIndex: objIdx,
          embeddingComputed: true,
          resultsReturned: allResults.length,
          bestDistance: Math.round(bestDistance * 10000) / 10000,
          bestGtin,
          matched: allResults.length > 0,
          matchedProductId: bestResult ? (allResults[0] as Record<string, unknown>).product_variant_id as number ?? 0 : 0,
          topDistances,
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('video_processing.warning', { title, warning: `Visual search failed for object ${objIdx} in scene ${sceneId}: ${msg}` })
      }
    }

    // Write recognitions to the scene (overwrite for idempotency)
    await payload.update({
      collection: 'video-scenes',
      id: sceneId,
      data: { recognitions: recognitionEntries },
    })

    await ctx.heartbeat()
  }

  // Compute average best distance for the aggregate event
  const avgBestDistance =
    allBestDistances.length > 0
      ? Math.round((allBestDistances.reduce((s, d) => s + d, 0) / allBestDistances.length) * 10000) / 10000
      : 0

  // Always emit aggregate event
  jlog.event('video_processing.visual_search_complete', {
    title,
    searched: totalSearched,
    matched: totalCandidates,
    productsFound: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
  })

  jlog.info('Visual search complete', {
    videoId,
    searched: totalSearched,
    candidates: totalCandidates,
    products: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
    threshold: searchThreshold,
  })
  return { success: true }
}
