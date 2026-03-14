/**
 * Stage 1: Product Recognition
 *
 * Reads existing video-scenes and their video-frames from the DB
 * (created in scene detection stage).
 * For barcode snippets: looks up product-variants by GTIN from frames.
 * For visual snippets: runs LLM classification + recognition on
 * recognition candidate frames, then matches products via matchProduct().
 * Updates snippets with referencedProducts.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { classifyScreenshots, recognizeProduct } from '@/lib/video-processing/recognize-product'
import { matchProduct } from '@/lib/match-product'
import type { StageContext, StageResult } from './index'

export async function executeProductRecognition(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Fetch all snippets for this video
  const snippetsResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (snippetsResult.docs.length === 0) {
    log.info('No scenes found, skipping product recognition', { videoId })
    return { success: true }
  }

  let totalTokens = 0

  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const snippetId = snippet.id as number
    const matchingType = snippet.matchingType as string

    // Fetch all frames for this snippet
    const framesResult = await payload.find({
      collection: 'video-frames',
      where: { scene: { equals: snippetId } },
      limit: 1000,
    })
    const frames = framesResult.docs as Array<Record<string, unknown>>

    if (matchingType === 'barcode') {
      // Find the barcode from frames
      let barcode: string | null = null
      for (const frame of frames) {
        if (frame.barcode) {
          barcode = frame.barcode as string
          break
        }
      }

      if (barcode) {
        // Look up product by GTIN via product-variants
        const variants = await payload.find({
          collection: 'product-variants',
          where: { gtin: { equals: barcode } },
          limit: 1,
        })
        if (variants.docs.length > 0) {
          const variant = variants.docs[0] as Record<string, unknown>
          const productRef = variant.product as number | Record<string, unknown>
          const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
          await payload.update({
            collection: 'video-scenes',
            id: snippetId,
            data: { referencedProducts: [pid] },
          })
          log.info('Barcode matched to product', { snippetId, barcode, productId: pid })
        } else {
          log.info('No product-variant found for barcode', { snippetId, barcode })
        }
      }
    } else if (matchingType === 'visual' && frames.length > 0) {
      // Visual path: find recognition candidate frames, classify, then recognize

      // Gather recognition candidate frames
      const candidateFrames: Array<{
        frameId: number
        imageMediaId: number
        recogThumbnailMediaId?: number
      }> = []

      // Also gather all frames with their image media IDs for downloading screenshots
      const allFrameImageIds: Array<{ frameId: number; imageMediaId: number }> = []

      for (const frame of frames) {
        const imageRef = frame.image as number | Record<string, unknown>
        const imageMediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id

        allFrameImageIds.push({ frameId: frame.id as number, imageMediaId })

        if (frame.recognitionCandidate) {
          const recogRef = frame.recognitionThumbnail as number | Record<string, unknown> | null
          const recogThumbnailMediaId = recogRef
            ? (typeof recogRef === 'number' ? recogRef : (recogRef as { id: number }).id)
            : undefined

          candidateFrames.push({
            frameId: frame.id as number,
            imageMediaId,
            recogThumbnailMediaId,
          })
        }
      }

      if (candidateFrames.length === 0) {
        log.info('No recognition candidate frames for visual snippet', { snippetId })
        continue
      }

      // Download recognition thumbnails to temp files for LLM classification
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-recog-'))

      try {
        const serverUrl = payload.serverUrl

        // Phase 1: Classify each recognition candidate independently
        const classifyInputs: { clusterGroup: number; imagePath: string }[] = []

        for (let ci = 0; ci < candidateFrames.length; ci++) {
          const cf = candidateFrames[ci]
          if (cf.recogThumbnailMediaId) {
            const mediaDoc = await payload.findByID({ collection: 'video-media', id: cf.recogThumbnailMediaId }) as Record<string, unknown>
            const mediaUrl = mediaDoc.url as string
            if (mediaUrl) {
              const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
              const res = await fetch(fullUrl)
              if (res.ok) {
                const localPath = path.join(tmpDir, `recog_${ci}.png`)
                fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))
                // Use candidate index as "cluster group" — each candidate is independent
                classifyInputs.push({ clusterGroup: ci, imagePath: localPath })
              }
            }
          }
        }

        if (classifyInputs.length === 0) {
          log.info('No recognition thumbnails available for classification', { snippetId })
          continue
        }

        const classifyResult = await classifyScreenshots(classifyInputs)
        totalTokens += classifyResult.tokensUsed.totalTokens
        const candidateIndices = new Set(classifyResult.candidates)
        log.info('Phase 1 classification complete', { snippetId, productCandidates: candidateIndices.size })
        jlog.event('video_processing.candidates_identified', { title, segment: snippetId, candidates: candidateIndices.size })
        await ctx.heartbeat()

        // Phase 2: Recognize products from each candidate frame
        const referencedProductIds: number[] = []

        for (const candidateIdx of candidateIndices) {
          const cf = candidateFrames[candidateIdx]
          if (!cf) continue

          // Download the candidate's full-size image for recognition
          const mediaDoc = await payload.findByID({ collection: 'video-media', id: cf.imageMediaId }) as Record<string, unknown>
          const mediaUrl = mediaDoc.url as string
          if (!mediaUrl) continue

          const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
          const res = await fetch(fullUrl)
          if (!res.ok) continue

          const localPath = path.join(tmpDir, `ss_${candidateIdx}.jpg`)
          fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))

          log.info('Phase 2: recognizing product', { snippetId, candidateIdx, frameId: cf.frameId })
          const recognition = await recognizeProduct([localPath])
          if (recognition) {
            totalTokens += recognition.tokensUsed.totalTokens
            jlog.event('video_processing.product_recognized', { title, segment: snippetId, brand: recognition.brand ?? 'unknown', product: recognition.productName ?? 'unknown' })

            // Match product via DB + LLM
            const matchResult = await matchProduct(
              payload,
              recognition.brand,
              recognition.productName,
              recognition.searchTerms,
              jlog,
            )
            if (matchResult) {
              referencedProductIds.push(matchResult.productId)
              log.info('Visual recognition matched to product', { snippetId, frameId: cf.frameId, productId: matchResult.productId })
            }
          }
          await ctx.heartbeat()
        }

        // Update snippet with referenced products
        const uniqueProductIds = [...new Set(referencedProductIds)]
        if (uniqueProductIds.length > 0) {
          await payload.update({
            collection: 'video-scenes',
            id: snippetId,
            data: { referencedProducts: uniqueProductIds },
          })
          log.info('Updated snippet with referenced products', { snippetId, products: uniqueProductIds.length })
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch (e) {
          log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
        }
      }
    }
  }

  log.info('Product recognition stage complete', { videoId, tokens: totalTokens })
  return {
    success: true,
    tokens: { recognition: totalTokens, total: totalTokens },
  }
}
