import type { CategoryDiscoveryDriver, DiscoveredCategory } from '../types'
import { launchBrowser } from '@/lib/browser'

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

  async discoverCategories(url: string): Promise<DiscoveredCategory[]> {
    console.log(`[Rossmann CategoryDiscovery] Starting for ${url}`)

    const browser = await launchBrowser()
    const allCategories: DiscoveredCategory[] = []
    const seenUrls = new Set<string>()

    try {
      const page = await browser.newPage()

      async function walkCategory(
        pageUrl: string,
        parentPath: string[],
        nameFromParent?: string,
      ): Promise<void> {
        console.log(`[Rossmann CategoryDiscovery] Visiting: ${pageUrl}`)
        await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        // Wait for category nav to render (present on both leaf and non-leaf pages)
        await page.waitForSelector('nav[data-testid="category-nav-desktop"]', { timeout: 10000 }).catch(() => {})
        await sleep(randomDelay(500, 1500))

        // Get category name from h1 heading on the page, or use name passed from parent
        const h1Raw = await page.$eval('h1', (el) => el.textContent?.trim() || '').catch(() => '')
        const categoryName = cleanCategoryName(nameFromParent || h1Raw || pageUrl)

        const fullPath = [...parentPath, categoryName]

        // Record this category
        const canonicalUrl = pageUrl.startsWith('http')
          ? pageUrl
          : `https://www.rossmann.de${pageUrl}`
        if (!seenUrls.has(canonicalUrl)) {
          seenUrls.add(canonicalUrl)
          allCategories.push({
            url: canonicalUrl,
            name: categoryName,
            path: fullPath,
          })
        }

        // Leaf detection: check if any nav link has font-bold class (indicates current/selected)
        const isLeaf = await page.$('nav[data-testid="category-nav-desktop"] ul li a.font-bold') !== null

        if (isLeaf) {
          console.log(`[Rossmann CategoryDiscovery] Leaf: ${fullPath.join(' > ')}`)
          return
        }

        // Non-leaf: extract child links + text and recurse
        const children = await page.$$eval(
          'nav[data-testid="category-nav-desktop"] ul li a',
          (links) => links.map((a) => ({
            href: a.getAttribute('href') || '',
            text: a.textContent?.trim() || '',
          })).filter((c) => c.href),
        )

        if (children.length === 0) {
          console.log(`[Rossmann CategoryDiscovery] No child links on ${pageUrl}, treating as leaf`)
          return
        }

        console.log(`[Rossmann CategoryDiscovery] ${children.length} children under ${categoryName}`)
        for (const child of children) {
          const childUrl = child.href.startsWith('http')
            ? child.href
            : `https://www.rossmann.de${child.href}`
          await walkCategory(childUrl, fullPath, cleanCategoryName(child.text))
        }
      }

      await walkCategory(url, [])
    } finally {
      await browser.close()
    }

    console.log(`[Rossmann CategoryDiscovery] Done: ${allCategories.length} categories`)
    return allCategories
  },
}
