/**
 * Video crawl — Stage 1: download
 *
 * Downloads the video file, gets the actual duration via ffprobe,
 * uploads the file to video-media, and updates the video record
 * with videoFile and duration.
 *
 * Platform-specific download:
 * - YouTube: yt-dlp (with proxy + --js-runtimes node)
 * - Instagram/TikTok: gallery-dl (with cookies from CrawlerSettings + proxy)
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import type { VideoCrawlStageContext, VideoCrawlWorkItem, VideoCrawlStageResult } from './index'
import { getCookies } from '@/lib/video-discovery/drivers/gallery-dl'
import { createLogger } from '@/lib/logger'

const log = createLogger('VideoDownload')

/** Detect platform from URL hostname */
function detectPlatform(url: string): 'youtube' | 'instagram' | 'tiktok' {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('instagram')) return 'instagram'
    if (host.includes('tiktok')) return 'tiktok'
  } catch {}
  return 'youtube'
}

/** Download video via yt-dlp (YouTube). */
async function downloadViaYtDlp(
  url: string,
  videoPath: string,
  logger: VideoCrawlStageContext['log'],
): Promise<void> {
  const { downloadVideo } = await import('@/lib/video-processing/process-video')
  await downloadVideo(url, videoPath, logger)
}

/** Write cookie content to a temp file. Caller must clean up the parent dir. */
function writeCookieTempFile(cookies: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery-dl-cookies-'))
  const cookiePath = path.join(tmpDir, 'cookies.txt')
  fs.writeFileSync(cookiePath, cookies, 'utf-8')
  return cookiePath
}

/** Download video via gallery-dl (Instagram/TikTok). */
function downloadViaGalleryDl(
  url: string,
  outputDir: string,
  cookies: string | undefined,
  platform: 'instagram' | 'tiktok',
  logger: VideoCrawlStageContext['log'],
): Promise<void> {
  const args = ['-d', outputDir, '-o', '{filename}.{extension}']

  // Cookies
  let cookieTempPath: string | undefined
  if (cookies) {
    cookieTempPath = writeCookieTempFile(cookies)
    args.push('--cookies', cookieTempPath)
  }

  // Proxy
  const proxyUrl = process.env.PROXY_URL
  if (proxyUrl) {
    const username = process.env.PROXY_USERNAME || ''
    const password = process.env.PROXY_PASSWORD || ''
    const parsed = new URL(proxyUrl)
    args.push('--proxy', `http://${username}:${password}@${parsed.host}`)
  }

  args.push(url)

  const safeArgs = args.map(a =>
    process.env.PROXY_PASSWORD && a.includes(process.env.PROXY_PASSWORD)
      ? a.replace(process.env.PROXY_PASSWORD, '***')
      : a,
  )
  logger.info('gallery-dl download', { url, platform, proxy: !!proxyUrl, cookies: !!cookies, args: safeArgs.join(' ') })

  const cleanupCookies = () => {
    if (cookieTempPath) {
      try { fs.rmSync(path.dirname(cookieTempPath), { recursive: true, force: true }) } catch {}
    }
  }
  const startMs = Date.now()

  return new Promise((resolve, reject) => {
    const proc = execFile(
      'gallery-dl',
      args,
      { maxBuffer: 100 * 1024 * 1024, timeout: 600_000 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startMs
        const exitCode = error?.code ?? (error ? 'unknown' : 0)

        logger.debug('gallery-dl download output', {
          exitCode,
          durationMs,
          stdoutLen: stdout?.length ?? 0,
          stderrPreview: stderr?.substring(0, 500) || '(empty)',
        })

        if (stderr) {
          logger.warn('gallery-dl download stderr', { stderr: stderr.substring(0, 1000) })
        }

        cleanupCookies()

        if (error) {
          const msg = `gallery-dl download failed (exit ${exitCode}): ${stderr || error.message}`
          logger.error('gallery-dl download failed', { url, exitCode, durationMs })
          reject(new Error(msg))
          return
        }

        logger.info('gallery-dl download complete', { url, durationMs })
        resolve()
      },
    )
    proc.on('error', (err) => {
      cleanupCookies()
      logger.error('Failed to spawn gallery-dl', { error: err.message })
      reject(new Error(`Failed to spawn gallery-dl: ${err.message}`))
    })

    // Stream output to console in real-time
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stdout.write(`[gallery-dl] ${line}\n`)
      }
    })
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stderr.write(`[gallery-dl] ${line}\n`)
      }
    })
  })
}

/** Find the first video file (.mp4, .webm, .mkv) in a directory tree. */
function findVideoFile(dir: string): string | undefined {
  const videoExts = new Set(['.mp4', '.webm', '.mkv', '.avi', '.mov'])
  try {
    const files = fs.readdirSync(dir, { recursive: true }) as string[]
    for (const file of files) {
      const ext = path.extname(String(file)).toLowerCase()
      if (videoExts.has(ext)) {
        return path.join(dir, String(file))
      }
    }
  } catch {}
  return undefined
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
    let videoPath: string

    if (platform === 'youtube') {
      // YouTube: yt-dlp download to random filename
      videoPath = path.join(tmpDir, `${crypto.randomUUID()}.mp4`)
      await downloadViaYtDlp(item.externalUrl, videoPath, ctx.log)
    } else {
      // Instagram/TikTok: gallery-dl download to temp dir, then find the file
      const cookies = await getCookies(ctx.payload, platform)
      if (!cookies) {
        ctx.log.warn(`No ${platform} cookies configured in Crawler Settings`)
      }

      const downloadDir = path.join(tmpDir, 'gallery-dl')
      fs.mkdirSync(downloadDir, { recursive: true })
      await downloadViaGalleryDl(item.externalUrl, downloadDir, cookies, platform, ctx.log)

      const found = findVideoFile(downloadDir)
      if (!found) {
        throw new Error(`gallery-dl downloaded no video file for ${item.externalUrl}`)
      }
      videoPath = found
      ctx.log.info('Found downloaded video', { videoPath: path.basename(videoPath) })
    }

    await ctx.heartbeat()

    // Get actual duration via ffprobe
    const { getVideoDuration } = await import('@/lib/video-processing/process-video')
    const actualDuration = await getVideoDuration(videoPath).catch(() => undefined)

    // Upload video to video-media with random filename
    const ext = path.extname(videoPath).toLowerCase()
    const mimetype = ext === '.webm' ? 'video/webm' : ext === '.mkv' ? 'video/x-matroska' : 'video/mp4'
    const uploadPath = path.join(tmpDir, `${crypto.randomUUID()}${ext}`)
    fs.renameSync(videoPath, uploadPath)
    const videoMediaId = await ctx.uploadMedia(uploadPath, 'video', mimetype, 'video-media')

    // Update the video record with videoFile + duration
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
