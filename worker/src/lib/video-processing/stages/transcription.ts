/**
 * Stage 4: Transcription
 *
 * Downloads the video media, extracts audio, runs Deepgram STT,
 * corrects transcript via LLM, splits per snippet, saves transcript
 * data on the video and on each snippet.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { extractAudio, transcribeAudio } from '@/lib/video-processing/transcribe-audio'
import { correctTranscript } from '@/lib/video-processing/correct-transcript'
import { splitTranscriptForScene } from '@/lib/video-processing/split-transcript'
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

  // Fetch snippets for transcript splitting
  const snippetsResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

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

    // Extract audio
    await extractAudio(videoPath, audioPath)
    await ctx.heartbeat()

    // Collect product names/brands from snippets for keyword boosting
    const productKeywords: string[] = []
    for (const snippetDoc of snippetsResult.docs) {
      const snippet = snippetDoc as Record<string, unknown>
      const refs = snippet.referencedProducts as Array<number | Record<string, unknown>> | undefined
      if (refs) {
        for (const ref of refs) {
          const productId = typeof ref === 'number' ? ref : (ref as { id: number }).id
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
      }
    }
    const uniqueKeywords = [...new Set(productKeywords)]

    // Transcribe with Deepgram
    log.info('Transcribing audio', { videoId, language: config.transcriptionLanguage, model: config.transcriptionModel })
    const rawTranscription = await transcribeAudio(audioPath, {
      language: config.transcriptionLanguage,
      model: config.transcriptionModel,
      keywords: uniqueKeywords,
    })
    jlog.event('video_processing.transcribed', { title, words: rawTranscription.words.length })
    await ctx.heartbeat()

    // Fetch all brand names for LLM correction context
    const brandsResult = await payload.find({ collection: 'brands', limit: 500 })
    const allBrandNames = brandsResult.docs.map((b) => (b as { name: string }).name).filter(Boolean)

    // Correct transcript via LLM
    const correction = await correctTranscript(
      rawTranscription.transcript,
      rawTranscription.words,
      allBrandNames,
      uniqueKeywords,
    )
    tokensTranscriptCorrection = correction.tokensUsed.totalTokens
    jlog.event('video_processing.transcript_corrected', { title, fixes: correction.corrections.length, tokens: tokensTranscriptCorrection })
    await ctx.heartbeat()

    // Save full transcript on the video
    await payload.update({
      collection: 'videos',
      id: videoId,
      data: {
        transcript: correction.correctedTranscript,
        transcriptWords: rawTranscription.words,
      },
    })

    // Split transcript per snippet and update each
    for (const snippetDoc of snippetsResult.docs) {
      const snippet = snippetDoc as Record<string, unknown>
      const snippetId = snippet.id as number
      const start = snippet.timestampStart as number
      const end = snippet.timestampEnd as number

      const tx = splitTranscriptForScene(
        rawTranscription.words,
        start,
        end,
        5, // preSeconds
        3, // postSeconds
      )

      await payload.update({
        collection: 'video-scenes',
        id: snippetId,
        data: {
          preTranscript: tx.preTranscript,
          transcript: tx.transcript,
          postTranscript: tx.postTranscript,
        },
      })
    }

    log.info('Transcription stage complete', { videoId, tokens: tokensTranscriptCorrection })
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
