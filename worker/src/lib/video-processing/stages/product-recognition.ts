/**
 * Stage 3: Product Recognition
 *
 * Reads existing video-snippets from the DB (created in scene detection stage).
 * For barcode snippets: looks up product-variants by GTIN.
 * For visual snippets: runs LLM classification + recognition on screenshot clusters,
 * then matches products via matchProduct().
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
    collection: 'video-snippets',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (snippetsResult.docs.length === 0) {
    log.info('No snippets found, skipping product recognition', { videoId })
    return { success: true }
  }

  let totalTokens = 0

  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const snippetId = snippet.id as number
    const matchingType = snippet.matchingType as string
    const screenshots = snippet.screenshots as Array<Record<string, unknown>> | undefined

    if (matchingType === 'barcode') {
      // Find the barcode from screenshots
      let barcode: string | null = null
      if (screenshots) {
        for (const ss of screenshots) {
          if (ss.barcode) {
            barcode = ss.barcode as string
            break
          }
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
            collection: 'video-snippets',
            id: snippetId,
            data: { referencedProducts: [pid] },
          })
          log.info('Barcode matched to product', { snippetId, barcode, productId: pid })
        } else {
          log.info('No product-variant found for barcode', { snippetId, barcode })
        }
      }
    } else if (matchingType === 'visual' && screenshots && screenshots.length > 0) {
      // Visual path: we need to download recognition thumbnails, classify, then recognize

      // Find cluster representatives (screenshots with recognitionCandidate=true or just use all unique groups)
      const groups = new Map<number, Array<{ imageMediaId: number; recogThumbnailMediaId?: number; index: number }>>()
      const repsByGroup = new Map<number, { recogThumbnailMediaId?: number }>()

      for (let j = 0; j < screenshots.length; j++) {
        const ss = screenshots[j]
        const group = (ss.screenshotGroup as number) ?? j
        if (!groups.has(group)) groups.set(group, [])
        groups.get(group)!.push({
          imageMediaId: (ss.image as number | Record<string, unknown>)
            ? (typeof ss.image === 'number' ? ss.image : (ss.image as { id: number }).id)
            : 0,
          recogThumbnailMediaId: ss.recognitionThumbnail
            ? (typeof ss.recognitionThumbnail === 'number'
              ? ss.recognitionThumbnail
              : (ss.recognitionThumbnail as { id: number }).id)
            : undefined,
          index: j,
        })
        if (ss.recognitionCandidate) {
          repsByGroup.set(group, {
            recogThumbnailMediaId: ss.recognitionThumbnail
              ? (typeof ss.recognitionThumbnail === 'number'
                ? ss.recognitionThumbnail
                : (ss.recognitionThumbnail as { id: number }).id)
              : undefined,
          })
        }
      }

      // Download recognition thumbnails to temp files for LLM classification
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-recog-'))

      try {
        const serverUrl = payload.serverUrl

        // Phase 1: Classify cluster representatives
        const classifyInputs: { clusterGroup: number; imagePath: string }[] = []

        for (const [group, rep] of repsByGroup.entries()) {
          if (rep.recogThumbnailMediaId) {
            const mediaDoc = await payload.findByID({ collection: 'media', id: rep.recogThumbnailMediaId }) as Record<string, unknown>
            const mediaUrl = mediaDoc.url as string
            if (mediaUrl) {
              const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
              const res = await fetch(fullUrl)
              if (res.ok) {
                const localPath = path.join(tmpDir, `recog_${group}.png`)
                fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))
                classifyInputs.push({ clusterGroup: group, imagePath: localPath })
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
        const candidateClusters = new Set(classifyResult.candidates)
        log.info('Phase 1 classification complete', { snippetId, productClusters: candidateClusters.size })
        jlog.event('video_processing.candidates_identified', { title, segment: snippetId, candidates: candidateClusters.size })
        await ctx.heartbeat()

        // Phase 2: Recognize products in candidate clusters
        const referencedProductIds: number[] = []

        for (const clusterGroup of candidateClusters) {
          const clusterScreenshots = groups.get(clusterGroup) ?? []

          // Select up to 4 screenshots for recognition
          const selected: string[] = []
          const screenshotMediaIds = clusterScreenshots.map((s) => s.imageMediaId).filter(Boolean)

          // Download screenshots for recognition
          const downloadedPaths: string[] = []
          for (const mid of screenshotMediaIds.slice(0, 4)) {
            const mediaDoc = await payload.findByID({ collection: 'media', id: mid }) as Record<string, unknown>
            const mediaUrl = mediaDoc.url as string
            if (mediaUrl) {
              const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
              const res = await fetch(fullUrl)
              if (res.ok) {
                const localPath = path.join(tmpDir, `ss_${clusterGroup}_${downloadedPaths.length}.jpg`)
                fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))
                downloadedPaths.push(localPath)
              }
            }
          }

          if (downloadedPaths.length <= 4) {
            selected.push(...downloadedPaths)
          } else {
            const step = (downloadedPaths.length - 1) / 3
            for (let k = 0; k < 4; k++) {
              selected.push(downloadedPaths[Math.round(k * step)])
            }
          }

          if (selected.length === 0) continue

          log.info('Phase 2: recognizing product', { snippetId, clusterGroup, screenshots: selected.length })
          const recognition = await recognizeProduct(selected)
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
              log.info('Visual recognition matched to product', { snippetId, clusterGroup, productId: matchResult.productId })
            }
          }
          await ctx.heartbeat()
        }

        // Update snippet with referenced products
        const uniqueProductIds = [...new Set(referencedProductIds)]
        if (uniqueProductIds.length > 0) {
          await payload.update({
            collection: 'video-snippets',
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
