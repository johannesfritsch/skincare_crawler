/**
 * TikTok video discovery driver via Apify API.
 *
 * Fetches video metadata from completed Apify TikTok scraper runs.
 * The actor is scheduled externally in Apify — this driver only reads results.
 *
 * TikTok videos are stored in the run's KV store (not in the dataset items).
 * Key pattern: video-{username}-{datetime}-{videoId}.mp4
 */

import type { VideoDiscoveryDriver, VideoDiscoveryPageOptions, VideoDiscoveryPageResult, DiscoveredVideo } from '../types'
import { getLatestRun, fetchDatasetItems, log } from './apify-client'

// Hardcoded — field mapping is tightly coupled to this actor's output schema
// Apify API uses tilde (~) separator in actor IDs: owner~name
const ACTOR_ID = 'clockworks~free-tiktok-scraper'

/** TikTok Apify items use dot-notation flat keys */
interface TikTokItem {
  'authorMeta.avatar': string
  'authorMeta.name': string
  'text': string
  'diggCount': number
  'shareCount': number
  'playCount': number
  'commentCount': number
  'collectCount': number
  'videoMeta.duration': number
  'musicMeta.musicName': string
  'musicMeta.musicAuthor': string
  'musicMeta.musicOriginal': boolean
  'createTimeISO': string
  'webVideoUrl': string
}

function extractUsername(channelUrl: string): string {
  // https://www.tiktok.com/@xskincare → xskincare
  const match = channelUrl.match(/tiktok\.com\/@([^/?]+)/)
  return match ? match[1].toLowerCase() : ''
}

function extractVideoId(webVideoUrl: string): string {
  // https://www.tiktok.com/@xskincare/video/7621286083967454496 → 7621286083967454496
  const match = webVideoUrl.match(/\/video\/(\d+)/)
  return match ? match[1] : webVideoUrl
}

function mapToDiscoveredVideo(item: TikTokItem): DiscoveredVideo {
  const text = item.text || ''
  const captionLines = text.split('\n').filter(Boolean)
  const title = captionLines[0]?.substring(0, 200) || extractVideoId(item.webVideoUrl)
  const username = item['authorMeta.name']

  return {
    externalId: extractVideoId(item.webVideoUrl),
    title,
    description: text || undefined,
    externalUrl: item.webVideoUrl,
    thumbnailUrl: undefined, // Not available in TikTok dataset items
    timestamp: item.createTimeISO ? new Date(item.createTimeISO).getTime() / 1000 : undefined,
    uploadDate: item.createTimeISO || undefined,
    duration: item['videoMeta.duration'] || undefined,
    viewCount: item.playCount || undefined,
    likeCount: item.diggCount || undefined,
    channelName: username || undefined,
    channelUrl: username ? `https://www.tiktok.com/@${username}` : undefined,
    channelAvatarUrl: item['authorMeta.avatar'] || undefined,
  }
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

  async discoverVideoPage(
    channelUrl: string,
    options: VideoDiscoveryPageOptions,
  ): Promise<VideoDiscoveryPageResult> {
    const username = extractUsername(channelUrl)
    if (!username) {
      throw new Error(`Could not extract TikTok username from URL: ${channelUrl}`)
    }

    log.info('Fetching TikTok videos from Apify', { username, startIndex: options.startIndex, endIndex: options.endIndex })

    // Get latest successful run
    const run = await getLatestRun(ACTOR_ID)
    log.info('Using Apify run', {
      runId: run.id,
      finishedAt: run.finishedAt,
      datasetId: run.defaultDatasetId,
      kvStoreId: run.defaultKeyValueStoreId,
    })

    // Fetch all items from the dataset
    const batchSize = 1000
    let offset = 0
    const allItems: TikTokItem[] = []

    while (true) {
      const items = await fetchDatasetItems<TikTokItem>(run.defaultDatasetId, offset, batchSize)
      if (items.length === 0) break
      allItems.push(...items)
      if (items.length < batchSize) break
      offset += batchSize
    }

    // Filter to videos from the requested channel
    const channelVideos = allItems.filter(item =>
      item['authorMeta.name']?.toLowerCase() === username,
    )

    // Sort by timestamp descending (newest first)
    channelVideos.sort((a, b) => {
      const ta = a.createTimeISO ? new Date(a.createTimeISO).getTime() : 0
      const tb = b.createTimeISO ? new Date(b.createTimeISO).getTime() : 0
      return tb - ta
    })

    // Apply index range (1-based)
    const startIdx = options.startIndex - 1
    const endIdx = options.endIndex
    const slice = channelVideos.slice(startIdx, endIdx)
    const requestedCount = endIdx - startIdx

    const videos = slice.map(mapToDiscoveredVideo)
    const reachedEnd = slice.length < requestedCount

    log.info('TikTok discovery page', {
      username,
      totalInDataset: allItems.length,
      channelVideos: channelVideos.length,
      returned: videos.length,
      reachedEnd,
    })

    return { videos, reachedEnd }
  },
}

/**
 * Get the KV store ID from the latest TikTok actor run.
 * Needed by the crawl handler to download video files.
 */
export async function getTikTokKvStoreId(): Promise<string> {
  const run = await getLatestRun(ACTOR_ID)
  return run.defaultKeyValueStoreId
}
