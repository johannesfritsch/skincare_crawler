import { createClient } from '@deepgram/sdk'
import fs from 'fs'
import { run } from './process-video'
import { createLogger } from '@/lib/logger'

const log = createLogger('transcribeAudio')

export interface TranscriptWord {
  word: string
  start: number
  end: number
  confidence: number
}

export interface TranscriptionResult {
  transcript: string
  words: TranscriptWord[]
}

/**
 * Extract audio from a video file as WAV using ffmpeg.
 */
export async function extractAudio(videoPath: string, outputPath: string): Promise<void> {
  log.info(`Extracting audio: ${videoPath} → ${outputPath}`)

  // Verify input file exists and has content
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }
  const videoSize = fs.statSync(videoPath).size
  log.debug(`Video file size: ${(videoSize / 1024 / 1024).toFixed(1)} MB`)

  await run(
    'ffmpeg',
    ['-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', outputPath],
    300_000, // 5 min timeout
  )

  // Verify output was created and has content
  if (!fs.existsSync(outputPath)) {
    throw new Error(`Audio extraction produced no output file: ${outputPath}`)
  }
  const audioSize = fs.statSync(outputPath).size
  log.info(`Audio extraction complete: ${(audioSize / 1024).toFixed(0)} KB`)

  if (audioSize < 1000) {
    throw new Error(`Audio file suspiciously small (${audioSize} bytes), video may have no audio track`)
  }
}

/**
 * Transcribe audio using Deepgram's API with word-level timestamps.
 */
export async function transcribeAudio(
  audioPath: string,
  options: {
    language: string
    model: string
    keywords?: string[]
  },
): Promise<TranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  log.debug(`transcribeAudio called — DEEPGRAM_API_KEY: ${apiKey ? `SET (${apiKey.length} chars)` : 'NOT SET'}`)
  log.debug(`All env keys containing DEEPGRAM: ${Object.keys(process.env).filter(k => k.includes('DEEPGRAM')).join(', ') || '(none)'}`)
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY environment variable is not set')
  }

  const deepgram = createClient(apiKey)

  log.info(`Transcribing audio: language=${options.language}, model=${options.model}`)

  const audioBuffer = fs.readFileSync(audioPath)
  const audioSizeKB = (audioBuffer.length / 1024).toFixed(0)
  log.info(`Audio file loaded: ${audioSizeKB} KB`)

  if (options.keywords?.length) {
    log.debug(`Keywords (${options.keywords.length}): ${options.keywords.slice(0, 10).join(', ')}${options.keywords.length > 10 ? '...' : ''}`)
  }

  // Nova-3 uses `keyterm` instead of `keywords`; older models use `keywords`
  const isNova3 = options.model.startsWith('nova-3')
  const boostedTerms =
    options.keywords && options.keywords.length > 0
      ? options.keywords.map((kw) => `${kw}:2`)
      : undefined

  log.debug(`Deepgram request params: model=${options.model}, language=${options.language}, ${isNova3 ? 'keyterms' : 'keywords'}=${boostedTerms?.length ?? 0}`)

  try {
    const response = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
      model: options.model,
      language: options.language,
      smart_format: true,
      utterances: true,
      punctuate: true,
      ...(boostedTerms ? (isNova3 ? { keyterm: boostedTerms } : { keywords: boostedTerms }) : {}),
    })

    log.debug(`Deepgram raw response keys: ${Object.keys(response).join(', ')}`)

    // The SDK v4 returns { result } where result is the transcription response
    const result = response.result
    if (!result) {
      log.error(`Deepgram returned no result. Full response: ${JSON.stringify(response).slice(0, 500)}`)
      return { transcript: '', words: [] }
    }

    log.debug(`Deepgram result keys: ${Object.keys(result).join(', ')}`)

    const channels = result.results?.channels
    if (!channels || channels.length === 0) {
      log.error(`Deepgram returned no channels. Result: ${JSON.stringify(result).slice(0, 500)}`)
      return { transcript: '', words: [] }
    }

    const alternative = channels[0]?.alternatives?.[0]
    if (!alternative) {
      log.error(`Deepgram returned no alternatives. Channel: ${JSON.stringify(channels[0]).slice(0, 500)}`)
      return { transcript: '', words: [] }
    }

    const transcript = alternative.transcript ?? ''
    const words: TranscriptWord[] = (alternative.words ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence,
    }))

    log.info(`Transcription complete: ${words.length} words, ${transcript.length} chars`)
    if (transcript.length > 0) {
      log.debug(`First 200 chars: ${transcript.slice(0, 200)}...`)
    }

    return { transcript, words }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined
    log.error(`Deepgram API call failed: ${msg}`)
    if (stack) {
      log.debug(`Stack trace: ${stack}`)
    }
    throw error
  }
}
