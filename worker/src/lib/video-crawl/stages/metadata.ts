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
import { execSync } from 'child_process'
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

/** Extract normalized video metadata from any platform */
interface VideoMetadata {
  title: string
  duration?: number
  viewCount?: number
  likeCount?: number
  publishedAt?: string
  thumbnailUrl?: string
  channelName?: string
  channelUrl?: string
  channelAvatarUrl?: string
}

async function fetchMetadataFromApify(url: string, platform: 'instagram' | 'tiktok', fallbackTitle: string): Promise<VideoMetadata> {
  if (platform === 'instagram') {
    const { fetchInstagramItemByUrl } = await import('@/lib/video-discovery/drivers/instagram')
    const item = await fetchInstagramItemByUrl(url)
    if (!item) throw new Error(`Instagram video not found in Apify dataset: ${url}`)

    const captionLines = (item.caption || '').split('\n').filter(Boolean)
    return {
      title: captionLines[0]?.substring(0, 200) || fallbackTitle,
      duration: item.videoDuration || undefined,
      viewCount: item.videoViewCount || item.videoPlayCount || undefined,
      likeCount: item.likesCount || undefined,
      publishedAt: item.timestamp || undefined,
      thumbnailUrl: item.displayUrl || undefined,
      channelName: item.ownerUsername || undefined,
      channelUrl: `https://www.instagram.com/${item.ownerUsername}/`,
      channelAvatarUrl: undefined, // Not available on post items
    }
  } else {
    const { fetchTikTokItemByUrl, getTikTokThumbnailUrl } = await import('@/lib/video-discovery/drivers/tiktok')
    const item = await fetchTikTokItemByUrl(url)
    if (!item) throw new Error(`TikTok video not found in Apify dataset: ${url}`)

    // Handle both dot-notation flat keys and nested object keys
    const raw = item as unknown as Record<string, unknown>
    const authorMeta = raw['authorMeta'] as Record<string, string> | undefined
    const videoMeta = raw['videoMeta'] as Record<string, number> | undefined
    const text = (raw.text ?? item.text ?? '') as string
    const textLines = text.split('\n').filter(Boolean)
    const username = (item['authorMeta.name'] ?? authorMeta?.name ?? '') as string
    const avatar = (item['authorMeta.avatar'] ?? authorMeta?.avatar ?? '') as string
    const duration = (item['videoMeta.duration'] ?? videoMeta?.duration ?? undefined) as number | undefined

    // Fallback: extract username from URL if not in dataset
    const usernameFromUrl = url.match(/tiktok\.com\/@([^/]+)/)?.[1]
    const effectiveUsername = username || usernameFromUrl || ''

    return {
      title: textLines[0]?.substring(0, 200) || fallbackTitle,
      duration,
      viewCount: (raw.playCount ?? item.playCount ?? undefined) as number | undefined,
      likeCount: (raw.diggCount ?? item.diggCount ?? undefined) as number | undefined,
      publishedAt: (raw.createTimeISO ?? item.createTimeISO ?? undefined) as string | undefined,
      thumbnailUrl: await getTikTokThumbnailUrl(url) ?? undefined,
      channelName: effectiveUsername || undefined,
      channelUrl: effectiveUsername ? `https://www.tiktok.com/@${effectiveUsername}` : undefined,
      channelAvatarUrl: avatar || undefined,
    }
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
    let title: string
    let duration: number | undefined
    let viewCount: number | undefined
    let likeCount: number | undefined
    let publishedAt: string | undefined
    let thumbnailUrl: string | undefined
    let channelName: string | undefined
    let channelUrl: string | undefined
    let channelAvatarUrl: string | undefined

    if (platform === 'instagram' || platform === 'tiktok') {
      const meta = await fetchMetadataFromApify(item.externalUrl, platform, item.title)
      title = meta.title
      duration = meta.duration
      viewCount = meta.viewCount
      likeCount = meta.likeCount
      publishedAt = meta.publishedAt
      thumbnailUrl = meta.thumbnailUrl
      channelName = meta.channelName
      channelUrl = meta.channelUrl
      channelAvatarUrl = meta.channelAvatarUrl
    } else {
      // YouTube: use yt-dlp
      const metadataJson = execSync(
        `yt-dlp --dump-json --no-download ${JSON.stringify(item.externalUrl)}`,
        { timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
      ).toString('utf-8')
      const metadata = JSON.parse(metadataJson) as Record<string, unknown>

      title = (metadata.title as string) ?? item.title
      duration = (metadata.duration as number) ?? undefined
      viewCount = (metadata.view_count as number) ?? undefined
      likeCount = (metadata.like_count as number) ?? undefined
      thumbnailUrl = (metadata.thumbnail as string) ?? undefined
      channelName = (metadata.channel as string) ?? (metadata.uploader as string) ?? undefined
      channelUrl = (metadata.channel_url as string) ?? undefined
      channelAvatarUrl = (metadata.channel_thumbnail_url as string) ?? undefined

      // yt-dlp returns YYYYMMDD format
      const uploadDate = metadata.upload_date as string | undefined
      if (uploadDate && /^\d{8}$/.test(uploadDate)) {
        publishedAt = new Date(
          `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`,
        ).toISOString()
      }
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
