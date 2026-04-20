export interface DiscoveredGallery {
  externalId: string
  title: string
  caption?: string
  thumbnailUrl?: string
  externalUrl: string
  publishedAt?: string
  timestamp?: number
  likeCount?: number
  commentCount?: number
  channelName?: string
  channelUrl?: string
  channelAvatarUrl?: string
  imageCount: number
}

export interface GalleryDiscoveryPageOptions {
  /** 1-based start index into the post list (maps to gallery-dl --post-range) */
  startIndex: number
  /** 1-based end index into the post list */
  endIndex: number
  /** Only discover galleries newer than this (e.g. "5 days", "2 weeks", "1 month") */
  dateLimit?: string
  /** Optional job-scoped logger for emitting events */
  logger?: import('@/lib/logger').Logger
  /** Optional REST client for reading crawler-settings (cookie paths, etc.) */
  payload?: import('@/lib/payload-client').PayloadRestClient
}

export interface GalleryDiscoveryPageResult {
  galleries: DiscoveredGallery[]
  /** True if the driver returned fewer galleries than the range requested (i.e. we've hit the end) */
  reachedEnd: boolean
}

export interface GalleryDiscoveryDriver {
  slug: string
  label: string

  matches(url: string): boolean

  /** Fetch a page (range) of galleries from the channel. */
  discoverGalleryPage(channelUrl: string, options: GalleryDiscoveryPageOptions): Promise<GalleryDiscoveryPageResult>
}
