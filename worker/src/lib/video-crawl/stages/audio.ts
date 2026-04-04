/**
 * Video crawl — Stage 2: audio
 *
 * Downloads the video MP4 from video-media, extracts audio via ffmpeg,
 * uploads the WAV to video-media, updates video.audioFile, and sets
 * status='crawled' to mark the video as fully crawled.
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VideoCrawlStageContext, VideoCrawlWorkItem, VideoCrawlStageResult } from './index'

export async function executeAudio(
  ctx: VideoCrawlStageContext,
  item: VideoCrawlWorkItem,
): Promise<VideoCrawlStageResult> {
  if (!item.videoId) {
    return { success: false, error: 'audio stage requires a videoId — run metadata stage first' }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-audio-'))

  try {
    // Step 1: Fetch video record to find videoFile media URL
    const videoRecord = await ctx.payload.findByID({
      collection: 'videos',
      id: item.videoId,
    }) as Record<string, unknown>

    const videoFileField = videoRecord.videoFile as Record<string, unknown> | number | null | undefined
    if (!videoFileField) {
      return { success: false, error: `Video ${item.videoId} has no videoFile — run download stage first` }
    }

    // Resolve the media URL (videoFile may be a number ID or a populated object)
    let videoMediaUrl: string
    if (typeof videoFileField === 'object' && videoFileField.url) {
      videoMediaUrl = videoFileField.url as string
    } else {
      const mediaId = typeof videoFileField === 'number' ? videoFileField : (videoFileField as Record<string, unknown>).id as number
      const mediaRecord = await ctx.payload.findByID({ collection: 'video-media', id: mediaId }) as Record<string, unknown>
      videoMediaUrl = mediaRecord.url as string
    }

    // Make URL absolute if relative
    if (videoMediaUrl.startsWith('/')) {
      videoMediaUrl = ctx.payload.serverUrl + videoMediaUrl
    }

    // Step 2: Download video file to temp dir
    const videoPath = path.join(tmpDir, `${crypto.randomUUID()}.mp4`)
    const response = await fetch(videoMediaUrl)
    if (!response.ok) {
      throw new Error(`Failed to download video file: HTTP ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(videoPath, buffer)

    await ctx.heartbeat()

    // Step 3: Extract audio via ffmpeg
    const { extractAudio } = await import('@/lib/video-processing/transcribe-audio')
    const audioPath = path.join(tmpDir, `${crypto.randomUUID()}.wav`)
    await extractAudio(videoPath, audioPath)

    // Step 4: Upload WAV to video-media
    const audioMediaId = await ctx.uploadMedia(audioPath, 'audio', 'audio/wav', 'video-media')

    await ctx.heartbeat()

    // Step 5: Update video record — set audioFile + status='crawled'
    await ctx.payload.update({
      collection: 'videos',
      id: item.videoId,
      data: {
        audioFile: audioMediaId,
        status: 'crawled',
      },
    })

    ctx.log.info('Video audio stage complete', { videoId: item.videoId, audioMediaId })

    return { success: true, videoId: item.videoId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      ctx.log.warn('Audio stage cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
