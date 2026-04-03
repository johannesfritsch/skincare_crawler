/**
 * Video crawl — Stage 0: metadata
 *
 * Fetches video metadata via yt-dlp --dump-json, resolves/creates channel + creator,
 * downloads and uploads thumbnail, then creates or updates the video record
 * with all metadata fields — but NOT videoFile or audioFile (those come in later stages).
 *
 * Returns the videoId (for URL-keyed items that had no DB record before this stage).
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import type { VideoCrawlStageContext, VideoCrawlWorkItem, VideoCrawlStageResult } from './index'

/** Run yt-dlp --dump-json with proxy support and event logging */
function runYtDlpMetadata(
  url: string,
  ctx: VideoCrawlStageContext,
): Promise<string> {
  const args = ['--js-runtimes', 'node', '--dump-json', '--no-download', url]

  const proxyUrl = process.env.PROXY_URL
  if (proxyUrl) {
    const username = process.env.PROXY_USERNAME || ''
    const password = process.env.PROXY_PASSWORD || ''
    const parsed = new URL(proxyUrl)
    args.unshift('--proxy', `http://${username}:${password}@${parsed.host}`)
  }

  const safeArgs = args.map(a =>
    process.env.PROXY_PASSWORD && a.includes(process.env.PROXY_PASSWORD)
      ? a.replace(process.env.PROXY_PASSWORD, '***')
      : a,
  )
  ctx.log.info('yt-dlp metadata', { url, proxy: !!proxyUrl, args: safeArgs.join(' ') })
  const startMs = Date.now()

  return new Promise((resolve, reject) => {
    const proc = execFile(
      'yt-dlp',
      args,
      { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startMs
        const exitCode = error?.code ?? (error ? 'unknown' : 0)

        ctx.log.debug('yt-dlp metadata raw output', {
          exitCode,
          durationMs,
          stdoutLen: stdout?.length ?? 0,
          stderrPreview: stderr?.substring(0, 500) || '(empty)',
        })

        if (stderr) {
          ctx.log.warn('yt-dlp metadata stderr', { stderr: stderr.substring(0, 1000) })
        }

        if (error) {
          const msg = `yt-dlp metadata failed (exit ${exitCode}): ${stderr || error.message}`
          ctx.log.error('yt-dlp metadata failed', { url, exitCode, stderr: stderr?.substring(0, 500), durationMs })
          reject(new Error(msg))
          return
        }

        ctx.log.info('yt-dlp metadata complete', { url, durationMs, bytes: stdout?.length ?? 0 })
        resolve(stdout)
      },
    )
    proc.on('error', (err) => {
      ctx.log.error('Failed to spawn yt-dlp', { error: err.message })
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`))
    })

    // Stream stderr to console in real-time
    proc.stderr?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) process.stderr.write(`[yt-dlp] ${line}\n`)
      }
    })
  })
}

/** Detect platform from URL hostname */
function detectPlatform(url: string): 'youtube' | 'instagram' | 'tiktok' {
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes('instagram')) return 'instagram'
    if (host.includes('tiktok')) return 'tiktok'
  } catch {}
  return 'youtube'
}

/** Fetch og:image from a channel/profile page as avatar URL */
async function fetchChannelAvatarUrl(channelUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(channelUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    })
    if (!res.ok) return undefined
    const html = await res.text()
    const match = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/)
      ?? html.match(/<meta\s+content="([^"]+)"\s+property="og:image"/)
    return match?.[1] ?? undefined
  } catch {
    return undefined
  }
}

export async function executeMetadata(
  ctx: VideoCrawlStageContext,
  item: VideoCrawlWorkItem,
): Promise<VideoCrawlStageResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-metadata-'))

  try {
    const platform = detectPlatform(item.externalUrl)

    // Step 1: Get metadata via yt-dlp (all platforms)
    const metadataJson = await runYtDlpMetadata(item.externalUrl, ctx)
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>

    const title = (metadata.title as string) ?? item.title
    const duration = (metadata.duration as number) ?? undefined
    const viewCount = (metadata.view_count as number) ?? undefined
    const likeCount = (metadata.like_count as number) ?? undefined
    const thumbnailUrl = (metadata.thumbnail as string) ?? undefined

    // Channel: yt-dlp uses 'channel' for YouTube, 'uploader' for Instagram/TikTok
    const channelName = (metadata.channel as string) ?? (metadata.uploader as string) ?? undefined
    const channelUrl = (metadata.channel_url as string) ?? (metadata.uploader_url as string) ?? undefined

    // Channel avatar: YouTube provides channel_thumbnail_url directly, others need og:image fetch
    let channelAvatarUrl: string | undefined = (metadata.channel_thumbnail_url as string) ?? undefined
    if (!channelAvatarUrl && channelUrl) {
      channelAvatarUrl = await fetchChannelAvatarUrl(channelUrl)
    }

    // upload_date: yt-dlp returns YYYYMMDD for all platforms
    let publishedAt: string | undefined
    const uploadDate = metadata.upload_date as string | undefined
    if (uploadDate && /^\d{8}$/.test(uploadDate)) {
      publishedAt = new Date(
        `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`,
      ).toISOString()
    } else if (metadata.timestamp) {
      // Fallback: some extractors provide Unix timestamp instead
      publishedAt = new Date((metadata.timestamp as number) * 1000).toISOString()
    }

    await ctx.heartbeat()

    // Step 2: Resolve/create channel + creator (required — channel is NOT NULL on videos)
    let channelId: number | undefined
    if (channelUrl) {
      // Find existing channel by URL
      const existingChannel = await ctx.payload.find({
        collection: 'channels',
        where: {
          or: [
            { externalUrl: { equals: channelUrl } },
            { canonicalUrl: { equals: channelUrl } },
          ],
        },
        limit: 1,
      })

      if (existingChannel.docs.length > 0) {
        channelId = (existingChannel.docs[0] as Record<string, unknown>).id as number
      } else {
        // Create creator + channel
        const creatorName = channelName ?? 'Unknown'
        const existingCreator = await ctx.payload.find({
          collection: 'creators',
          where: { name: { equals: creatorName } },
          limit: 1,
        })
        let creatorId: number
        if (existingCreator.docs.length > 0) {
          creatorId = (existingCreator.docs[0] as Record<string, unknown>).id as number
        } else {
          const newCreator = await ctx.payload.create({
            collection: 'creators',
            data: { name: creatorName },
          }) as { id: number }
          creatorId = newCreator.id
        }

        // Download channel avatar
        let channelImageId: number | undefined
        if (channelAvatarUrl) {
          try {
            const avatarRes = await fetch(channelAvatarUrl)
            if (avatarRes.ok) {
              const buffer = Buffer.from(await avatarRes.arrayBuffer())
              const contentType = avatarRes.headers.get('content-type') || 'image/jpeg'
              const ext = contentType.includes('png') ? 'png' : 'jpg'
              const avatarPath = path.join(tmpDir, `avatar.${ext}`)
              fs.writeFileSync(avatarPath, buffer)
              channelImageId = await ctx.uploadMedia(avatarPath, channelName ?? 'Channel avatar', contentType, 'profile-media')
            }
          } catch (e) {
            ctx.log.warn('Failed to download channel avatar', { error: String(e) })
          }
        }

        const newChannel = await ctx.payload.create({
          collection: 'channels',
          data: {
            creator: creatorId,
            platform,
            externalUrl: channelUrl,
            ...(channelImageId ? { image: channelImageId } : {}),
          },
        }) as { id: number }
        channelId = newChannel.id
      }
    }

    if (!channelId) {
      throw new Error(`Could not resolve channel for video ${item.externalUrl} — no channel URL from ${platform} metadata`)
    }

    await ctx.heartbeat()

    // Step 3: Download and upload thumbnail
    let thumbnailMediaId: number | undefined
    if (thumbnailUrl) {
      try {
        const thumbRes = await fetch(thumbnailUrl)
        if (thumbRes.ok) {
          const buffer = Buffer.from(await thumbRes.arrayBuffer())
          const contentType = thumbRes.headers.get('content-type') || 'image/jpeg'
          const ext = contentType.includes('png') ? 'png' : 'jpg'
          const thumbPath = path.join(tmpDir, `thumbnail.${ext}`)
          fs.writeFileSync(thumbPath, buffer)
          thumbnailMediaId = await ctx.uploadMedia(thumbPath, `${title} thumbnail`, contentType, 'video-media')
        }
      } catch (e) {
        ctx.log.warn('Failed to download thumbnail', { url: thumbnailUrl, error: String(e) })
      }
    }

    // Step 4: Create or update video record with metadata — NOT videoFile/audioFile
    const videoData = {
      title,
      channel: channelId,
      ...(publishedAt ? { publishedAt } : {}),
      ...(duration ? { duration } : {}),
      ...(viewCount != null ? { viewCount } : {}),
      ...(likeCount != null ? { likeCount } : {}),
      ...(thumbnailMediaId ? { thumbnail: thumbnailMediaId } : {}),
    }

    let videoId: number
    if (item.videoId) {
      // Existing video record — update it
      await ctx.payload.update({
        collection: 'videos',
        id: item.videoId,
        data: videoData,
      })
      videoId = item.videoId
    } else {
      // New URL with no DB record — create the video record
      const newVideo = await ctx.payload.create({
        collection: 'videos',
        data: {
          ...videoData,
          externalUrl: item.externalUrl,
        },
      }) as { id: number }
      videoId = newVideo.id
    }

    ctx.log.info('Video metadata stage complete', { videoId, title })

    return { success: true, videoId }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    return { success: false, error }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      ctx.log.warn('Metadata stage cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
