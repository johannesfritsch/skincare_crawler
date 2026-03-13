/**
 * Stage 4: Screenshot Search
 *
 * Takes detection crops from stage 3 (screenshot_detection), computes
 * transient CLIP ViT-B/32 embeddings, and searches against the product
 * recognition image embeddings in pgvector to find matching products.
 *
 * Embeddings are NOT stored — they are computed in memory and discarded
 * after the search. Matched products are written to the detection entries
 * and merged into the snippet's referencedProducts.
 *
 * Uses the shared CLIP singleton from @/lib/models/clip.
 */

import { computeClipEmbedding } from '@/lib/models/clip'
import type { StageContext, StageResult } from './index'

const SEARCH_NAMESPACE = 'recognition-images'
const SEARCH_THRESHOLD = 0.3
const SEARCH_LIMIT = 1

export async function executeScreenshotSearch(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Fetch all snippets for this video
  const snippetsResult = await payload.find({
    collection: 'video-snippets',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (snippetsResult.docs.length === 0) {
    log.info('No snippets found, skipping screenshot search', { videoId })
    return { success: true }
  }

  let totalSearched = 0
  let totalMatched = 0
  const allMatchedProductIds = new Set<number>()
  const serverUrl = payload.serverUrl

  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const snippetId = snippet.id as number
    const detections = snippet.detections as
      | Array<{
          id: string
          image: number | { id: number; url?: string }
          score: number
          screenshotIndex: number
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
    const snippetMatchedProductIds: number[] = []

    for (const det of detections) {
      // Resolve the detection crop media URL
      const imageRef = det.image
      let mediaUrl: string | undefined

      if (typeof imageRef === 'number') {
        const mediaDoc = (await payload.findByID({ collection: 'media', id: imageRef })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaUrl = imageRef.url
      }

      if (!mediaUrl) {
        jlog.event('video_processing.warning', { title, warning: `No media URL for detection crop in snippet ${snippetId}` })
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
          jlog.event('video_processing.warning', { title, warning: `Failed to compute CLIP embedding for detection in snippet ${snippetId}` })
          updatedDetections.push({
            ...det,
            image: typeof det.image === 'number' ? det.image : (det.image as { id: number }).id,
            hasEmbedding: false,
          })
          continue
        }

        totalSearched++

        // Search against product recognition image embeddings
        const searchResult = await payload.embeddings.search(SEARCH_NAMESPACE, embedding, {
          limit: SEARCH_LIMIT,
          threshold: SEARCH_THRESHOLD,
        })

        let matchedProduct: number | null = null
        let matchDistance: number | null = null
        let matchedGtin: string | null = null

        if (searchResult.results.length > 0) {
          const best = searchResult.results[0]
          matchDistance = best.distance as number
          matchedGtin = (best.gtin as string) || null

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

              log.info('CLIP match found', {
                snippetId,
                gtin: matchedGtin,
                productId: matchedProduct,
                distance: matchDistance,
              })
            }
          }
        }

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
        jlog.event('video_processing.warning', { title, warning: `CLIP search failed for detection in snippet ${snippetId}: ${msg}` })
        updatedDetections.push({
          ...det,
          image: typeof det.image === 'number' ? det.image : (det.image as { id: number }).id,
        })
      }
    }

    // Update snippet detections with match results
    await payload.update({
      collection: 'video-snippets',
      id: snippetId,
      data: { detections: updatedDetections },
    })

    // Merge matched products into referencedProducts (union with existing LLM matches)
    if (snippetMatchedProductIds.length > 0) {
      const existingRefs = (snippet.referencedProducts as Array<number | Record<string, unknown>>) || []
      const existingIds = existingRefs.map((ref) =>
        typeof ref === 'number' ? ref : (ref as { id: number }).id,
      )
      const mergedIds = [...new Set([...existingIds, ...snippetMatchedProductIds])]

      await payload.update({
        collection: 'video-snippets',
        id: snippetId,
        data: { referencedProducts: mergedIds },
      })

      log.info('Updated snippet with CLIP-matched products', {
        snippetId,
        newProducts: snippetMatchedProductIds.length,
        totalProducts: mergedIds.length,
      })
    }

    await ctx.heartbeat()
  }

  if (totalSearched > 0 || totalMatched > 0) {
    jlog.event('video_processing.screenshots_searched', {
      title,
      searched: totalSearched,
      matched: totalMatched,
      productsFound: allMatchedProductIds.size,
    })
  }

  log.info('Screenshot search stage complete', { videoId, searched: totalSearched, matched: totalMatched, products: allMatchedProductIds.size })
  return { success: true }
}
