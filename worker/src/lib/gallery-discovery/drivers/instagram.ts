/**
 * Instagram gallery discovery driver via gallery-dl.
 *
 * Uses gallery-dl with cookies and proxy to fetch image/carousel post metadata
 * from Instagram profiles. Cookie content is read from crawler-settings.
 *
 * This is the INVERSE of the video discovery Instagram driver — it accepts
 * non-video posts (images, carousels) and rejects reels/videos.
 */

import type { GalleryDiscoveryDriver, DiscoveredGallery, GalleryDiscoveryPageOptions, GalleryDiscoveryPageResult } from '../types'
import { runGalleryDl, getCookies, type GalleryDlEntry } from '@/lib/video-discovery/drivers/gallery-dl'
import { createLogger } from '@/lib/logger'

const log = createLogger('InstagramGallery')

/**
 * Map gallery-dl Instagram entries to DiscoveredGallery[].
 *
 * gallery-dl outputs two entry types per post:
 * - index=2 (no URL): post-level metadata
 * - index=3 (with URL): media file metadata with richer fields (display_url, video_url, owner)
 *
 * We use index=2 (metadata) entries to get post-level info, then count media entries
 * per post for imageCount.
 *
 * CRITICAL: Inverted filter from the video driver. The video driver filters for
 * isVideo = true. This driver filters for !isVideo — accept non-video posts
 * (images, carousels), reject reels/videos.
 */
function parseEntries(entries: GalleryDlEntry[]): DiscoveredGallery[] {
  const galleries: DiscoveredGallery[] = []
  const seenIds = new Set<string>()

  // Group entries by post_id to count images per post
  const mediaCountByPost = new Map<string, number>()
  for (const entry of entries) {
    const d = entry.data
    const postId = String(d.post_id ?? d.media_id ?? '')
    if (!postId) continue

    // Count non-video media entries (index=3 entries with non-mp4 extension)
    if (entry.url) {
      const isVideo = d.extension === 'mp4' || d.type === 'reel' || d.subcategory === 'reels'
      if (!isVideo) {
        mediaCountByPost.set(postId, (mediaCountByPost.get(postId) ?? 0) + 1)
      }
    }
  }

  for (const entry of entries) {
    const d = entry.data

    // Reject reels/videos — only accept non-video posts
    const isReel = d.type === 'reel' || d.subcategory === 'reels'
    const isVideo = d.extension === 'mp4' || isReel
    if (isVideo) continue

    const postId = String(d.post_id ?? d.media_id ?? '')
    if (!postId || seenIds.has(postId)) continue
    seenIds.add(postId)

    // Title: first line of caption, capped at 200 chars
    const caption = (d.description as string) ?? ''
    const firstLine = caption.split('\n').filter(Boolean)[0] ?? ''
    const title = firstLine.substring(0, 200) || (d.post_shortcode as string) || postId

    // Upload date: "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DD"
    const postDate = (d.post_date as string) ?? (d.date as string) ?? ''
    const publishedAt = postDate ? postDate.substring(0, 10) : undefined
    const timestamp = postDate ? new Date(postDate).getTime() / 1000 : undefined

    // Channel avatar: try HD first, then regular profile pic
    const owner = d.owner as Record<string, unknown> | undefined
    const hdPic = owner?.hd_profile_pic_url_info as Record<string, unknown> | undefined
    const channelAvatarUrl = (hdPic?.url as string)
      ?? (owner?.profile_pic_url as string)
      ?? undefined

    const username = (d.username as string) ?? ''

    // Image count: number of non-video media entries for this post (min 1)
    const imageCount = mediaCountByPost.get(postId) ?? 1

    galleries.push({
      externalId: postId,
      title,
      caption: caption || undefined,
      thumbnailUrl: (d.display_url as string) ?? undefined,
      externalUrl: (d.post_url as string) ?? `https://www.instagram.com/p/${d.post_shortcode}/`,
      publishedAt,
      timestamp,
      likeCount: (d.likes as number) ?? undefined,
      commentCount: (d.comments as number) ?? undefined,
      channelName: username || undefined,
      channelUrl: username ? `https://www.instagram.com/${username}/` : undefined,
      channelAvatarUrl,
      imageCount,
    })
  }

  return galleries
}

export const instagramGalleryDriver: GalleryDiscoveryDriver = {
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

  async discoverGalleryPage(channelUrl: string, options: GalleryDiscoveryPageOptions): Promise<GalleryDiscoveryPageResult> {
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

    const galleries = parseEntries(entries)
    const durationMs = Date.now() - startMs

    log.info('Instagram gallery discovery complete', { returned: galleries.length, requested: requestedCount, durationMs })
    logger?.event('video_discovery.gallery_dl_completed', {
      channelUrl,
      platform: 'instagram',
      videoCount: galleries.length,
      entriesTotal: entries.length,
      durationMs,
    })

    return {
      galleries,
      reachedEnd: galleries.length < requestedCount,
    }
  },
}
