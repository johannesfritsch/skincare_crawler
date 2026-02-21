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
}

export interface VideoDiscoveryDriver {
  slug: string
  label: string

  matches(url: string): boolean

  discoverVideos(channelUrl: string): Promise<DiscoveredVideo[]>
}
