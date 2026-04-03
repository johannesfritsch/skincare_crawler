/**
 * TikTok video discovery driver via gallery-dl.
 *
 * Uses gallery-dl with cookies and proxy to fetch video metadata
 * from TikTok profiles. Cookie content is read from crawler-settings.
 *
 * Known limitation: TikTok's API always returns ~235 posts regardless of
 * --chapter-range. We slice the result in code to respect the requested range.
 */

import type { VideoDiscoveryDriver, DiscoveredVideo, VideoDiscoveryPageOptions, VideoDiscoveryPageResult } from '../types'
import { runGalleryDl, getCookies, type GalleryDlEntry } from './gallery-dl'
import { createLogger } from '@/lib/logger'

const log = createLogger('TikTok')

/**
 * Map gallery-dl TikTok entries to DiscoveredVideo[].
 *
 * TikTok entries are [index, data] tuples where index=2 contains the full
 * video metadata (author, stats, video details, etc.).
 */
function parseEntries(entries: GalleryDlEntry[]): DiscoveredVideo[] {
  const videos: DiscoveredVideo[] = []
  const seenIds = new Set<string>()

  for (const entry of entries) {
    const d = entry.data

    // Skip non-video entries (e.g. directory entries)
    if (!d.id && !d.desc) continue

    const videoId = String(d.id ?? '')
    if (!videoId || seenIds.has(videoId)) continue
    seenIds.add(videoId)

    // Title: first line of description, capped at 200 chars
    const desc = (d.desc as string) ?? ''
    const firstLine = desc.split('\n').filter(Boolean)[0] ?? ''
    const title = firstLine.substring(0, 200) || videoId

    // Author info
    const author = d.author as Record<string, unknown> | undefined
    const uniqueId = (author?.uniqueId as string) ?? (d.user as string) ?? ''

    // Upload date: "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"
    const dateStr = (d.date as string) ?? ''
    const uploadDate = dateStr ? dateStr.substring(0, 10) : undefined

    // Timestamp: createTime may be a string or number (unix seconds)
    const createTime = d.createTime
    const timestamp = createTime
      ? typeof createTime === 'string' ? parseInt(createTime, 10) : (createTime as number)
      : undefined

    // Video metadata
    const video = d.video as Record<string, unknown> | undefined
    const duration = (video?.duration as number) ?? undefined
    const cover = (video?.cover as string) ?? undefined

    // Stats
    const stats = d.stats as Record<string, unknown> | undefined
    const playCount = stats?.playCount
    const diggCount = stats?.diggCount
    const viewCount = typeof playCount === 'number' ? playCount : (typeof playCount === 'string' ? parseInt(playCount, 10) : undefined)
    const likeCount = typeof diggCount === 'number' ? diggCount : (typeof diggCount === 'string' ? parseInt(diggCount, 10) : undefined)

    videos.push({
      externalId: videoId,
      title,
      description: desc || undefined,
      thumbnailUrl: cover,
      externalUrl: uniqueId
        ? `https://www.tiktok.com/@${uniqueId}/video/${videoId}`
        : `https://www.tiktok.com/video/${videoId}`,
      uploadDate,
      timestamp,
      duration,
      viewCount,
      likeCount,
      channelName: uniqueId || undefined,
      channelUrl: uniqueId ? `https://www.tiktok.com/@${uniqueId}` : undefined,
      channelAvatarUrl: (author?.avatarLarger as string) ?? undefined,
    })
  }

  return videos
}

export const tiktokDriver: VideoDiscoveryDriver = {
  slug: 'tiktok',
  label: 'TikTok',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.tiktok.com' || hostname === 'tiktok.com'
    } catch {
      return false
    }
  },

  async discoverVideoPage(channelUrl: string, options: VideoDiscoveryPageOptions): Promise<VideoDiscoveryPageResult> {
    const { startIndex, endIndex, dateLimit, logger, payload } = options
    const requestedCount = endIndex - startIndex + 1

    // Fetch cookie content from crawler-settings
    const cookies = await getCookies(payload, 'tiktok')
    if (!cookies) {
      log.warn('No TikTok cookies configured in Crawler Settings')
      logger?.event('video_discovery.gallery_dl_no_cookies', { platform: 'tiktok' })
    }

    // Emit started event
    logger?.event('video_discovery.gallery_dl_started', {
      channelUrl,
      platform: 'tiktok',
      hasCookies: !!cookies,
      hasProxy: !!process.env.PROXY_URL,
      range: endIndex,
    })

    const startMs = Date.now()

    // TikTok always fetches all posts regardless of --chapter-range (known limitation).
    // We request the full range and slice in code.
    let entries: GalleryDlEntry[]
    try {
      entries = await runGalleryDl({
        url: channelUrl,
        cookies,
        range: endIndex, // best-effort limit
        dateLimit,
        platform: 'tiktok',
        logger,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      const durationMs = Date.now() - startMs
      logger?.event('video_discovery.gallery_dl_failed', { channelUrl, platform: 'tiktok', error, durationMs })
      throw e
    }

    const allVideos = parseEntries(entries)

    // Slice to the requested range (1-based indices → 0-based)
    const sliceStart = startIndex - 1
    const videos = allVideos.slice(sliceStart, sliceStart + requestedCount)

    const durationMs = Date.now() - startMs

    log.info('TikTok discovery complete', {
      returned: videos.length,
      requested: requestedCount,
      totalFetched: allVideos.length,
      durationMs,
    })
    logger?.event('video_discovery.gallery_dl_completed', {
      channelUrl,
      platform: 'tiktok',
      videoCount: videos.length,
      entriesTotal: allVideos.length,
      durationMs,
    })

    return {
      videos,
      reachedEnd: videos.length < requestedCount,
    }
  },
}
