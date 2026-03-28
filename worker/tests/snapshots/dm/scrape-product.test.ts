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

// Mock launchBrowser — DM uses it for brand URL extraction (optional field)
vi.mock('@/lib/browser', () => ({
  launchBrowser: vi.fn().mockRejectedValue(new Error('mocked: no browser in tests')),
}))

// Mock logger to suppress console output
vi.mock('@/lib/logger', () => ({
  createLogger: () => {
    const noop = () => {}
    const log = { debug: noop, info: noop, warn: noop, error: noop, event: noop, banner: noop, bannerEnd: noop }
    return { ...log, forJob: () => log }
  },
}))

// Mock the driver registry to avoid loading all drivers (Playwright deps, etc.)
vi.mock('@/lib/source-discovery/driver', () => ({
  getAllSourceDrivers: () => [],
  getSourceDriver: () => null,
  getSourceDriverBySlug: () => null,
  ALL_SOURCE_SLUGS: [],
  DEFAULT_IMAGE_SOURCE_PRIORITY: [],
  DEFAULT_BRAND_SOURCE_PRIORITY: [],
}))

describe('DM driver snapshot: scrapeProduct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('4066447240092 — babylove Esslernteller', async () => {
    const fixtureSlug = '4066447240092'
    setFixture('dm', fixtureSlug)

    // Import the driver (after mocks are set up)
    const { dmDriver } = await import('@/lib/source-discovery/drivers/dm/index')

    const result = await dmDriver.scrapeProduct(
      `https://www.dm.de/babylove-esslernteller-p${fixtureSlug}.html`,
      { skipReviews: false },
    )

    expect(result).not.toBeNull()

    // Check key structural fields
    expect(result!.gtin).toBe(fixtureSlug)
    expect(result!.name).toBeTypeOf('string')
    expect(result!.name.length).toBeGreaterThan(0)
    expect(result!.brandName).toBeTypeOf('string')
    expect(result!.images).toBeInstanceOf(Array)
    expect(result!.images.length).toBeGreaterThan(0)
    expect(result!.priceCents).toBeTypeOf('number')
    expect(result!.warnings).toBeInstanceOf(Array)

    // brandUrl will be undefined because we mocked launchBrowser
    expect(result!.brandUrl).toBeUndefined()

    // Save or compare against golden snapshot
    const snapshotPath = path.join(FIXTURES_DIR, 'dm', fixtureSlug, 'expected.snapshot.json')

    if (!existsSync(snapshotPath) || process.env.UPDATE_SNAPSHOTS) {
      // First run or explicit update: save the golden snapshot
      writeFileSync(snapshotPath, JSON.stringify(result, null, 2), 'utf-8')
      console.log(`  Saved golden snapshot: ${snapshotPath}`)
    } else {
      // Compare against golden snapshot
      const expected = JSON.parse(readFileSync(snapshotPath, 'utf-8'))
      expect(result).toEqual(expected)
    }
  })
})
