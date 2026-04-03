/**
 * Instagram video discovery driver via gallery-dl.
 *
 * Uses gallery-dl with cookies and proxy to fetch reel metadata
 * from Instagram profiles. Cookie content is read from crawler-settings.
 */

import type { VideoDiscoveryDriver, DiscoveredVideo, VideoDiscoveryPageOptions, VideoDiscoveryPageResult } from '../types'
import { runGalleryDl, getCookies, type GalleryDlEntry } from './gallery-dl'
import { createLogger } from '@/lib/logger'

const log = createLogger('Instagram')

/**
 * Map gallery-dl Instagram entries to DiscoveredVideo[].
 *
 * gallery-dl outputs two entry types per post:
 * - index=2 (no URL): post-level metadata
 * - index=3 (with URL): media file metadata with richer fields (display_url, video_url, owner)
 *
 * We use index=3 entries (media entries) which have the richest data.
 * For posts with multiple media (carousels), we only take video entries (extension=mp4).
 */
function parseEntries(entries: GalleryDlEntry[]): DiscoveredVideo[] {
  const videos: DiscoveredVideo[] = []
  const seenIds = new Set<string>()

  for (const entry of entries) {
    const d = entry.data

    // Accept both metadata entries (index=2, no URL) and media entries (index=3, with URL)
    // With --no-download, gallery-dl may output both or just metadata entries
    // Filter to reels/videos only
    const isReel = d.type === 'reel' || d.subcategory === 'reels'
    const isVideo = d.extension === 'mp4' || isReel
    if (!isVideo) continue

    const postId = String(d.post_id ?? d.media_id ?? '')
    if (!postId || seenIds.has(postId)) continue
    seenIds.add(postId)

    // Title: first line of description, capped at 200 chars
    const description = (d.description as string) ?? ''
    const firstLine = description.split('\n').filter(Boolean)[0] ?? ''
    const title = firstLine.substring(0, 200) || (d.post_shortcode as string) || postId

    // Upload date: "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"
    const postDate = (d.post_date as string) ?? (d.date as string) ?? ''
    const uploadDate = postDate ? postDate.substring(0, 10) : undefined
    const timestamp = postDate ? new Date(postDate).getTime() / 1000 : undefined

    // Channel avatar: try HD first, then regular profile pic
    const owner = d.owner as Record<string, unknown> | undefined
    const hdPic = owner?.hd_profile_pic_url_info as Record<string, unknown> | undefined
    const channelAvatarUrl = (hdPic?.url as string)
      ?? (owner?.profile_pic_url as string)
      ?? undefined

    const username = (d.username as string) ?? ''

    videos.push({
      externalId: postId,
      title,
      description: description || undefined,
      thumbnailUrl: (d.display_url as string) ?? undefined,
      externalUrl: (d.post_url as string) ?? `https://www.instagram.com/reel/${d.post_shortcode}/`,
      uploadDate,
      timestamp,
      duration: undefined, // Not available in gallery-dl Instagram output
      viewCount: undefined, // Not available
      likeCount: (d.likes as number) ?? undefined,
      channelName: username || undefined,
      channelUrl: username ? `https://www.instagram.com/${username}/` : undefined,
      channelAvatarUrl,
    })
  }

  return videos
}

export const instagramDriver: VideoDiscoveryDriver = {
  slug: 'instagram',
  label: 'Instagram',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.instagram.com' || hostname === 'instagram.com'
    } catch {
      return false
    }
  },

  async discoverVideoPage(channelUrl: string, options: VideoDiscoveryPageOptions): Promise<VideoDiscoveryPageResult> {
    const { startIndex, endIndex, dateLimit, logger, payload } = options
    const requestedCount = endIndex - startIndex + 1

    // Fetch cookie content from crawler-settings
    const cookies = await getCookies(payload, 'instagram')
    if (!cookies) {
      log.warn('No Instagram cookies configured in Crawler Settings')
      logger?.event('video_discovery.gallery_dl_no_cookies', { platform: 'instagram' })
    }

    // Emit started event
    logger?.event('video_discovery.gallery_dl_started', {
      channelUrl,
      platform: 'instagram',
      hasCookies: !!cookies,
      hasProxy: !!process.env.PROXY_URL,
      range: requestedCount,
    })

    const startMs = Date.now()

    let entries: GalleryDlEntry[]
    try {
      entries = await runGalleryDl({
        url: channelUrl,
        cookies,
        range: requestedCount,
        dateLimit,
        platform: 'instagram',
        logger,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      const durationMs = Date.now() - startMs
      logger?.event('video_discovery.gallery_dl_failed', { channelUrl, platform: 'instagram', error, durationMs })
      throw e
    }

    const videos = parseEntries(entries)
    const durationMs = Date.now() - startMs

    log.info('Instagram discovery complete', { returned: videos.length, requested: requestedCount, durationMs })
    logger?.event('video_discovery.gallery_dl_completed', {
      channelUrl,
      platform: 'instagram',
      videoCount: videos.length,
      entriesTotal: entries.length,
      durationMs,
    })

    return {
      videos,
      reachedEnd: videos.length < requestedCount,
    }
  },
}
