import type { CategoryDiscoveryDriver, DiscoveredCategory } from '../types'

// Navigation tree node shape (matches source discovery driver)
interface NavNode {
  id: string
  title: string
  link: string
  hidden?: boolean
  children?: NavNode[]
}

// Find the subtree matching a target path, returning ancestor nodes along the way
function findSubtreeWithAncestors(
  node: NavNode,
  targetPath: string,
  ancestors: NavNode[] = [],
): { node: NavNode; ancestors: NavNode[] } | null {
  if (node.link === targetPath) return { node, ancestors }
  if (node.children) {
    for (const child of node.children) {
      const found = findSubtreeWithAncestors(child, targetPath, [...ancestors, node])
      if (found) return found
    }
  }
  return null
}

// Collect all non-hidden nodes (both parent and leaf) as DiscoveredCategory[]
function collectAll(node: NavNode, parentPath: string[]): DiscoveredCategory[] {
  if (node.hidden) return []

  const path = [...parentPath, node.title]
  const result: DiscoveredCategory[] = [
    {
      url: `https://www.dm.de${node.link}`,
      name: node.title,
      path,
    },
  ]

  if (node.children) {
    for (const child of node.children) {
      result.push(...collectAll(child, path))
    }
  }

  return result
}

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

  async discoverCategories(url: string): Promise<DiscoveredCategory[]> {
    console.log(`[DM CategoryDiscovery] Starting for ${url}`)

    const targetPath = new URL(url).pathname.replace(/\/$/, '') || '/'
    console.log(`[DM CategoryDiscovery] Target path: ${targetPath}`)

    // Fetch navigation tree (single API call, no browser needed)
    const navRes = await fetch(
      'https://content.services.dmtech.com/rootpage-dm-shop-de-de?view=navigation&mrclx=true',
    )
    if (!navRes.ok) {
      throw new Error(`Failed to fetch DM navigation tree: ${navRes.status}`)
    }
    const navData = await navRes.json()
    const navRoot: NavNode | undefined = navData.navigation
    const navChildren: NavNode[] = navRoot?.children ?? []
    console.log(`[DM CategoryDiscovery] Nav tree: ${navChildren.length} top-level children`)

    // Find the subtree matching the target path (with ancestors)
    let result: { node: NavNode; ancestors: NavNode[] } | null = null
    for (const child of navChildren) {
      result = findSubtreeWithAncestors(child, targetPath)
      if (result) break
    }

    if (!result) {
      // No subtree found — return a single category for the URL itself
      console.log(
        `[DM CategoryDiscovery] No subtree in nav tree for ${targetPath}, returning single category`,
      )
      const name = targetPath
        .split('/')
        .filter(Boolean)
        .map(
          (seg) =>
            seg
              .replace(/-und-/g, ' & ')
              .replace(/-/g, ' ')
              .replace(/\b\w/g, (c) => c.toUpperCase()),
        )
        .pop() || targetPath

      return [{ url, name, path: [name] }]
    }

    const { node: subtree, ancestors } = result
    console.log(
      `[DM CategoryDiscovery] Found subtree: ${subtree.title} (${subtree.id}), ${subtree.children?.length ?? 0} children, ${ancestors.length} ancestors`,
    )

    // Emit ancestor categories (building path incrementally)
    const categories: DiscoveredCategory[] = []
    const ancestorPath: string[] = []
    for (const ancestor of ancestors) {
      if (ancestor.hidden) continue
      ancestorPath.push(ancestor.title)
      categories.push({
        url: `https://www.dm.de${ancestor.link}`,
        name: ancestor.title,
        path: [...ancestorPath],
      })
    }

    // Collect subtree categories with ancestor path as prefix
    categories.push(...collectAll(subtree, ancestorPath))

    for (const cat of categories) {
      console.log(`[DM CategoryDiscovery]   ${cat.path.join(' > ')} -> ${cat.url}`)
    }
    console.log(`[DM CategoryDiscovery] Done: ${categories.length} categories`)
    return categories
  },
}
