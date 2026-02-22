import type { CategoryDiscoveryDriver, DiscoverOptions, DriverProgress, QueueItem } from '../types'
import { launchBrowser } from '@/lib/browser'
import { createLogger } from '@/lib/logger'

const log = createLogger('Rossmann:CategoryDiscovery')

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Strip trailing " (123)" product counts and collapse whitespace */
function cleanCategoryName(raw: string): string {
  return raw.replace(/\s*\(\d+\)\s*$/, '').replace(/\s+/g, ' ').trim()
}

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

  async discoverCategories(options: DiscoverOptions): Promise<DriverProgress> {
    const { url, onCategory, onError, onProgress, progress, maxPages } = options
    log.info(`Starting for ${url}`)

    const visitedUrls = new Set<string>(progress?.visitedUrls ?? [])
    const queue: QueueItem[] = progress?.queue?.length
      ? [...progress.queue]
      : [{ url, parentPath: [] }]

    let pagesVisited = 0
    const browser = await launchBrowser()

    try {
      const page = await browser.newPage()

      while (queue.length > 0) {
        if (maxPages !== undefined && pagesVisited >= maxPages) break

        const item = queue.shift()!
        const canonicalUrl = item.url.startsWith('http')
          ? item.url
          : `https://www.rossmann.de${item.url}`

        if (visitedUrls.has(canonicalUrl)) continue
        visitedUrls.add(canonicalUrl)
        pagesVisited++

        try {
          log.info(`Visiting: ${canonicalUrl}`)
          await page.goto(canonicalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
          await page.waitForSelector('nav[data-testid="category-nav-desktop"]', { timeout: 10000 }).catch(() => {})
          await sleep(randomDelay(500, 1500))

          // On the first page of a fresh start, extract ancestors from breadcrumb HTML
          let effectiveParentPath = item.parentPath
          if (item.parentPath.length === 0 && !progress?.queue?.length) {
            try {
              const breadcrumbLinks = await page.$$eval(
                '[data-testid="category-breadcrumbs"] li a',
                (links) => links.map((a) => ({
                  href: a.getAttribute('href') || '',
                  text: a.textContent?.trim() || '',
                })),
              )

              if (breadcrumbLinks.length > 2) {
                const ancestorLinks = breadcrumbLinks.slice(1, -1)
                const ancestorPath: string[] = []
                for (const link of ancestorLinks) {
                  ancestorPath.push(link.text)
                  const ancestorUrl = link.href.startsWith('http')
                    ? link.href
                    : `https://www.rossmann.de${link.href}`
                  await onCategory({
                    url: ancestorUrl,
                    name: link.text,
                    path: [...ancestorPath],
                  })
                }
                effectiveParentPath = ancestorPath
              }
            } catch (e) {
              log.info(`Failed to extract breadcrumb, using empty path: ${e}`)
            }
          }

          // Get category name
          const h1Raw = await page.$eval('h1', (el) => el.textContent?.trim() || '').catch(() => '')
          const categoryName = cleanCategoryName(item.nameFromParent || h1Raw || canonicalUrl)
          const fullPath = [...effectiveParentPath, categoryName]

          // Emit this category
          await onCategory({
            url: canonicalUrl,
            name: categoryName,
            path: fullPath,
          })

          // Leaf detection
          const isLeaf = await page.$('nav[data-testid="category-nav-desktop"] ul li a.font-bold') !== null

          if (!isLeaf) {
            // Non-leaf: extract children and add to queue (BFS)
            const children = await page.$$eval(
              'nav[data-testid="category-nav-desktop"] ul li a',
              (links) => links.map((a) => ({
                href: a.getAttribute('href') || '',
                text: a.textContent?.trim() || '',
              })).filter((c) => c.href),
            )

            if (children.length > 0) {
              log.info(`${children.length} children under ${categoryName}`)
              for (const child of children) {
                const childUrl = child.href.startsWith('http')
                  ? child.href
                  : `https://www.rossmann.de${child.href}`
                queue.push({
                  url: childUrl,
                  parentPath: fullPath,
                  nameFromParent: cleanCategoryName(child.text),
                })
              }
            } else {
              log.info(`No child links on ${canonicalUrl}, treating as leaf`)
            }
          } else {
            log.info(`Leaf: ${fullPath.join(' > ')}`)
          }

          // Persist progress after each page is fully processed
          await onProgress?.({ visitedUrls: [...visitedUrls], queue: [...queue] })
        } catch (e) {
          log.warn(`Error visiting ${canonicalUrl}, skipping: ${e}`)
          onError?.(canonicalUrl)
          await onProgress?.({ visitedUrls: [...visitedUrls], queue: [...queue] })
        }
      }
    } finally {
      await browser.close()
    }

    log.info(`Tick done: ${pagesVisited} pages visited, ${queue.length} remaining in queue`)
    return { visitedUrls: [...visitedUrls], queue }
  },
}
