/**
 * Stage 4: LLM Recognition
 *
 * Reads cluster representative frames for each scene, runs a two-phase
 * LLM pipeline (classify screenshots → recognize products), and writes
 * results to the scene's `llmMatches[]` array.
 *
 * Phase 1: Classify each cluster representative thumbnail via LLM
 *          to determine which contain cosmetics products.
 * Phase 2: For each identified candidate, download the full-size image,
 *          run LLM product recognition, then match against the DB.
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

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number

    // Fetch cluster representative frames for this scene
    const framesResult = await payload.find({
      collection: 'video-frames',
      where: {
        and: [
          { scene: { equals: sceneId } },
          { isClusterRepresentative: { equals: true } },
        ],
      },
      limit: 1000,
    })
    const candidateFrames = framesResult.docs as Array<Record<string, unknown>>

    if (candidateFrames.length === 0) {
      log.info('No cluster representative frames for scene', { sceneId })
      continue
    }

    // Download cluster thumbnails to temp files for LLM classification
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-llm-'))

    try {
      const serverUrl = payload.serverUrl

      // Phase 1: Classify each cluster representative independently
      const classifyInputs: { clusterGroup: number; imagePath: string }[] = []

      for (let ci = 0; ci < candidateFrames.length; ci++) {
        const cf = candidateFrames[ci]
        const recogRef = cf.clusterThumbnail as number | Record<string, unknown> | null
        const recogMediaId = recogRef
          ? (typeof recogRef === 'number' ? recogRef : (recogRef as { id: number }).id)
          : undefined

        if (recogMediaId) {
          const mediaDoc = await payload.findByID({ collection: 'video-media', id: recogMediaId }) as Record<string, unknown>
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
        log.info('No cluster thumbnails available for classification', { sceneId })
        continue
      }

      const classifyResult = await classifyScreenshots(classifyInputs)
      totalTokens += classifyResult.tokensUsed.totalTokens
      const candidateIndices = new Set(classifyResult.candidates)
      log.info('Phase 1 classification complete', { sceneId, productCandidates: candidateIndices.size })
      jlog.event('video_processing.candidates_identified', { title, segment: sceneId, candidates: candidateIndices.size })
      await ctx.heartbeat()

      // Phase 2: Recognize products from each candidate frame
      const llmMatchEntries: Array<Record<string, unknown>> = []

      for (const candidateIdx of candidateIndices) {
        const cf = candidateFrames[candidateIdx]
        if (!cf) continue

        const frameId = cf.id as number
        const imageRef = cf.image as number | Record<string, unknown>
        const imageMediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id

        // Download the candidate's full-size image for recognition
        const mediaDoc = await payload.findByID({ collection: 'video-media', id: imageMediaId }) as Record<string, unknown>
        const mediaUrl = mediaDoc.url as string
        if (!mediaUrl) continue

        const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
        const res = await fetch(fullUrl)
        if (!res.ok) continue

        const localPath = path.join(tmpDir, `ss_${candidateIdx}.jpg`)
        fs.writeFileSync(localPath, Buffer.from(await res.arrayBuffer()))

        log.info('Phase 2: recognizing product', { sceneId, candidateIdx, frameId })
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
