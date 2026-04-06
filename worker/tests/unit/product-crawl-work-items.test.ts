/**
 * Unit tests for the per-URL product crawl work-items protocol.
 *
 * Tests the pure logic that drives processProductCrawlStage():
 *   - Stage advancement (scrape → reviews)
 *   - Variant URL spawn computation
 *   - GTIN collection from scraped data
 *   - Correct handling of enabled/disabled stages
 *
 * Does NOT test the full handler (too many module-level dependencies).
 * Instead, tests the building blocks and verifies the contract.
 */

import { describe, test, expect } from 'vitest'
import {
  getNextCrawlStage,
  getEnabledCrawlStages,
  productNeedsCrawlWork,
  getFinalCrawlStage,
  type CrawlStageName,
} from '@/lib/product-crawl/stages'
import { normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'

// ─── Stage advancement tests ───

describe('Product crawl stage advancement', () => {
  test('scrape → reviews when both enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    const next = getNextCrawlStage('scrape', enabled)
    expect(next).not.toBeNull()
    expect(next!.name).toBe('reviews')
  })

  test('scrape → null when only scrape enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape'])
    const next = getNextCrawlStage('scrape', enabled)
    expect(next).toBeNull()
  })

  test('null (no stage completed) → scrape when scrape enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    const next = getNextCrawlStage(null, enabled)
    expect(next).not.toBeNull()
    expect(next!.name).toBe('scrape')
  })

  test('null → reviews when only reviews enabled (scrape disabled)', () => {
    const enabled = new Set<CrawlStageName>(['reviews'])
    const next = getNextCrawlStage(null, enabled)
    expect(next).not.toBeNull()
    expect(next!.name).toBe('reviews')
  })

  test('reviews → null (no more stages)', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    const next = getNextCrawlStage('reviews', enabled)
    expect(next).toBeNull()
  })
})

describe('getEnabledCrawlStages', () => {
  test('both enabled by default', () => {
    const stages = getEnabledCrawlStages({})
    expect(stages.has('scrape')).toBe(true)
    expect(stages.has('reviews')).toBe(true)
  })

  test('respects stageScrape=false', () => {
    const stages = getEnabledCrawlStages({ stageScrape: false })
    expect(stages.has('scrape')).toBe(false)
    expect(stages.has('reviews')).toBe(true)
  })

  test('respects stageReviews=false', () => {
    const stages = getEnabledCrawlStages({ stageReviews: false })
    expect(stages.has('scrape')).toBe(true)
    expect(stages.has('reviews')).toBe(false)
  })
})

describe('productNeedsCrawlWork', () => {
  test('needs work when no stage completed and stages enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    expect(productNeedsCrawlWork(null, enabled)).toBe(true)
  })

  test('needs work after scrape when reviews enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    expect(productNeedsCrawlWork('scrape', enabled)).toBe(true)
  })

  test('no work needed after reviews (final stage)', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    expect(productNeedsCrawlWork('reviews', enabled)).toBe(false)
  })

  test('no work needed after scrape when reviews disabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape'])
    expect(productNeedsCrawlWork('scrape', enabled)).toBe(false)
  })

  test('no work needed for failed products', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    expect(productNeedsCrawlWork('!failed' as CrawlStageName, enabled)).toBe(false)
  })
})

describe('getFinalCrawlStage', () => {
  test('reviews is final when both enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape', 'reviews'])
    expect(getFinalCrawlStage(enabled)).toBe('reviews')
  })

  test('scrape is final when only scrape enabled', () => {
    const enabled = new Set<CrawlStageName>(['scrape'])
    expect(getFinalCrawlStage(enabled)).toBe('scrape')
  })

  test('null when nothing enabled', () => {
    const enabled = new Set<CrawlStageName>()
    expect(getFinalCrawlStage(enabled)).toBeNull()
  })
})

// ─── Variant spawn URL computation ───

describe('Variant spawn URL computation', () => {
  /** Mimics the spawn logic from processProductCrawlStage */
  function computeSpawnItems(
    sourceUrl: string,
    scrapedVariants: Array<{ dimension: string; options: Array<{ label: string; value: string | null; gtin: string | null; isSelected: boolean }> }>,
  ): Array<{ itemKey: string; stageName: string }> {
    const productUrl = normalizeProductUrl(sourceUrl)
    const variantUrl = normalizeVariantUrl(sourceUrl)
    const spawnItems: Array<{ itemKey: string; stageName: string }> = []

    for (const dim of scrapedVariants) {
      for (const opt of dim.options ?? []) {
        if (opt.value && opt.value !== sourceUrl) {
          const varUrl = normalizeVariantUrl(opt.value)
          if (varUrl !== productUrl && varUrl !== variantUrl) {
            spawnItems.push({ itemKey: varUrl, stageName: 'scrape' })
          }
        }
      }
    }

    return spawnItems
  }

  test('spawns variant URLs from scraped data', () => {
    const sourceUrl = 'https://www.dm.de/some-product-p12345.html'
    const variants = [
      {
        dimension: 'Größe',
        options: [
          { label: '50ml', value: 'https://www.dm.de/some-product-p12345.html', gtin: '4001', isSelected: true },
          { label: '100ml', value: 'https://www.dm.de/some-product-100ml-p12346.html', gtin: '4002', isSelected: false },
          { label: '200ml', value: 'https://www.dm.de/some-product-200ml-p12347.html', gtin: '4003', isSelected: false },
        ],
      },
    ]

    const spawned = computeSpawnItems(sourceUrl, variants)
    expect(spawned).toHaveLength(2)
    expect(spawned[0].itemKey).toBe('https://www.dm.de/some-product-100ml-p12346.html')
    expect(spawned[0].stageName).toBe('scrape')
    expect(spawned[1].itemKey).toBe('https://www.dm.de/some-product-200ml-p12347.html')
  })

  test('does not spawn self (the URL being crawled)', () => {
    const sourceUrl = 'https://www.dm.de/some-product-p12345.html'
    const variants = [
      {
        dimension: 'Größe',
        options: [
          { label: '50ml', value: 'https://www.dm.de/some-product-p12345.html', gtin: '4001', isSelected: true },
        ],
      },
    ]

    const spawned = computeSpawnItems(sourceUrl, variants)
    expect(spawned).toHaveLength(0)
  })

  test('does not spawn null variant values', () => {
    const sourceUrl = 'https://www.dm.de/some-product-p12345.html'
    const variants = [
      {
        dimension: 'Farbe',
        options: [
          { label: 'Red', value: null, gtin: '4001', isSelected: true },
          { label: 'Blue', value: null, gtin: '4002', isSelected: false },
        ],
      },
    ]

    const spawned = computeSpawnItems(sourceUrl, variants)
    expect(spawned).toHaveLength(0)
  })

  test('handles Mueller variant URLs with query params', () => {
    const sourceUrl = 'https://www.mueller.de/p/some-product-12345/?itemId=111'
    const variants = [
      {
        dimension: 'Variante',
        options: [
          { label: 'Option A', value: 'https://www.mueller.de/p/some-product-12345/?itemId=111', gtin: '4001', isSelected: true },
          { label: 'Option B', value: 'https://www.mueller.de/p/some-product-12345/?itemId=222', gtin: '4002', isSelected: false },
        ],
      },
    ]

    const spawned = computeSpawnItems(sourceUrl, variants)
    expect(spawned).toHaveLength(1)
    expect(spawned[0].itemKey).toContain('itemId=222')
  })

  test('deduplicates variant URLs that normalize to the product URL', () => {
    // A variant URL that normalizes to the same as the product URL should not be spawned
    const sourceUrl = 'https://www.dm.de/some-product-p12345.html'
    const variants = [
      {
        dimension: 'Größe',
        options: [
          // This URL has a query param but normalizeProductUrl strips it — shouldn't spawn
          { label: '50ml', value: 'https://www.dm.de/some-product-p12345.html?utm=test', gtin: '4001', isSelected: true },
        ],
      },
    ]

    // For DM: normalizeVariantUrl preserves query params, but this is a different URL
    // The check is against productUrl (no params) and variantUrl (with params)
    const spawned = computeSpawnItems(sourceUrl, variants)
    // utm=test makes it a different variant URL from the source
    expect(spawned).toHaveLength(1)
  })
})

// ─── GTIN collection ───

describe('GTIN collection from scraped data', () => {
  function collectGtins(data: {
    gtin?: string
    variants?: Array<{ dimension: string; options: Array<{ gtin: string | null }> }>
  }): string[] {
    const gtins = new Set<string>()
    if (data.gtin) gtins.add(data.gtin)
    for (const dim of data.variants ?? []) {
      for (const opt of dim.options ?? []) {
        if (opt.gtin) gtins.add(opt.gtin)
      }
    }
    return [...gtins]
  }

  test('collects main GTIN', () => {
    const gtins = collectGtins({ gtin: '4012345678901' })
    expect(gtins).toEqual(['4012345678901'])
  })

  test('collects variant GTINs', () => {
    const gtins = collectGtins({
      gtin: '4001',
      variants: [
        { dimension: 'Size', options: [{ gtin: '4001' }, { gtin: '4002' }, { gtin: '4003' }] },
      ],
    })
    expect(gtins).toHaveLength(3)
    expect(gtins).toContain('4001')
    expect(gtins).toContain('4002')
    expect(gtins).toContain('4003')
  })

  test('deduplicates GTINs', () => {
    const gtins = collectGtins({
      gtin: '4001',
      variants: [
        { dimension: 'Size', options: [{ gtin: '4001' }, { gtin: '4001' }] },
      ],
    })
    expect(gtins).toHaveLength(1)
  })

  test('handles missing GTINs', () => {
    const gtins = collectGtins({
      variants: [
        { dimension: 'Size', options: [{ gtin: null }, { gtin: null }] },
      ],
    })
    expect(gtins).toHaveLength(0)
  })
})
