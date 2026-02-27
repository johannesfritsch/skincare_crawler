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
