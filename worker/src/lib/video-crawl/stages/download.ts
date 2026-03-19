/**
 * Video crawl — Stage 1: download
 *
 * Downloads the video MP4 via yt-dlp, gets the actual duration via ffprobe,
 * uploads the MP4 to video-media, and updates the video record with
 * videoFile and duration.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VideoCrawlStageContext, VideoCrawlWorkItem, VideoCrawlStageResult } from './index'

export async function executeDownload(
  ctx: VideoCrawlStageContext,
  item: VideoCrawlWorkItem,
): Promise<VideoCrawlStageResult> {
  if (!item.videoId) {
    return { success: false, error: 'download stage requires a videoId — run metadata stage first' }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-download-'))

  try {
    // Step 1: Download video MP4
    const videoPath = path.join(tmpDir, 'video.mp4')
    const { downloadVideo, getVideoDuration } = await import('@/lib/video-processing/process-video')
    await downloadVideo(item.externalUrl, videoPath)
    const actualDuration = await getVideoDuration(videoPath).catch(() => undefined)

    await ctx.heartbeat()

    // Step 2: Upload video MP4 to video-media
    const title = item.title || item.externalUrl
    const videoMediaId = await ctx.uploadMedia(videoPath, title, 'video/mp4', 'video-media')

    // Step 3: Update the video record with videoFile + duration
    await ctx.payload.update({
      collection: 'videos',
      id: item.videoId,
      data: {
        videoFile: videoMediaId,
        ...(actualDuration ? { duration: actualDuration } : {}),
      },
    })

    ctx.log.info('Video download stage complete', { videoId: item.videoId, mediaId: videoMediaId })

    return { success: true, videoId: item.videoId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      ctx.log.warn('Download stage cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
