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

export async function executeMetadata(
  ctx: VideoCrawlStageContext,
  item: VideoCrawlWorkItem,
): Promise<VideoCrawlStageResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-metadata-'))

  try {
    // Step 1: Get metadata via yt-dlp --dump-json (no download)
    const metadataJson = execSync(
      `yt-dlp --dump-json --no-download ${JSON.stringify(item.externalUrl)}`,
      { timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
    ).toString('utf-8')
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>

    const title = (metadata.title as string) ?? item.title
    const duration = (metadata.duration as number) ?? undefined
    const viewCount = (metadata.view_count as number) ?? undefined
    const likeCount = (metadata.like_count as number) ?? undefined
    const uploadDate = metadata.upload_date as string | undefined
    const thumbnailUrl = (metadata.thumbnail as string) ?? undefined
    const channelName = (metadata.channel as string) ?? (metadata.uploader as string) ?? undefined
    const channelUrl = (metadata.channel_url as string) ?? undefined

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
        const channelAvatarUrl = metadata.channel_thumbnail_url as string | undefined
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

        // Determine platform
        let platform: 'youtube' | 'instagram' | 'tiktok' = 'youtube'
        try {
          const host = new URL(channelUrl).hostname.toLowerCase()
          if (host.includes('instagram')) platform = 'instagram'
          else if (host.includes('tiktok')) platform = 'tiktok'
        } catch { /* default youtube */ }

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
      throw new Error(`Could not resolve channel for video ${item.externalUrl} — yt-dlp returned no channel_url`)
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

    // Step 4: Build publishedAt
    let publishedAt: string | undefined
    if (uploadDate && /^\d{8}$/.test(uploadDate)) {
      // yt-dlp returns YYYYMMDD format
      publishedAt = new Date(
        `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`,
      ).toISOString()
    }

    // Step 5: Create or update video record with metadata — NOT videoFile/audioFile
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
