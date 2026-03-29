/**
 * Instagram video discovery driver via Apify API.
 *
 * Fetches video/reel metadata from completed Apify Instagram scraper runs.
 * The actor is scheduled externally in Apify — this driver only reads results.
 */

import type { VideoDiscoveryDriver, VideoDiscoveryPageOptions, VideoDiscoveryPageResult, DiscoveredVideo } from '../types'
import { getLatestRun, fetchDatasetItems, log } from './apify-client'

// Hardcoded — field mapping is tightly coupled to this actor's output schema
// Apify API uses tilde (~) separator in actor IDs: owner~name
const ACTOR_ID = 'apify~instagram-scraper'

interface InstagramItem {
  id: string
  type: string // "Video", "Image", "Sidecar"
  shortCode: string
  caption: string
  url: string
  displayUrl: string
  videoUrl?: string
  timestamp: string
  videoDuration?: number
  videoViewCount?: number
  videoPlayCount?: number
  likesCount: number
  commentsCount: number
  ownerUsername: string
  ownerFullName: string
  ownerId: string
  inputUrl: string
  productType?: string // "clips" for reels
}

function extractUsername(channelUrl: string): string {
  // https://www.instagram.com/xskincare/ → xskincare
  const match = channelUrl.match(/instagram\.com\/([^/?]+)/)
  return match ? match[1].toLowerCase() : ''
}

function mapToDiscoveredVideo(item: InstagramItem): DiscoveredVideo {
  const captionLines = (item.caption || '').split('\n').filter(Boolean)
  const title = captionLines[0]?.substring(0, 200) || item.shortCode

  return {
    externalId: item.id,
    title,
    description: item.caption || undefined,
    externalUrl: item.url,
    thumbnailUrl: item.displayUrl || undefined,
    timestamp: item.timestamp ? new Date(item.timestamp).getTime() / 1000 : undefined,
    uploadDate: item.timestamp || undefined,
    duration: item.videoDuration || undefined,
    viewCount: item.videoViewCount || item.videoPlayCount || undefined,
    likeCount: item.likesCount || undefined,
    channelName: item.ownerUsername || undefined,
    channelUrl: item.inputUrl || `https://www.instagram.com/${item.ownerUsername}/`,
  }
}

/**
 * Fetch a single Instagram video item from the latest Apify dataset by its post URL.
 * Used by the video crawl stages to get metadata and video download URL.
 */
export async function fetchInstagramItemByUrl(videoUrl: string): Promise<InstagramItem | null> {
  const run = await getLatestRun(ACTOR_ID)
  const batchSize = 1000
  let offset = 0

  while (true) {
    const items = await fetchDatasetItems<InstagramItem>(run.defaultDatasetId, offset, batchSize)
    if (items.length === 0) break
    const match = items.find(item => item.url === videoUrl)
    if (match) return match
    if (items.length < batchSize) break
    offset += batchSize
  }

  return null
}

export type { InstagramItem }

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

  async discoverVideoPage(
    channelUrl: string,
    options: VideoDiscoveryPageOptions,
  ): Promise<VideoDiscoveryPageResult> {
    const username = extractUsername(channelUrl)
    if (!username) {
      throw new Error(`Could not extract Instagram username from URL: ${channelUrl}`)
    }

    log.info('Fetching Instagram videos from Apify', { username, startIndex: options.startIndex, endIndex: options.endIndex })

    // Get latest successful run
    const run = await getLatestRun(ACTOR_ID)
    log.info('Using Apify run', { runId: run.id, finishedAt: run.finishedAt, datasetId: run.defaultDatasetId })

    // Fetch all items from the dataset (Apify datasets are typically small enough)
    // Then filter by username and type, and slice by index range
    const batchSize = 1000
    let offset = 0
    const allItems: InstagramItem[] = []

    while (true) {
      const items = await fetchDatasetItems<InstagramItem>(run.defaultDatasetId, offset, batchSize)
      if (items.length === 0) break
      allItems.push(...items)
      if (items.length < batchSize) break
      offset += batchSize
    }

    // Filter to videos from the requested channel
    const channelVideos = allItems.filter(item =>
      item.type === 'Video' &&
      item.ownerUsername?.toLowerCase() === username,
    )

    // Sort by timestamp descending (newest first)
    channelVideos.sort((a, b) => {
      const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0
      const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0
      return tb - ta
    })

    // Apply index range (1-based)
    const startIdx = options.startIndex - 1 // convert to 0-based
    const endIdx = options.endIndex
    const slice = channelVideos.slice(startIdx, endIdx)
    const requestedCount = endIdx - startIdx

    const videos = slice.map(mapToDiscoveredVideo)
    const reachedEnd = slice.length < requestedCount

    log.info('Instagram discovery page', {
      username,
      totalInDataset: allItems.length,
      channelVideos: channelVideos.length,
      returned: videos.length,
      reachedEnd,
    })

    return { videos, reachedEnd }
  },
}
