/**
 * Stage 6: Transcription
 *
 * Downloads the video media, extracts full audio, transcribes the entire
 * audio in a single Deepgram API call with word-level timestamps, splits
 * the transcript into per-scene segments by timestamp, then runs one LLM
 * correction pass on the full transcript and distributes corrected text
 * back to each scene.
 *
 * This replaces the previous per-scene Whisper approach (N Whisper calls +
 * N LLM correction calls) with 1 Deepgram call + 1 LLM correction call.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { extractAudio, transcribeWithDeepgram, splitTranscriptByScenes } from '@/lib/video-processing/transcribe-audio'
import { correctTranscript } from '@/lib/video-processing/correct-transcript'
import type { StageContext, StageResult } from './index'

export async function executeTranscription(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Prefer audioFile (WAV, extracted during crawl) over videoFile (MP4, much larger)
  const audioRef = video.audioFile as number | Record<string, unknown> | null
  const videoRef = video.videoFile as number | Record<string, unknown> | null
  const hasAudioFile = !!audioRef

  const mediaRef = audioRef ?? videoRef
  if (!mediaRef) {
    return { success: false, error: 'Video has no media file (video must be crawled first)' }
  }

  const mediaId = typeof mediaRef === 'number' ? mediaRef : (mediaRef as { id: number }).id
  const mediaDoc = await payload.findByID({ collection: 'video-media', id: mediaId }) as Record<string, unknown>
  const mediaUrl = mediaDoc.url as string
  if (!mediaUrl) {
    return { success: false, error: 'Video media record has no URL' }
  }

  // Fetch scenes for per-scene transcript splitting
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
  const audioPath = path.join(tmpDir, 'audio.wav')

  let tokensTranscriptCorrection = 0

  try {
    // 1. Get audio — either download pre-extracted WAV or download video + extract
    const serverUrl = payload.serverUrl
    const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

    if (hasAudioFile) {
      log.info('Downloading pre-extracted audio for transcription', { videoId, mediaId })
      const res = await fetch(fullUrl)
      if (!res.ok) {
        return { success: false, error: `Failed to download audio media: ${res.status}` }
      }
      fs.writeFileSync(audioPath, Buffer.from(await res.arrayBuffer()))
    } else {
      log.info('No audioFile — downloading video to extract audio', { videoId, mediaId })
      const videoPath = path.join(tmpDir, 'video.mp4')
      const res = await fetch(fullUrl)
      if (!res.ok) {
        return { success: false, error: `Failed to download video media: ${res.status}` }
      }
      fs.writeFileSync(videoPath, Buffer.from(await res.arrayBuffer()))
      await ctx.heartbeat()
      await extractAudio(videoPath, audioPath)
      // Clean up video file immediately — we only need the audio from here
      try { fs.unlinkSync(videoPath) } catch { /* ignore */ }
    }
    await ctx.heartbeat()

    // 3. Collect keyword hints from detection stages
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

    // 4. Transcribe full audio in one Deepgram call with word timestamps
    const deepgramResult = await transcribeWithDeepgram(audioPath, {
      language: config.transcriptionLanguage,
      keywords: uniqueKeywords,
    })
    await ctx.heartbeat()

    // 5. Split transcript into per-scene segments by word timestamps
    const sceneTimestamps = scenesResult.docs.map((s) => {
      const scene = s as Record<string, unknown>
      return {
        start: scene.timestampStart as number,
        end: scene.timestampEnd as number,
      }
    })
    const sceneTranscripts = splitTranscriptByScenes(deepgramResult.words, sceneTimestamps)

    log.info('Transcript split into scenes', {
      totalWords: deepgramResult.words.length,
      scenes: sceneTranscripts.length,
      scenesWithText: sceneTranscripts.filter((t) => t.trim().length > 0).length,
    })

    // 6. LLM-correct the full transcript in one pass
    const fullTranscript = deepgramResult.transcript
    let correctedFull = fullTranscript

    if (fullTranscript.trim()) {
      // Fetch all brand names for LLM correction context
      const brandsResult = await payload.find({ collection: 'brands', limit: 500 })
      const allBrandNames = brandsResult.docs.map((b) => (b as { name: string }).name).filter(Boolean)

      const correction = await correctTranscript(fullTranscript, allBrandNames, uniqueKeywords)
      tokensTranscriptCorrection += correction.tokensUsed.totalTokens
      correctedFull = correction.correctedTranscript
      await ctx.heartbeat()
    }

    // 7. Map corrections back to per-scene transcripts
    // Strategy: if the LLM changed the full transcript, re-split by finding each
    // scene's raw segment in the corrected text. If that fails, use a proportional
    // character-based split as fallback.
    const correctedSceneTranscripts = mapCorrectionsToScenes(
      sceneTranscripts,
      fullTranscript,
      correctedFull,
    )

    // 8. Write full transcript to the video record
    if (correctedFull.trim()) {
      await payload.update({
        collection: 'videos',
        id: videoId,
        data: { transcript: correctedFull },
      })
    }

    // 9. Write per-scene transcripts with pre/post context to DB
    for (let i = 0; i < scenesResult.docs.length; i++) {
      const scene = scenesResult.docs[i] as Record<string, unknown>
      const sceneId = scene.id as number
      const transcript = correctedSceneTranscripts[i] ?? ''

      // Pre-context: last sentence from previous scene
      const prevText = i > 0 ? (correctedSceneTranscripts[i - 1] ?? '') : ''
      const preTranscript = prevText ? getLastSentence(prevText) : ''

      // Post-context: first sentence from next scene
      const nextText = i < correctedSceneTranscripts.length - 1 ? (correctedSceneTranscripts[i + 1] ?? '') : ''
      const postTranscript = nextText ? getFirstSentence(nextText) : ''

      await payload.update({
        collection: 'video-scenes',
        id: sceneId,
        data: { transcript, preTranscript, postTranscript },
      })
    }

    const totalCharCount = correctedSceneTranscripts.reduce((sum, t) => sum + t.length, 0)

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

/**
 * Extract the last sentence from a text block.
 * Splits on sentence-ending punctuation and returns the final sentence.
 */
function getLastSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  // Split on sentence boundaries (. ! ? …) followed by whitespace
  const sentences = trimmed.split(/(?<=[.!?…])\s+/)
  return sentences[sentences.length - 1]?.trim() ?? ''
}

/**
 * Extract the first sentence from a text block.
 * Returns text up to and including the first sentence-ending punctuation.
 */
function getFirstSentence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  // Find the first sentence boundary
  const match = trimmed.match(/^.*?[.!?…]+/)
  return match ? match[0].trim() : trimmed
}

/**
 * Map a corrected full transcript back to per-scene segments.
 *
 * Uses character-offset proportional mapping: each scene's raw segment
 * occupied a known fraction of the raw full text. We apply the same
 * fractions to the corrected text (which has roughly the same length
 * and structure since the LLM only fixes individual words).
 */
function mapCorrectionsToScenes(
  rawSceneTranscripts: string[],
  rawFull: string,
  correctedFull: string,
): string[] {
  // If nothing was corrected or the transcript is empty, return raw segments
  if (!correctedFull.trim() || correctedFull === rawFull) {
    return rawSceneTranscripts
  }

  // Build cumulative character offsets from raw scene segments
  // The raw full transcript is the scene segments joined by spaces (from Deepgram word splitting)
  const rawTotal = rawSceneTranscripts.reduce((sum, t) => sum + t.length, 0)
  if (rawTotal === 0) return rawSceneTranscripts

  const correctedTotal = correctedFull.length
  const result: string[] = []
  let correctedPos = 0

  for (let i = 0; i < rawSceneTranscripts.length; i++) {
    const rawLen = rawSceneTranscripts[i].length
    if (rawLen === 0) {
      result.push('')
      continue
    }

    // Proportional share of the corrected text
    const share = rawLen / rawTotal
    const correctedLen = i === rawSceneTranscripts.length - 1
      ? correctedTotal - correctedPos // last scene gets the remainder
      : Math.round(share * correctedTotal)

    let segment = correctedFull.slice(correctedPos, correctedPos + correctedLen)

    // Adjust to nearest word boundary (don't split mid-word)
    if (i < rawSceneTranscripts.length - 1) {
      const endPos = correctedPos + correctedLen
      // Expand to the next space or end
      const nextSpace = correctedFull.indexOf(' ', endPos)
      const prevSpace = correctedFull.lastIndexOf(' ', endPos)
      // Pick whichever boundary is closer
      if (nextSpace !== -1 && (nextSpace - endPos) < (endPos - prevSpace)) {
        segment = correctedFull.slice(correctedPos, nextSpace)
        correctedPos = nextSpace + 1
      } else if (prevSpace > correctedPos) {
        segment = correctedFull.slice(correctedPos, prevSpace)
        correctedPos = prevSpace + 1
      } else {
        correctedPos = correctedPos + correctedLen
      }
    } else {
      correctedPos = correctedTotal
    }

    result.push(segment.trim())
  }

  return result
}
