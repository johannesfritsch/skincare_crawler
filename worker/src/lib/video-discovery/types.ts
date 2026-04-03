export interface DiscoveredVideo {
  externalId: string
  title: string
  description?: string
  thumbnailUrl?: string
  externalUrl: string
  uploadDate?: string
  timestamp?: number
  duration?: number
  viewCount?: number
  likeCount?: number
  channelName?: string
  channelUrl?: string
  channelAvatarUrl?: string
}

export interface VideoDiscoveryPageOptions {
  /** 1-based start index into the playlist (maps to yt-dlp --playlist-start) */
  startIndex: number
  /** 1-based end index into the playlist (maps to yt-dlp --playlist-end) */
  endIndex: number
  /** Optional job-scoped logger for emitting events */
  logger?: import('@/lib/logger').Logger
  /** Only discover videos newer than this (e.g. "5 days", "2 weeks", "1 month") */
  dateLimit?: string
  /** When true, emit per-line stdout/stderr events for debugging */
  debugMode?: boolean
  /** Optional REST client for reading crawler-settings (cookie paths, etc.) */
  payload?: import('@/lib/payload-client').PayloadRestClient
}

export interface VideoDiscoveryPageResult {
  videos: DiscoveredVideo[]
  /** True if the driver returned fewer videos than the range requested (i.e. we've hit the end) */
  reachedEnd: boolean
}

export interface VideoDiscoveryDriver {
  slug: string
  label: string

  matches(url: string): boolean

  /** Fetch a page (range) of videos from the channel. */
  discoverVideoPage(channelUrl: string, options: VideoDiscoveryPageOptions): Promise<VideoDiscoveryPageResult>
}
