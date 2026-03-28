/**
 * Shared vi.mock() declarations for driver snapshot tests.
 *
 * Import this file at the top of snapshot test files, BEFORE any vi.mock() calls,
 * or copy the mock declarations into each test file.
 *
 * These mocks prevent the test from pulling in heavy dependencies
 * (Playwright, ML models, the full driver registry, etc.) when importing a single driver.
 */
import { vi } from 'vitest'
import { mockStealthFetch } from './mock-stealth-fetch'

/** Apply all standard mocks for driver snapshot tests */
export function applyDriverMocks() {
  // Mock stealthFetch to return recorded fixtures
  vi.mock('@/lib/stealth-fetch', () => ({
    stealthFetch: (...args: Parameters<typeof mockStealthFetch>) => mockStealthFetch(...args),
  }))

  // Mock launchBrowser — only DM uses it (for brand URL extraction)
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

  // Mock the driver registry to avoid loading all drivers (Playwright, ML, etc.)
  vi.mock('@/lib/source-discovery/driver', () => ({
    getAllSourceDrivers: () => [],
    getSourceDriver: () => null,
    getSourceDriverBySlug: () => null,
    ALL_SOURCE_SLUGS: [],
    DEFAULT_IMAGE_SOURCE_PRIORITY: [],
    DEFAULT_BRAND_SOURCE_PRIORITY: [],
  }))
}
