/**
 * Video crawl — Stage 0: metadata
 *
 * Fetches video metadata, resolves/creates channel + creator,
 * downloads and uploads thumbnail, then creates or updates the video record
 * with all metadata fields — but NOT videoFile or audioFile (those come in later stages).
 *
 * Platform-specific:
 * - YouTube: yt-dlp --dump-json
 * - Instagram/TikTok: gallery-dl --no-download --dump-json (with cookies from CrawlerSettings)
 *
 * Returns the videoId (for URL-keyed items that had no DB record before this stage).
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import type { VideoCrawlStageContext, VideoCrawlWorkItem, VideoCrawlStageResult } from './index'
import { runGalleryDl, getCookies, type GalleryDlEntry } from '@/lib/video-discovery/drivers/gallery-dl'

/** Run yt-dlp --dump-json with proxy support and event logging (YouTube only) */
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

/** Extract metadata fields from yt-dlp JSON output (YouTube) */
function parseYouTubeMetadata(metadata: Record<string, unknown>) {
  const uploadDate = metadata.upload_date as string | undefined
  let publishedAt: string | undefined
  if (uploadDate && /^\d{8}$/.test(uploadDate)) {
    publishedAt = new Date(
      `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`,
    ).toISOString()
  } else if (metadata.timestamp) {
    publishedAt = new Date((metadata.timestamp as number) * 1000).toISOString()
  }

  return {
    title: metadata.title as string | undefined,
    duration: (metadata.duration as number) ?? undefined,
    viewCount: (metadata.view_count as number) ?? undefined,
    likeCount: (metadata.like_count as number) ?? undefined,
    thumbnailUrl: (metadata.thumbnail as string) ?? undefined,
    channelName: (metadata.channel as string) ?? (metadata.uploader as string) ?? undefined,
    channelUrl: (metadata.channel_url as string) ?? (metadata.uploader_url as string) ?? undefined,
    channelAvatarUrl: (metadata.channel_thumbnail_url as string) ?? undefined,
    publishedAt,
  }
}

/** Extract metadata fields from gallery-dl entries (Instagram) */
function parseInstagramMetadata(entries: GalleryDlEntry[]) {
  // Find the richest entry — prefer media entries (with url) over metadata-only
  const entry = entries.find(e => e.url) ?? entries[0]
  if (!entry) return null
  const d = entry.data

  const description = (d.description as string) ?? ''
  const firstLine = description.split('\n').filter(Boolean)[0] ?? ''
  const title = firstLine.substring(0, 200) || (d.post_shortcode as string) || String(d.post_id ?? '')

  const postDate = (d.post_date as string) ?? (d.date as string) ?? ''
  let publishedAt: string | undefined
  if (postDate) {
    const parsed = new Date(postDate)
    if (!isNaN(parsed.getTime())) publishedAt = parsed.toISOString()
  }

  const owner = d.owner as Record<string, unknown> | undefined
  const hdPic = owner?.hd_profile_pic_url_info as Record<string, unknown> | undefined
  const username = (d.username as string) ?? ''

  return {
    title,
    duration: undefined as number | undefined,
    viewCount: undefined as number | undefined,
    likeCount: (d.likes as number) ?? undefined,
    thumbnailUrl: (d.display_url as string) ?? undefined,
    channelName: username || undefined,
    channelUrl: username ? `https://www.instagram.com/${username}/` : undefined,
    channelAvatarUrl: (hdPic?.url as string) ?? (owner?.profile_pic_url as string) ?? undefined,
    publishedAt,
  }
}

/** Extract metadata fields from gallery-dl entries (TikTok) */
function parseTikTokMetadata(entries: GalleryDlEntry[]) {
  // Find the first entry with video data
  const entry = entries.find(e => e.data.id) ?? entries[0]
  if (!entry) return null
  const d = entry.data

  const desc = (d.desc as string) ?? ''
  const firstLine = desc.split('\n').filter(Boolean)[0] ?? ''
  const title = firstLine.substring(0, 200) || String(d.id ?? '')

  const dateStr = (d.date as string) ?? ''
  let publishedAt: string | undefined
  if (dateStr) {
    const parsed = new Date(dateStr)
    if (!isNaN(parsed.getTime())) publishedAt = parsed.toISOString()
  } else if (d.createTime) {
    const ts = typeof d.createTime === 'string' ? parseInt(d.createTime, 10) : (d.createTime as number)
    publishedAt = new Date(ts * 1000).toISOString()
  }

  const author = d.author as Record<string, unknown> | undefined
  const uniqueId = (author?.uniqueId as string) ?? ''
  const video = d.video as Record<string, unknown> | undefined
  const stats = d.stats as Record<string, unknown> | undefined

  const playCount = stats?.playCount
  const diggCount = stats?.diggCount
  const viewCount = typeof playCount === 'number' ? playCount : (typeof playCount === 'string' ? parseInt(playCount, 10) : undefined)
  const likeCount = typeof diggCount === 'number' ? diggCount : (typeof diggCount === 'string' ? parseInt(diggCount, 10) : undefined)

  return {
    title,
    duration: (video?.duration as number) ?? undefined,
    viewCount,
    likeCount,
    thumbnailUrl: (video?.cover as string) ?? undefined,
    channelName: uniqueId || undefined,
    channelUrl: uniqueId ? `https://www.tiktok.com/@${uniqueId}` : undefined,
    channelAvatarUrl: (author?.avatarLarger as string) ?? undefined,
    publishedAt,
  }
}

export async function executeMetadata(
  ctx: VideoCrawlStageContext,
  item: VideoCrawlWorkItem,
): Promise<VideoCrawlStageResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-metadata-'))

  try {
    const platform = detectPlatform(item.externalUrl)

    // Step 1: Get metadata — platform-specific
    interface ParsedMetadata {
      title: string | undefined
      duration: number | undefined
      viewCount: number | undefined
      likeCount: number | undefined
      thumbnailUrl: string | undefined
      channelName: string | undefined
      channelUrl: string | undefined
      channelAvatarUrl: string | undefined
      publishedAt: string | undefined
    }
    let meta: ParsedMetadata | null

    if (platform === 'youtube') {
      const metadataJson = await runYtDlpMetadata(item.externalUrl, ctx)
      const metadata = JSON.parse(metadataJson) as Record<string, unknown>
      meta = parseYouTubeMetadata(metadata)
    } else {
      // Instagram/TikTok: gallery-dl with cookies
      const cookies = await getCookies(ctx.payload, platform)
      if (!cookies) {
        ctx.log.warn(`No ${platform} cookies configured in Crawler Settings`)
      }

      const entries = await runGalleryDl({
        url: item.externalUrl,
        cookies,
        platform,
        logger: ctx.log,
      })

      meta = platform === 'instagram'
        ? parseInstagramMetadata(entries)
        : parseTikTokMetadata(entries)
    }

    if (!meta) {
      throw new Error(`No metadata returned from ${platform} for ${item.externalUrl}`)
    }

    const title = meta.title ?? item.title
    const { duration, viewCount, likeCount, thumbnailUrl, publishedAt } = meta
    let channelName = meta.channelName
    let channelUrl = meta.channelUrl
    let channelAvatarUrl: string | undefined = meta.channelAvatarUrl

    // Fetch avatar via og:image if not provided directly
    if (!channelAvatarUrl && channelUrl) {
      channelAvatarUrl = await fetchChannelAvatarUrl(channelUrl)
    }

    await ctx.heartbeat()

    // Step 2: Resolve/create channel + creator (required — channel is NOT NULL on videos)
    let channelId: number | undefined
    if (channelUrl) {
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

        let channelImageId: number | undefined
        if (channelAvatarUrl) {
          try {
            const avatarRes = await fetch(channelAvatarUrl)
            if (avatarRes.ok) {
              const buffer = Buffer.from(await avatarRes.arrayBuffer())
              const contentType = avatarRes.headers.get('content-type') || 'image/jpeg'
              const ext = contentType.includes('png') ? 'png' : 'jpg'
              const avatarPath = path.join(tmpDir, `${crypto.randomUUID()}.${ext}`)
              fs.writeFileSync(avatarPath, buffer)
              channelImageId = await ctx.uploadMedia(avatarPath, 'avatar', contentType, 'profile-media')
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
          const thumbPath = path.join(tmpDir, `${crypto.randomUUID()}.${ext}`)
          fs.writeFileSync(thumbPath, buffer)
          thumbnailMediaId = await ctx.uploadMedia(thumbPath, 'thumbnail', contentType, 'video-media')
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
      await ctx.payload.update({
        collection: 'videos',
        id: item.videoId,
        data: videoData,
      })
      videoId = item.videoId
    } else {
      const newVideo = await ctx.payload.create({
        collection: 'videos',
        data: {
          ...videoData,
          externalUrl: item.externalUrl,
        },
      }) as { id: number }
      videoId = newVideo.id
    }

    ctx.log.info('Video metadata stage complete', { videoId, title, platform })

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
