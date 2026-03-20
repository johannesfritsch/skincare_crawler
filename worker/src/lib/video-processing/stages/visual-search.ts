/**
 * Stage 4: Visual Search
 *
 * Reads **representative** detection crops from the scene's `objects[]` array
 * (from stages 2+3: object_detection + side_detection). Only processes crops
 * where `isRepresentative === true` (or all crops if side_detection hasn't run,
 * for backward compatibility).
 *
 * Computes transient DINOv2-base embeddings (768-dim), and searches against product
 * recognition image embeddings in pgvector to find matching products.
 *
 * Embeddings are NOT stored — they are computed in memory and discarded
 * after the search. Matched products are written to the scene's
 * `recognitions[]` array.
 *
 * Uses the shared DINOv2 singleton from @/lib/models/clip.
 *
 * Search threshold and limit are configurable via the job's Configuration
 * tab (searchThreshold, searchLimit). Emits per-detection detail events
 * for full observability.
 */

import { computeImageEmbedding } from '@/lib/models/clip'
import type { StageContext, StageResult } from './index'

const SEARCH_NAMESPACE = 'recognition-images'
/** How many results to fetch for diagnostic logging (always >= searchLimit) */
const DIAGNOSTIC_LIMIT = 3

export async function executeVisualSearch(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)
  const searchThreshold = config.searchThreshold ?? 0.3
  const searchLimit = config.searchLimit ?? 1
  // Always fetch at least DIAGNOSTIC_LIMIT results so we can log near-misses
  const fetchLimit = Math.max(searchLimit, DIAGNOSTIC_LIMIT)

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  jlog.info('Starting DINOv2 visual search', { threshold: searchThreshold, searchLimit, fetchLimit, namespace: SEARCH_NAMESPACE })

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
  let totalMatched = 0
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
      side?: string
      isRepresentative?: boolean
    }> | null

    if (!objects || objects.length === 0) continue

    const recognitionEntries: Array<Record<string, unknown>> = []

    for (let objIdx = 0; objIdx < objects.length; objIdx++) {
      const obj = objects[objIdx]

      // Only process representative crops (set by side_detection stage)
      // If side_detection hasn't run (no isRepresentative field), process all objects (backward compat)
      if (obj.isRepresentative === false) continue

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
        const searchResult = await payload.embeddings.search(SEARCH_NAMESPACE, embedding, {
          limit: fetchLimit,
          threshold: undefined, // Don't filter server-side — we want to see all top-N for diagnostics
        })

        const allResults = searchResult.results || []
        const topDistances = allResults.map((r) => (r.distance as number).toFixed(4)).join(', ') || '-'
        const bestResult = allResults.length > 0 ? allResults[0] : null
        const bestDistance = bestResult ? (bestResult.distance as number) : 0
        const bestGtin = bestResult ? ((bestResult.gtin as string) || '-') : '-'

        // Log search results for diagnostics
        if (allResults.length === 0) {
          log.warn('Search returned zero results — recognition_embeddings table may be empty or dimensions may mismatch', { sceneId, objIdx })
        } else {
          log.info('Search results', {
            sceneId,
            objIdx,
            results: allResults.length,
            bestDistance: bestDistance.toFixed(4),
            bestGtin,
            threshold: searchThreshold,
            wouldMatch: bestDistance <= searchThreshold,
            topDistances,
          })
        }

        if (bestDistance > 0) {
          allBestDistances.push(bestDistance)
        }

        // Only match if the best result is within the configured threshold
        let matchedProduct: number | null = null
        let matchedVariant: number | null = null
        let matchedGtin: string | null = null
        let didMatch = false

        if (bestResult && bestDistance <= searchThreshold) {
          matchedGtin = (bestResult.gtin as string) || null

          // Look up the product from the product-variant via GTIN
          if (matchedGtin) {
            const pvResult = await payload.find({
              collection: 'product-variants',
              where: { gtin: { equals: matchedGtin } },
              limit: 1,
            })
            if (pvResult.docs.length > 0) {
              const pv = pvResult.docs[0] as Record<string, unknown>
              matchedVariant = pv.id as number
              const productRef = pv.product as number | Record<string, unknown>
              matchedProduct = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
              allMatchedProductIds.add(matchedProduct)
              totalMatched++
              didMatch = true
            }
          }
        }

        // Emit per-detection detail event (always — even on no match)
        jlog.event('video_processing.visual_search_detail', {
          title,
          sceneId,
          frameId: 0,
          detectionIndex: objIdx,
          embeddingComputed: true,
          resultsReturned: allResults.length,
          bestDistance: Math.round(bestDistance * 10000) / 10000,
          bestGtin,
          matched: didMatch,
          matchedProductId: matchedProduct ?? 0,
          topDistances,
        })

        if (didMatch && matchedProduct) {
          recognitionEntries.push({
            objectIndex: objIdx,
            product: matchedProduct,
            productVariant: matchedVariant,
            gtin: matchedGtin,
            distance: Math.round(bestDistance * 10000) / 10000,
          })
        }
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
    matched: totalMatched,
    productsFound: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
  })

  jlog.info('Visual search complete', {
    videoId,
    searched: totalSearched,
    matched: totalMatched,
    products: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
    threshold: searchThreshold,
  })
  return { success: true }
}
