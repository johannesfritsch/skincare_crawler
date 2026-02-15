export interface DiscoveredCategory {
  url: string
  name: string      // human-readable name from link text
  path: string[]    // names from root to this category, e.g. ['Pflege', 'Koerperpflege']
}

export interface CategoryDiscoveryDriver {
  slug: string
  label: string
  matches(url: string): boolean
  discoverCategories(url: string): Promise<DiscoveredCategory[]>
}
