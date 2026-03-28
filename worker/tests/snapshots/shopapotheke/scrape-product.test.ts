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

describe('Shop Apotheke driver snapshot: scrapeProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('catrice-sonnen-glow-matt-bronzing-puder', async () => {
    const fixtureSlug = 'catrice-sonnen-glow-matt-bronzing-puder'
    setFixture('shopapotheke', fixtureSlug)

    const { shopApothekeDriver } = await import('@/lib/source-discovery/drivers/shopapotheke/index')

    const result = await shopApothekeDriver.scrapeProduct(
      'https://www.shop-apotheke.com/beauty/upm3ZWKHA/catrice-sonnen-glow-matt-bronzing-puder.htm',
    )

    expect(result).not.toBeNull()

    // Check key structural fields
    expect(result!.name).toBeTypeOf('string')
    expect(result!.name.length).toBeGreaterThan(0)
    expect(result!.images).toBeInstanceOf(Array)
    expect(result!.warnings).toBeInstanceOf(Array)

    // Save or compare against golden snapshot
    const snapshotPath = path.join(FIXTURES_DIR, 'shopapotheke', fixtureSlug, 'expected.snapshot.json')

    if (!existsSync(snapshotPath) || process.env.UPDATE_SNAPSHOTS) {
      writeFileSync(snapshotPath, JSON.stringify(result, null, 2), 'utf-8')
      console.log(`  Saved golden snapshot: ${snapshotPath}`)
    } else {
      const expected = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
      expect(result).toEqual(expected)
    }
  })
})
