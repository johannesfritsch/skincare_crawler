/**
 * Video crawl — Stage 1: download
 *
 * Downloads the video MP4, gets the actual duration via ffprobe,
 * uploads the MP4 to video-media, and updates the video record with
 * videoFile and duration.
 *
 * Platform-specific download:
 * - YouTube: yt-dlp
 * - Instagram: direct CDN URL from Apify dataset item's videoUrl
 * - TikTok: Apify KV store (video files stored by the actor)
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { VideoCrawlStageContext, VideoCrawlWorkItem, VideoCrawlStageResult } from './index'

/** Detect platform from URL hostname */
function detectPlatform(url: string): 'youtube' | 'instagram' | 'tiktok' {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('instagram')) return 'instagram'
    if (host.includes('tiktok')) return 'tiktok'
  } catch {}
  return 'youtube'
}

/** Download video MP4 to a local file path. Returns actual duration if available. */
async function downloadVideoFile(
  url: string,
  platform: 'youtube' | 'instagram' | 'tiktok',
  videoPath: string,
  log: VideoCrawlStageContext['log'],
): Promise<number | undefined> {
  if (platform === 'instagram') {
    // Get direct CDN video URL from Apify dataset
    const { fetchInstagramItemByUrl } = await import('@/lib/video-discovery/drivers/instagram')
    const item = await fetchInstagramItemByUrl(url)
    if (!item?.videoUrl) throw new Error(`Instagram video URL not found in Apify dataset: ${url}`)

    log.info('Downloading Instagram video from CDN', { url: item.videoUrl.substring(0, 100) })
    const res = await fetch(item.videoUrl)
    if (!res.ok) throw new Error(`Instagram video download failed: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(videoPath, buffer)
  } else if (platform === 'tiktok') {
    // Get video from Apify KV store
    const { getTikTokVideoDownloadUrl } = await import('@/lib/video-discovery/drivers/tiktok')
    const downloadUrl = await getTikTokVideoDownloadUrl(url)
    if (!downloadUrl) throw new Error(`TikTok video not found in Apify KV store: ${url}`)

    log.info('Downloading TikTok video from Apify KV store')
    const res = await fetch(downloadUrl)
    if (!res.ok) throw new Error(`TikTok KV store download failed: ${res.status}`)
    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(videoPath, buffer)
  } else {
    // YouTube: use yt-dlp
    const { downloadVideo } = await import('@/lib/video-processing/process-video')
    await downloadVideo(url, videoPath)
  }

  // Get actual duration via ffprobe (works for any MP4)
  const { getVideoDuration } = await import('@/lib/video-processing/process-video')
  return getVideoDuration(videoPath).catch(() => undefined)
}

export async function executeDownload(
  ctx: VideoCrawlStageContext,
  item: VideoCrawlWorkItem,
): Promise<VideoCrawlStageResult> {
  if (!item.videoId) {
    return { success: false, error: 'download stage requires a videoId — run metadata stage first' }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-download-'))

  try {
    const platform = detectPlatform(item.externalUrl)

    // Step 1: Download video MP4 (platform-specific)
    const videoPath = path.join(tmpDir, 'video.mp4')
    const actualDuration = await downloadVideoFile(item.externalUrl, platform, videoPath, ctx.log)

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

    ctx.log.info('Video download stage complete', { videoId: item.videoId, mediaId: videoMediaId, platform })

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
