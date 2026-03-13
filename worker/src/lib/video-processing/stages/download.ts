/**
 * Stage 1: Download
 *
 * Downloads the video via yt-dlp, uploads the MP4 to media,
 * links the media record to the video, and saves the duration.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { downloadVideo, getVideoDuration } from '@/lib/video-processing/process-video'
import type { StageContext, StageResult } from './index'

export async function executeDownload(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, log } = ctx
  const jlog = log.forJob('video-processings', ctx.config.jobId)

  // Fetch the video to get its external URL
  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const externalUrl = video.externalUrl as string
  const title = (video.title as string) || `Video ${videoId}`

  if (!externalUrl) {
    return { success: false, error: 'Video has no externalUrl' }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-'))
  const videoPath = path.join(tmpDir, 'video.mp4')

  try {
    // Download video
    log.info('Downloading video', { videoId, url: externalUrl })
    await downloadVideo(externalUrl, videoPath)
    const fileSizeMB = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(1)
    jlog.event('video_processing.downloaded', { title, sizeMB: Number(fileSizeMB) })
    await ctx.heartbeat()

    // Get duration
    const duration = await getVideoDuration(videoPath)

    // Upload video MP4 as media
    log.info('Uploading video to media', { videoId })
    const videoMediaId = await ctx.uploadMedia(videoPath, title, 'video/mp4')
    log.info('Uploaded video as media', { videoId, mediaId: videoMediaId })

    // Persist: link media to video, save duration
    await payload.update({
      collection: 'videos',
      id: videoId,
      data: {
        videoFile: videoMediaId,
        duration,
      },
    })

    log.info('Download stage complete', { videoId, mediaId: videoMediaId, duration })
    return { success: true }
  } finally {
    // Clean up temp dir
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
