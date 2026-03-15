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
 * Returns the transcript text.
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

  const rawResponse = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
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
