import type { CategoryDiscoveryDriver, DiscoveredCategory } from '../types'

export const dmDriver: CategoryDiscoveryDriver = {
  slug: 'dm',
  label: 'DM',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.dm.de' || hostname === 'dm.de'
    } catch {
      return false
    }
  },

  async discoverCategories(_url: string): Promise<DiscoveredCategory[]> {
    throw new Error('DM category discovery is not yet implemented')
  },
}
