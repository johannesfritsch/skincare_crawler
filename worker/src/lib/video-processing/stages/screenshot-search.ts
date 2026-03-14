/**
 * Stage 3: Screenshot Search
 *
 * Takes detection crops from stage 2 (screenshot_detection) stored on
 * video-frames, computes transient CLIP ViT-B/32 embeddings, and searches
 * against the product recognition image embeddings in pgvector to find
 * matching products.
 *
 * Embeddings are NOT stored — they are computed in memory and discarded
 * after the search. Matched products are written to the detection entries
 * on video-frames and merged into the snippet's referencedProducts.
 *
 * Uses the shared CLIP singleton from @/lib/models/clip.
 *
 * Search threshold and limit are configurable via the job's Configuration
 * tab (searchThreshold, searchLimit). Emits per-detection detail events
 * for full observability in the admin UI — including the top-N distances
 * so you can calibrate the threshold.
 */

import { computeClipEmbedding } from '@/lib/models/clip'
import type { StageContext, StageResult } from './index'

const SEARCH_NAMESPACE = 'recognition-images'
/** How many results to fetch for diagnostic logging (always >= searchLimit) */
const DIAGNOSTIC_LIMIT = 3

export async function executeScreenshotSearch(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)
  const searchThreshold = config.searchThreshold ?? 0.3
  const searchLimit = config.searchLimit ?? 1
  // Always fetch at least DIAGNOSTIC_LIMIT results so we can log near-misses
  const fetchLimit = Math.max(searchLimit, DIAGNOSTIC_LIMIT)

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  jlog.info('Starting CLIP search', { threshold: searchThreshold, searchLimit, fetchLimit })

  // Fetch all snippets for this video
  const snippetsResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (snippetsResult.docs.length === 0) {
    jlog.info('No scenes found, skipping screenshot search', { videoId })
    return { success: true }
  }

  let totalSearched = 0
  let totalMatched = 0
  let embeddingsFailed = 0
  const allMatchedProductIds = new Set<number>()
  const allBestDistances: number[] = []
  const serverUrl = payload.serverUrl

  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const snippetId = snippet.id as number

    // Fetch all frames for this snippet that have detections
    const framesResult = await payload.find({
      collection: 'video-frames',
      where: { scene: { equals: snippetId } },
      limit: 1000,
    })

    const snippetMatchedProductIds: number[] = []

    for (const frameDoc of framesResult.docs) {
      const frame = frameDoc as Record<string, unknown>
      const frameId = frame.id as number
      const detections = frame.detections as
        | Array<{
            id: string
            image: number | { id: number; url?: string }
            score: number
            boxXMin: number
            boxYMin: number
            boxXMax: number
            boxYMax: number
            hasEmbedding?: boolean
            matchedProduct?: number | { id: number } | null
            matchDistance?: number | null
            matchedGtin?: string | null
          }>
        | null

      if (!detections || detections.length === 0) continue

      const updatedDetections: Array<Record<string, unknown>> = []

      for (let detIdx = 0; detIdx < detections.length; detIdx++) {
        const det = detections[detIdx]

        // Resolve the detection crop media URL
        const imageRef = det.image
        let mediaUrl: string | undefined

        if (typeof imageRef === 'number') {
          const mediaDoc = (await payload.findByID({ collection: 'detection-media', id: imageRef })) as Record<string, unknown>
          mediaUrl = mediaDoc.url as string | undefined
        } else {
          mediaUrl = imageRef.url
        }

        if (!mediaUrl) {
          jlog.event('video_processing.warning', { title, warning: `No media URL for detection crop ${detIdx} on frame ${frameId}` })
          updatedDetections.push({
            ...det,
            image: typeof det.image === 'number' ? det.image : (det.image as { id: number }).id,
          })
          continue
        }

        const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

        try {
          // Compute CLIP embedding (transient — not stored)
          const embedding = await computeClipEmbedding(fullUrl)
          if (!embedding) {
            embeddingsFailed++
            jlog.event('video_processing.screenshot_search_detail', {
              title,
              sceneId: snippetId,
              frameId,
              detectionIndex: detIdx,
              embeddingComputed: false,
              resultsReturned: 0,
              bestDistance: 0,
              bestGtin: '-',
              matched: false,
              matchedProductId: 0,
              topDistances: '-',
            })
            updatedDetections.push({
              ...det,
              image: typeof det.image === 'number' ? det.image : (det.image as { id: number }).id,
              hasEmbedding: false,
            })
            continue
          }

          totalSearched++

          // Search against product recognition image embeddings
          // Fetch more results than needed for diagnostic logging
          const searchResult = await payload.embeddings.search(SEARCH_NAMESPACE, embedding, {
            limit: fetchLimit,
            threshold: undefined, // Don't filter server-side — we want to see all top-N for diagnostics
          })

          const allResults = searchResult.results || []
          const topDistances = allResults.map((r) => (r.distance as number).toFixed(4)).join(', ') || '-'
          const bestResult = allResults.length > 0 ? allResults[0] : null
          const bestDistance = bestResult ? (bestResult.distance as number) : 0
          const bestGtin = bestResult ? ((bestResult.gtin as string) || '-') : '-'

          if (bestDistance > 0) {
            allBestDistances.push(bestDistance)
          }

          // Only match if the best result is within the configured threshold
          let matchedProduct: number | null = null
          let matchDistance: number | null = null
          let matchedGtin: string | null = null
          let didMatch = false

          if (bestResult && bestDistance <= searchThreshold) {
            matchDistance = bestDistance
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
                const productRef = pv.product as number | Record<string, unknown>
                matchedProduct = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
                snippetMatchedProductIds.push(matchedProduct)
                allMatchedProductIds.add(matchedProduct)
                totalMatched++
                didMatch = true
              }
            }
          }

          // Emit per-detection detail event (always — even on no match)
          jlog.event('video_processing.screenshot_search_detail', {
            title,
            sceneId: snippetId,
            frameId,
            detectionIndex: detIdx,
            embeddingComputed: true,
            resultsReturned: allResults.length,
            bestDistance: Math.round(bestDistance * 10000) / 10000,
            bestGtin,
            matched: didMatch,
            matchedProductId: matchedProduct ?? 0,
            topDistances,
          })

          updatedDetections.push({
            ...det,
            image: typeof det.image === 'number' ? det.image : (det.image as { id: number }).id,
            hasEmbedding: true,
            matchedProduct,
            matchDistance,
            matchedGtin,
          })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          jlog.event('video_processing.warning', { title, warning: `CLIP search failed for detection ${detIdx} on frame ${frameId}: ${msg}` })
          updatedDetections.push({
            ...det,
            image: typeof det.image === 'number' ? det.image : (det.image as { id: number }).id,
          })
        }
      }

      // Update frame detections with match results
      await payload.update({
        collection: 'video-frames',
        id: frameId,
        data: { detections: updatedDetections },
      })
    }

    // Merge matched products into snippet's referencedProducts (union with existing LLM matches)
    if (snippetMatchedProductIds.length > 0) {
      const existingRefs = (snippet.referencedProducts as Array<number | Record<string, unknown>>) || []
      const existingIds = existingRefs.map((ref) =>
        typeof ref === 'number' ? ref : (ref as { id: number }).id,
      )
      const mergedIds = [...new Set([...existingIds, ...snippetMatchedProductIds])]

      await payload.update({
        collection: 'video-scenes',
        id: snippetId,
        data: { referencedProducts: mergedIds },
      })
    }

    await ctx.heartbeat()
  }

  // Compute average best distance for the aggregate event
  const avgBestDistance =
    allBestDistances.length > 0
      ? Math.round((allBestDistances.reduce((s, d) => s + d, 0) / allBestDistances.length) * 10000) / 10000
      : 0

  // Always emit aggregate event (even when 0 searched — that's useful info)
  jlog.event('video_processing.screenshots_searched', {
    title,
    searched: totalSearched,
    matched: totalMatched,
    productsFound: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
  })

  jlog.info('Screenshot search complete', {
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
