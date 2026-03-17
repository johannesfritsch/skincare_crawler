/**
 * Stage 5: LLM Recognition
 *
 * Reads representative detection crops from each scene's `objects[]` array
 * (set by side_detection stage), runs a two-phase LLM pipeline
 * (classify crops → recognize products), and writes results to the scene's
 * `llmMatches[]` array.
 *
 * Phase 1: Classify each representative crop via LLM to determine which
 *          contain cosmetics products.
 * Phase 2: For each identified candidate, download the crop image,
 *          run LLM product recognition, then match against the DB.
 *
 * Falls back to processing ALL objects if side_detection hasn't run
 * (no isRepresentative field — backward compatibility).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { classifyScreenshots, recognizeProduct } from '@/lib/video-processing/recognize-product'
import { matchProduct } from '@/lib/match-product'
import type { StageContext, StageResult } from './index'

export async function executeLlmRecognition(ctx: StageContext, videoId: number): Promise<StageResult> {
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
    log.info('No scenes found, skipping LLM recognition', { videoId })
    return { success: true }
  }

  let totalTokens = 0
  const serverUrl = payload.serverUrl

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number

    // Get representative detection crops from the scene's objects[] array
    const objects = scene.objects as Array<{
      id?: string
      frame?: number | Record<string, unknown>
      crop: number | { id: number; url?: string }
      score?: number
      side?: string
      isRepresentative?: boolean
    }> | null

    if (!objects || objects.length === 0) {
      log.info('No objects in scene, skipping LLM recognition', { sceneId })
      continue
    }

    // Filter to representative crops only (backward compat: if no isRepresentative field, use all)
    const repObjects = objects.some((o) => o.isRepresentative !== undefined)
      ? objects.filter((o) => o.isRepresentative === true)
      : objects

    if (repObjects.length === 0) {
      log.info('No representative objects in scene, skipping LLM recognition', { sceneId })
      continue
    }

    // Download crop images to temp files for LLM classification
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-llm-'))

    try {
      // Phase 1: Classify each representative crop independently
      const classifyInputs: { clusterGroup: number; imagePath: string }[] = []
      const cropIndexMap: Map<number, typeof repObjects[number]> = new Map()

      for (let ci = 0; ci < repObjects.length; ci++) {
        const obj = repObjects[ci]
        const cropRef = obj.crop
        let mediaUrl: string | undefined

        if (typeof cropRef === 'number') {
          const mediaDoc = await payload.findByID({ collection: 'detection-media', id: cropRef }) as Record<string, unknown>
          mediaUrl = mediaDoc.url as string | undefined
        } else {
          mediaUrl = cropRef.url
        }

        if (!mediaUrl) continue

        const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
        const res = await fetch(fullUrl)
        if (!res.ok) continue

        const localPath = path.join(tmpDir, `crop_${ci}.png`)
        fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))
        classifyInputs.push({ clusterGroup: ci, imagePath: localPath })
        cropIndexMap.set(ci, obj)
      }

      if (classifyInputs.length === 0) {
        log.info('No crop images available for classification', { sceneId })
        continue
      }

      const classifyResult = await classifyScreenshots(classifyInputs)
      totalTokens += classifyResult.tokensUsed.totalTokens
      const candidateIndices = new Set(classifyResult.candidates)
      log.info('Phase 1 classification complete', { sceneId, productCandidates: candidateIndices.size })
      jlog.event('video_processing.candidates_identified', { title, segment: sceneId, candidates: candidateIndices.size })
      await ctx.heartbeat()

      // Phase 2: Recognize products from each candidate crop
      const llmMatchEntries: Array<Record<string, unknown>> = []

      for (const candidateIdx of candidateIndices) {
        const obj = cropIndexMap.get(candidateIdx)
        if (!obj) continue

        // The crop image was already downloaded in Phase 1
        const localPath = path.join(tmpDir, `crop_${candidateIdx}.png`)
        if (!fs.existsSync(localPath)) continue

        // Resolve the frame reference for the match entry
        const frameRef = obj.frame
        const frameId = frameRef
          ? (typeof frameRef === 'number' ? frameRef : (frameRef as { id: number }).id)
          : null

        log.info('Phase 2: recognizing product from crop', { sceneId, candidateIdx, frameId })
        const recognition = await recognizeProduct([localPath])
        if (recognition) {
          totalTokens += recognition.tokensUsed.totalTokens
          jlog.event('video_processing.product_recognized', { title, segment: sceneId, brand: recognition.brand ?? 'unknown', product: recognition.productName ?? 'unknown' })

          // Match product via DB + LLM
          const matchResult = await matchProduct(
            payload,
            recognition.brand,
            recognition.productName,
            recognition.searchTerms,
            jlog,
          )

          llmMatchEntries.push({
            frame: frameId,
            brand: recognition.brand ?? null,
            productName: recognition.productName ?? null,
            searchTerms: recognition.searchTerms ?? [],
            product: matchResult?.productId ?? null,
          })

          if (matchResult) {
            log.info('LLM recognition matched to product', { sceneId, frameId, productId: matchResult.productId })
          }
        }
        await ctx.heartbeat()
      }

      // Write LLM matches to the scene (overwrite for idempotency)
      await payload.update({
        collection: 'video-scenes',
        id: sceneId,
        data: { llmMatches: llmMatchEntries },
      })

      log.info('Updated scene with LLM matches', { sceneId, matches: llmMatchEntries.length })
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch (e) {
        log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  log.info('LLM recognition stage complete', { videoId, tokens: totalTokens })
  return {
    success: true,
    tokens: { recognition: totalTokens, total: totalTokens },
  }
}
