/**
 * Stage 2: Visual Search
 *
 * Reads detection crops from each gallery item's `objects[]` array,
 * computes transient DINOv2-base embeddings, and searches against
 * product recognition image embeddings in pgvector.
 *
 * Stores top-N candidates per crop in the item's `recognitions[]` array.
 *
 * Simplified vs video: operates on gallery items instead of video scenes.
 */

import { computeImageEmbedding } from '@/lib/models/clip'
import type { GalleryStageContext, GalleryStageResult } from './index'

const SEARCH_NAMESPACE = 'recognition-images'

export async function executeVisualSearch(ctx: GalleryStageContext, galleryId: number): Promise<GalleryStageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('gallery-processings', config.jobId)
  const searchThreshold = config.searchThreshold ?? 0.8
  const searchLimit = config.searchLimit ?? 3

  jlog.info('Starting DINOv2 visual search', { threshold: searchThreshold, searchLimit, namespace: SEARCH_NAMESPACE })

  // Fetch all items for this gallery
  const itemsResult = await payload.find({
    collection: 'gallery-items',
    where: { gallery: { equals: galleryId } },
    limit: 1000,
    sort: 'position',
  })

  if (itemsResult.docs.length === 0) {
    jlog.info('No gallery items found, skipping visual search', { galleryId })
    return { success: true }
  }

  let totalSearched = 0
  let totalCandidates = 0
  let embeddingsFailed = 0
  const allMatchedProductIds = new Set<number>()
  const allBestDistances: number[] = []
  const serverUrl = payload.serverUrl

  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const itemId = item.id as number
    const objects = item.objects as Array<{
      id?: string
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
        jlog.event('gallery_processing.warning', { galleryId, warning: `No media URL for object ${objIdx} in item ${itemId}` })
        continue
      }

      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

      try {
        // Compute image embedding (transient — not stored)
        const embedding = await computeImageEmbedding(fullUrl)
        if (!embedding) {
          embeddingsFailed++
          continue
        }

        totalSearched++

        log.debug('Embedding computed', { itemId, objIdx, dimensions: embedding.length })

        // Search against product recognition image embeddings (with timeout)
        const searchResult = await Promise.race([
          payload.embeddings.search(SEARCH_NAMESPACE, embedding, {
            limit: searchLimit,
            threshold: searchThreshold,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Embedding search timed out after 30s')), 30_000),
          ),
        ])

        const allResults = searchResult.results || []
        const bestResult = allResults.length > 0 ? allResults[0] : null
        const bestDistance = bestResult ? (bestResult.distance as number) : 0

        if (bestDistance > 0) {
          allBestDistances.push(bestDistance)
        }

        // Store ALL results as recognition candidates
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
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('gallery_processing.warning', { galleryId, warning: `Visual search failed for object ${objIdx} in item ${itemId}: ${msg}` })
      }
    }

    // Write recognitions to the item (overwrite for idempotency)
    // Retry once on fetch failure — undici connection pool can go stale during ML inference
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await payload.update({
          collection: 'gallery-items',
          id: itemId,
          data: { recognitions: recognitionEntries },
        })
        break
      } catch (updateErr) {
        if (attempt === 0 && updateErr instanceof Error && updateErr.message.includes('fetch failed')) {
          jlog.warn('Retrying gallery item update after stale connection', { itemId })
          continue
        }
        throw updateErr
      }
    }

    await ctx.heartbeat()
  }

  const avgBestDistance =
    allBestDistances.length > 0
      ? Math.round((allBestDistances.reduce((s, d) => s + d, 0) / allBestDistances.length) * 10000) / 10000
      : 0

  jlog.event('gallery_processing.visual_search_complete', {
    galleryId,
    searched: totalSearched,
    matched: totalCandidates,
    productsFound: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
  })

  jlog.info('Visual search complete', {
    galleryId,
    searched: totalSearched,
    candidates: totalCandidates,
    products: allMatchedProductIds.size,
    embeddingsFailed,
    avgBestDistance,
    threshold: searchThreshold,
  })
  return { success: true }
}
