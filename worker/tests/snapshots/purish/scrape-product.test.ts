import { describe, test, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { setFixture, mockStealthFetch } from '../../helpers/mock-stealth-fetch'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures')

// Mock stealthFetch to return recorded fixtures
vi.mock('@/lib/stealth-fetch', () => ({
  stealthFetch: (...args: Parameters<typeof mockStealthFetch>) => mockStealthFetch(...args),
}))

// Mock logger to suppress console output
vi.mock('@/lib/logger', () => ({
  createLogger: () => {
    const noop = () => {}
    const log = { debug: noop, info: noop, warn: noop, error: noop, event: noop, banner: noop, bannerEnd: noop }
    return { ...log, forJob: () => log }
  },
}))

// Mock the driver registry to avoid loading all drivers
vi.mock('@/lib/source-discovery/driver', () => ({
  getAllSourceDrivers: () => [],
  getSourceDriver: () => null,
  getSourceDriverBySlug: () => null,
  ALL_SOURCE_SLUGS: [],
  DEFAULT_IMAGE_SOURCE_PRIORITY: [],
  DEFAULT_BRAND_SOURCE_PRIORITY: [],
}))

describe('PURISH driver snapshot: scrapeProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('nabla-cosmetics-close-up-baking-and-setting-powder-translucent', async () => {
    const fixtureSlug = 'nabla-cosmetics-close-up-baking-and-setting-powder-translucent'
    setFixture('purish', fixtureSlug)

    const { purishDriver } = await import('@/lib/source-discovery/drivers/purish/index')

    const result = await purishDriver.scrapeProduct(
      `https://purish.com/products/${fixtureSlug}`,
    )

    expect(result).not.toBeNull()

    // Check key structural fields
    expect(result!.name).toBeTypeOf('string')
    expect(result!.name.length).toBeGreaterThan(0)
    expect(result!.brandName).toBeTypeOf('string')
    expect(result!.images).toBeInstanceOf(Array)
    expect(result!.images.length).toBeGreaterThan(0)
    expect(result!.priceCents).toBeTypeOf('number')
    expect(result!.warnings).toBeInstanceOf(Array)

    // Save or compare against golden snapshot
    const snapshotPath = path.join(FIXTURES_DIR, 'purish', fixtureSlug, 'expected.snapshot.json')

    if (!existsSync(snapshotPath) || process.env.UPDATE_SNAPSHOTS) {
      writeFileSync(snapshotPath, JSON.stringify(result, null, 2), 'utf-8')
      console.log(`  Saved golden snapshot: ${snapshotPath}`)
    } else {
      const expected = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
      expect(result).toEqual(expected)
    }
  })
})
