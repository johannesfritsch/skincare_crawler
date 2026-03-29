import { describe, test, expect } from 'vitest'
import { validateCrawlResult, getValidatedDrivers } from '@/lib/validate-crawl-result'

const validDmProduct = {
  name: 'Test Product',
  brandName: 'Test Brand',
  priceCents: 999,
  gtin: '4066447240092',
  sourceArticleNumber: '1234567',
  images: [{ url: 'https://cdn.example.com/img.jpg', alt: 'Product' }],
  warnings: [],
}

const validSaProduct = {
  name: 'SA Product',
  images: [{ url: 'https://cdn.shop-apotheke.com/img.jpg', alt: null }],
  warnings: [],
}

describe('validateCrawlResult', () => {
  test('loads schemas for all drivers', () => {
    const drivers = getValidatedDrivers()
    expect(drivers).toContain('dm')
    expect(drivers).toContain('rossmann')
    expect(drivers).toContain('mueller')
    expect(drivers).toContain('purish')
    expect(drivers).toContain('douglas')
    expect(drivers).toContain('shopapotheke')
  })

  test('returns empty array for valid DM product', () => {
    expect(validateCrawlResult(validDmProduct, 'dm')).toEqual([])
  })

  test('returns empty array for valid SA product (no GTIN/brand required)', () => {
    expect(validateCrawlResult(validSaProduct, 'shopapotheke')).toEqual([])
  })

  test('returns empty for unknown driver (no schema)', () => {
    expect(validateCrawlResult({}, 'unknown-store')).toEqual([])
  })

  // DM-specific: GTIN required
  test('DM: detects missing GTIN', () => {
    const { gtin: _, ...noGtin } = validDmProduct
    const issues = validateCrawlResult(noGtin, 'dm')
    expect(issues.some((i) => i.field === 'gtin' || i.message?.includes('gtin'))).toBe(true)
  })

  test('DM: detects missing sourceArticleNumber', () => {
    const { sourceArticleNumber: _, ...noDan } = validDmProduct
    const issues = validateCrawlResult(noDan, 'dm')
    expect(issues.some((i) => i.field === 'sourceArticleNumber' || i.message?.includes('sourceArticleNumber'))).toBe(true)
  })

  // SA: GTIN not required
  test('SA: allows missing GTIN', () => {
    const issues = validateCrawlResult(validSaProduct, 'shopapotheke')
    expect(issues.some((i) => i.field === 'gtin')).toBe(false)
  })

  // Common rules
  test('detects empty name', () => {
    const issues = validateCrawlResult({ ...validDmProduct, name: '' }, 'dm')
    expect(issues.some((i) => i.field === '/name')).toBe(true)
  })

  test('detects no images', () => {
    const issues = validateCrawlResult({ ...validDmProduct, images: [] }, 'dm')
    expect(issues.some((i) => i.field === '/images')).toBe(true)
  })

  test('detects price too low', () => {
    const issues = validateCrawlResult({ ...validDmProduct, priceCents: 5 }, 'dm')
    expect(issues.some((i) => i.field === '/priceCents')).toBe(true)
  })

  test('detects price too high', () => {
    const issues = validateCrawlResult({ ...validDmProduct, priceCents: 200000 }, 'dm')
    expect(issues.some((i) => i.field === '/priceCents')).toBe(true)
  })

  test('detects invalid GTIN format', () => {
    const issues = validateCrawlResult({ ...validDmProduct, gtin: 'abc123' }, 'dm')
    expect(issues.some((i) => i.field === '/gtin')).toBe(true)
  })

  test('detects invalid image URL', () => {
    const issues = validateCrawlResult(
      { ...validDmProduct, images: [{ url: 'not-a-url' }] },
      'dm',
    )
    expect(issues.some((i) => i.field.startsWith('/images'))).toBe(true)
  })

  test('accumulates multiple issues', () => {
    const issues = validateCrawlResult(
      { name: '', priceCents: 5, images: [], warnings: [], gtin: 'bad', brandName: 'ok', sourceArticleNumber: '123' },
      'dm',
    )
    expect(issues.length).toBeGreaterThanOrEqual(3)
  })
})
