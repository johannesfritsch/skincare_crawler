/**
 * Stage 5: Transcription
 *
 * Downloads the video media, extracts full audio, then transcribes
 * each scene individually via the Whisper API. Each scene gets its
 * own audio clip (ffmpeg -ss -t), its own transcription call, and
 * its own LLM correction pass.
 *
 * The full video transcript is assembled by concatenating all
 * corrected scene transcripts.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { extractAudio, extractAudioClip, transcribeAudio } from '@/lib/video-processing/transcribe-audio'
import { correctTranscript } from '@/lib/video-processing/correct-transcript'
import type { StageContext, StageResult } from './index'

export async function executeTranscription(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Get the video media to download
  const imageRef = video.videoFile as number | Record<string, unknown> | null
  if (!imageRef) {
    return { success: false, error: 'Video has no media file (video must be crawled first)' }
  }

  const mediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id
  const mediaDoc = await payload.findByID({ collection: 'video-media', id: mediaId }) as Record<string, unknown>
  const mediaUrl = mediaDoc.url as string
  if (!mediaUrl) {
    return { success: false, error: 'Video media record has no URL' }
  }

  // Fetch scenes for per-scene transcription
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    log.info('No scenes found, skipping transcription', { videoId })
    return { success: true }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-transcribe-'))
  const videoPath = path.join(tmpDir, 'video.mp4')
  const audioPath = path.join(tmpDir, 'audio.wav')

  let tokensTranscriptCorrection = 0

  try {
    // Download video media locally
    log.info('Downloading video for transcription', { videoId, mediaId })
    const serverUrl = payload.serverUrl
    const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
    const res = await fetch(fullUrl)
    if (!res.ok) {
      return { success: false, error: `Failed to download video media: ${res.status}` }
    }
    fs.writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()))
    await ctx.heartbeat()

    // Extract full audio track
    await extractAudio(videoPath, audioPath)
    await ctx.heartbeat()

    // Collect keyword hints from detection stages
    const productIds = new Set<number>()
    const productKeywords: string[] = []

    for (const sceneDoc of scenesResult.docs) {
      const scene = sceneDoc as Record<string, unknown>

      const barcodes = scene.barcodes as Array<Record<string, unknown>> | undefined
      if (barcodes) {
        for (const bc of barcodes) {
          const pid = bc.product as number | Record<string, unknown> | null
          if (pid) productIds.add(typeof pid === 'number' ? pid : (pid as { id: number }).id)
        }
      }

      const recognitions = scene.recognitions as Array<Record<string, unknown>> | undefined
      if (recognitions) {
        for (const rec of recognitions) {
          const pid = rec.product as number | Record<string, unknown> | null
          if (pid) productIds.add(typeof pid === 'number' ? pid : (pid as { id: number }).id)
        }
      }

      const llmMatches = scene.llmMatches as Array<Record<string, unknown>> | undefined
      if (llmMatches) {
        for (const lm of llmMatches) {
          if (lm.brand) productKeywords.push(lm.brand as string)
          if (lm.productName) productKeywords.push(lm.productName as string)
          const pid = lm.product as number | Record<string, unknown> | null
          if (pid) productIds.add(typeof pid === 'number' ? pid : (pid as { id: number }).id)
        }
      }
    }

    for (const productId of productIds) {
      try {
        const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
        if (product.name) productKeywords.push(product.name as string)
        const brandRel = product.brand as Record<string, unknown> | number | null
        if (brandRel && typeof brandRel === 'object' && 'name' in brandRel) {
          productKeywords.push(brandRel.name as string)
        }
      } catch {
        // Product not found, skip
      }
    }

    const uniqueKeywords = [...new Set(productKeywords)]

    // Fetch all brand names for LLM correction context
    const brandsResult = await payload.find({ collection: 'brands', limit: 500 })
    const allBrandNames = brandsResult.docs.map((b) => (b as { name: string }).name).filter(Boolean)

    // Transcribe each scene individually
    const sceneTranscripts: string[] = []

    for (let i = 0; i < scenesResult.docs.length; i++) {
      const scene = scenesResult.docs[i] as Record<string, unknown>
      const sceneId = scene.id as number
      const start = scene.timestampStart as number
      const end = scene.timestampEnd as number
      const duration = end - start

      if (duration < 0.5) {
        log.info('Scene too short, skipping transcription', { sceneId, duration })
        sceneTranscripts.push('')
        continue
      }

      // Extract audio clip for this scene
      const clipPath = path.join(tmpDir, `scene_${i}.wav`)
      const clipOk = await extractAudioClip(audioPath, clipPath, start, duration)

      if (!clipOk) {
        log.warn('Audio clip extraction failed or empty', { sceneId, start, duration })
        sceneTranscripts.push('')
        continue
      }

      // Transcribe the scene clip
      log.info('Transcribing scene', { sceneId, sceneIndex: i, start, duration, language: config.transcriptionLanguage })
      const rawText = await transcribeAudio(clipPath, {
        language: config.transcriptionLanguage,
        model: config.transcriptionModel,
        keywords: uniqueKeywords,
      })

      // LLM-correct the scene transcript
      let correctedText = rawText
      if (rawText.trim()) {
        const correction = await correctTranscript(rawText, allBrandNames, uniqueKeywords)
        tokensTranscriptCorrection += correction.tokensUsed.totalTokens
        correctedText = correction.correctedTranscript
      }

      sceneTranscripts.push(correctedText)

      // Update the scene with its transcript
      await payload.update({
        collection: 'video-scenes',
        id: sceneId,
        data: { transcript: correctedText },
      })

      // Clean up clip file
      try { fs.unlinkSync(clipPath) } catch { /* ignore */ }
      await ctx.heartbeat()
    }

    const totalCharCount = sceneTranscripts.reduce((sum, t) => sum + t.length, 0)

    jlog.event('video_processing.transcribed', { title, scenes: scenesResult.docs.length, charCount: totalCharCount })

    log.info('Transcription stage complete', { videoId, scenes: scenesResult.docs.length, totalCharCount, tokens: tokensTranscriptCorrection })
    return {
      success: true,
      tokens: { transcriptCorrection: tokensTranscriptCorrection, total: tokensTranscriptCorrection },
    }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
