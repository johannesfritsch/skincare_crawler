export interface DiscoveredCategory {
  url: string
  name: string // human-readable name from link text
  path: string[] // names from root to this category, e.g. ['Pflege', 'Koerperpflege']
}

export interface QueueItem {
  url: string
  parentPath: string[]
  nameFromParent?: string
}

export interface DriverProgress {
  visitedUrls: string[]
  queue: QueueItem[]
}

export interface DiscoverOptions {
  url: string
  onCategory: (cat: DiscoveredCategory) => Promise<void>
  onProgress?: (progress: DriverProgress) => Promise<void>
  progress?: DriverProgress
  maxPages?: number
}

export interface CategoryDiscoveryDriver {
  slug: string
  label: string
  matches(url: string): boolean
  discoverCategories(options: DiscoverOptions): Promise<DriverProgress>
}
