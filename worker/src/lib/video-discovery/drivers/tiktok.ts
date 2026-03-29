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
import { getLatestRun, fetchDatasetItems, listKvStoreKeys, getKvRecordUrl, log } from './apify-client'

// Hardcoded — field mapping is tightly coupled to this actor's output schema
// Apify API uses tilde (~) separator in actor IDs: owner~name
const ACTOR_ID = 'clockworks~tiktok-scraper'

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

/**
 * Fetch a single TikTok video item from the latest Apify dataset by its web URL.
 * Used by the video crawl stages to get metadata.
 */
export async function fetchTikTokItemByUrl(videoUrl: string): Promise<TikTokItem | null> {
  const run = await getLatestRun(ACTOR_ID)
  const batchSize = 1000
  let offset = 0
  const videoId = extractVideoId(videoUrl)

  while (true) {
    const items = await fetchDatasetItems<TikTokItem>(run.defaultDatasetId, offset, batchSize)
    if (items.length === 0) break

    for (const item of items) {
      const raw = item as unknown as Record<string, unknown>
      // Try dot-notation key, then direct key
      const itemUrl = (raw['webVideoUrl'] ?? raw.webVideoUrl ?? '') as string
      if (itemUrl === videoUrl || itemUrl.includes(videoId)) return item
    }

    if (items.length < batchSize) break
    offset += batchSize
  }

  log.warn('TikTok item not found in dataset', { videoUrl, videoId, datasetId: run.defaultDatasetId })
  return null
}

/**
 * Find the KV store video download URL for a TikTok video.
 * Videos are stored with key pattern: video-{username}-{datetime}-{videoId}.mp4
 */
export async function getTikTokVideoDownloadUrl(videoUrl: string): Promise<string | null> {
  const videoId = extractVideoId(videoUrl)
  const run = await getLatestRun(ACTOR_ID)
  const storeId = run.defaultKeyValueStoreId

  const keys = await listKvStoreKeys(storeId, 'video-')
  const matchingKey = keys.find(k => k.key.includes(videoId))
  if (!matchingKey) {
    log.warn('No KV store video found for TikTok video', { videoId, storeId, keysChecked: keys.length })
    return null
  }

  return getKvRecordUrl(storeId, matchingKey.key)
}

export type { TikTokItem }

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

    // Debug: log first item's keys and author field to diagnose filtering
    if (allItems.length > 0) {
      const first = allItems[0] as unknown as Record<string, unknown>
      const keys = Object.keys(first)
      log.info('TikTok dataset item debug', {
        itemCount: allItems.length,
        keys: keys.join(', '),
        authorMetaName: String(first['authorMeta.name'] ?? (first['authorMeta'] as Record<string, unknown>)?.name ?? 'MISSING'),
        webVideoUrl: String(first['webVideoUrl'] ?? 'MISSING'),
        sampleValues: keys.slice(0, 5).map(k => `${k}=${String(first[k]).substring(0, 50)}`).join(' | '),
      })
    } else {
      log.warn('TikTok dataset is empty', { datasetId: run.defaultDatasetId })
    }

    // Filter to videos from the requested channel
    // Try both dot-notation key and nested object access
    const channelVideos = allItems.filter(item => {
      const authorName = item['authorMeta.name']
        ?? (item as unknown as Record<string, Record<string, string>>).authorMeta?.name
      return authorName?.toLowerCase() === username
    })

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

/**
 * Find the KV store thumbnail/cover URL for a TikTok video.
 * Covers are stored with key pattern: cover-{username}-{datetime}-{videoId}.jpg (or similar)
 */
export async function getTikTokThumbnailUrl(videoUrl: string): Promise<string | null> {
  const videoId = extractVideoId(videoUrl)
  const run = await getLatestRun(ACTOR_ID)
  const storeId = run.defaultKeyValueStoreId

  const keys = await listKvStoreKeys(storeId, 'cover-')
  const matchingKey = keys.find(k => k.key.includes(videoId))
  if (!matchingKey) {
    log.debug('No KV store cover found for TikTok video', { videoId, storeId })
    return null
  }

  return getKvRecordUrl(storeId, matchingKey.key)
}
