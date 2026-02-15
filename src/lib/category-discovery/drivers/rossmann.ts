import type { CategoryDiscoveryDriver, DiscoveredCategory } from '../types'

export const rossmannDriver: CategoryDiscoveryDriver = {
  slug: 'rossmann',
  label: 'Rossmann',

  matches(url: string): boolean {
    try {
      const hostname = new URL(url).hostname.toLowerCase()
      return hostname === 'www.rossmann.de' || hostname === 'rossmann.de'
    } catch {
      return false
    }
  },

  async discoverCategories(_url: string): Promise<DiscoveredCategory[]> {
    throw new Error('Rossmann category discovery is not yet implemented')
  },
}
