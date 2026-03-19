import fs from 'fs'
import { run } from './process-video'
import { createLogger } from '@/lib/logger'

const log = createLogger('transcribeAudio')

/**
 * Extract full audio from a video file as WAV using ffmpeg.
 */
export async function extractAudio(videoPath: string, outputPath: string): Promise<void> {
  log.info('Extracting audio', { videoPath, outputPath })

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`)
  }
  const videoSize = fs.statSync(videoPath).size
  log.debug('Video file size', { sizeMB: Number((videoSize / 1024 / 1024).toFixed(1)) })

  await run(
    'ffmpeg',
    ['-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', '-y', outputPath],
    300_000,
  )

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Audio extraction produced no output file: ${outputPath}`)
  }
  const audioSize = fs.statSync(outputPath).size
  log.info('Audio extraction complete', { sizeKB: Number((audioSize / 1024).toFixed(0)) })

  if (audioSize < 1000) {
    throw new Error(`Audio file suspiciously small (${audioSize} bytes), video may have no audio track`)
  }
}

/**
 * Extract a time-range clip from an audio file using ffmpeg.
 * Returns false if the output is empty or missing (e.g. scene beyond audio duration).
 */
export async function extractAudioClip(
  audioPath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<boolean> {
  const clampedStart = Math.max(0, startSeconds)

  try {
    await run(
      'ffmpeg',
      [
        '-ss', String(clampedStart),
        '-t', String(durationSeconds),
        '-i', audioPath,
        '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1',
        '-y', outputPath,
      ],
      60_000,
    )
  } catch {
    return false
  }

  if (!fs.existsSync(outputPath)) return false
  const size = fs.statSync(outputPath).size
  // WAV header is 44 bytes; anything <= that is effectively empty
  return size > 100
}

/**
 * Transcribe an audio file using the OpenAI-compatible Whisper API.
 * Returns the transcript text (no word timestamps).
 */
export async function transcribeAudio(
  audioPath: string,
  options: {
    language: string
    model: string
    keywords?: string[]
  },
): Promise<string> {
  log.info('Transcribing audio via Whisper API', { language: options.language, model: options.model })

  const audioSizeKB = (fs.statSync(audioPath).size / 1024).toFixed(0)
  log.debug('Audio file', { sizeKB: Number(audioSizeKB) })

  const prompt = options.keywords?.length
    ? options.keywords.join(', ')
    : undefined

  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  const apiKey = process.env.OPENAI_API_KEY || ''

  const formData = new FormData()
  const audioBlob = new Blob([fs.readFileSync(audioPath)], { type: 'audio/wav' })
  formData.append('file', audioBlob, 'audio.wav')
  formData.append('model', options.model)
  formData.append('language', options.language)
  formData.append('response_format', 'json')
  if (prompt) {
    formData.append('prompt', prompt)
  }

  const url = `${baseURL.replace(/\/+$/, '')}/audio/transcriptions`
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS) || 300_000

  const rawResponse = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!rawResponse.ok) {
    const errorBody = await rawResponse.text()
    log.error('Transcription request failed', { status: rawResponse.status, body: errorBody })
    throw new Error(`Transcription API returned ${rawResponse.status}: ${errorBody || '(empty body)'}`)
  }

  const result = await rawResponse.json() as { text?: string }
  const transcript = result.text ?? ''

  log.info('Transcription complete', { charCount: transcript.length })
  if (transcript.length > 0) {
    log.debug('Transcript preview', { preview: transcript.slice(0, 200) })
  }

  return transcript
}

// ─── Deepgram ───

export interface TranscriptWord {
  word: string
  start: number
  end: number
  confidence: number
}

export interface DeepgramTranscriptionResult {
  transcript: string
  words: TranscriptWord[]
}

/**
 * Transcribe full audio via Deepgram's REST API with word-level timestamps.
 * Returns the full transcript text plus a words array with start/end times,
 * which can be split into per-scene segments using `splitTranscriptByScenes()`.
 *
 * Uses the Deepgram nova-3 model by default. Requires DEEPGRAM_API_KEY env var.
 */
export async function transcribeWithDeepgram(
  audioPath: string,
  options: {
    language: string
    keywords?: string[]
  },
): Promise<DeepgramTranscriptionResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY environment variable is not set')
  }

  const audioBuffer = fs.readFileSync(audioPath)
  const audioSizeKB = (audioBuffer.length / 1024).toFixed(0)
  log.info('Transcribing audio via Deepgram', { language: options.language, sizeKB: Number(audioSizeKB) })

  const params = new URLSearchParams({
    model: 'nova-3',
    language: options.language,
    smart_format: 'true',
    punctuate: 'true',
    utterances: 'false',
  })

  // Deepgram nova-3 uses keyterm for keyword boosting
  if (options.keywords?.length) {
    for (const kw of options.keywords) {
      params.append('keyterm', `${kw}:2`)
    }
  }

  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`
  const timeoutMs = Number(process.env.DEEPGRAM_TIMEOUT_MS) || 300_000

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'audio/wav',
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    log.error('Deepgram request failed', { status: response.status, body: errorBody })
    throw new Error(`Deepgram API returned ${response.status}: ${errorBody || '(empty body)'}`)
  }

  const result = await response.json() as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: string
          words?: Array<{ word: string; start: number; end: number; confidence: number }>
        }>
      }>
    }
  }

  const alt = result.results?.channels?.[0]?.alternatives?.[0]
  const transcript = alt?.transcript ?? ''
  const words: TranscriptWord[] = (alt?.words ?? []).map((w) => ({
    word: w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }))

  log.info('Deepgram transcription complete', { charCount: transcript.length, words: words.length })
  if (transcript.length > 0) {
    log.debug('Transcript preview', { preview: transcript.slice(0, 200) })
  }

  return { transcript, words }
}

/**
 * Split a word-level transcript into per-scene segments using scene timestamps.
 * Each scene gets the words whose start time falls within its [start, end) range.
 */
export function splitTranscriptByScenes(
  words: TranscriptWord[],
  scenes: Array<{ start: number; end: number }>,
): string[] {
  return scenes.map((scene) => {
    const sceneWords = words.filter((w) => w.start >= scene.start && w.start < scene.end)
    return sceneWords.map((w) => w.word).join(' ')
  })
}
