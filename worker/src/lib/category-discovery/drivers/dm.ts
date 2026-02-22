import type { CategoryDiscoveryDriver, DiscoverOptions, DriverProgress } from '../types'
import { createLogger } from '@/lib/logger'

const log = createLogger('DM:CategoryDiscovery')

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

  async discoverCategories(options: DiscoverOptions): Promise<DriverProgress> {
    const { url, onCategory, onProgress } = options
    log.info(`Starting for ${url}`)

    const targetPath = new URL(url).pathname.replace(/\/$/, '') || '/'
    log.info(`Target path: ${targetPath}`)

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
    log.info(`Nav tree: ${navChildren.length} top-level children`)

    // Find the subtree matching the target path (with ancestors)
    let result: { node: NavNode; ancestors: NavNode[] } | null = null
    for (const child of navChildren) {
      result = findSubtreeWithAncestors(child, targetPath)
      if (result) break
    }

    if (!result) {
      // No subtree found — return a single category for the URL itself
      log.info(
        `No subtree in nav tree for ${targetPath}, returning single category`,
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

      await onCategory({ url, name, path: [name] })
      await onProgress?.({ visitedUrls: [], queue: [] })
      return { visitedUrls: [], queue: [] }
    }

    const { node: subtree, ancestors } = result
    log.info(
      `Found subtree: ${subtree.title} (${subtree.id}), ${subtree.children?.length ?? 0} children, ${ancestors.length} ancestors`,
    )

    // Emit ancestor categories (building path incrementally)
    const ancestorPath: string[] = []
    for (const ancestor of ancestors) {
      if (ancestor.hidden) continue
      ancestorPath.push(ancestor.title)
      await onCategory({
        url: `https://www.dm.de${ancestor.link}`,
        name: ancestor.title,
        path: [...ancestorPath],
      })
    }

    // Collect subtree categories with ancestor path as prefix
    async function emitAll(node: NavNode, parentPath: string[]): Promise<void> {
      if (node.hidden) return

      const path = [...parentPath, node.title]
      await onCategory({
        url: `https://www.dm.de${node.link}`,
        name: node.title,
        path,
      })

      if (node.children) {
        for (const child of node.children) {
          await emitAll(child, path)
        }
      }
    }

    await emitAll(subtree, ancestorPath)

    await onProgress?.({ visitedUrls: [], queue: [] })
    log.info(`Done`)
    return { visitedUrls: [], queue: [] }
  },
}
