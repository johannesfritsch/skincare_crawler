import { describe, test, expect } from 'vitest'
import {
  normalizeProductUrl,
  normalizeVariantUrl,
} from '@/lib/source-product-queries'

describe('normalizeProductUrl', () => {
  test('strips query parameters', () => {
    expect(
      normalizeProductUrl('https://www.dm.de/product-p123.html?foo=bar'),
    ).toBe('https://www.dm.de/product-p123.html')
  })

  test('strips hash fragments', () => {
    expect(
      normalizeProductUrl('https://www.dm.de/product-p123.html#section'),
    ).toBe('https://www.dm.de/product-p123.html')
  })

  test('strips trailing slashes', () => {
    expect(normalizeProductUrl('https://www.dm.de/product/')).toBe(
      'https://www.dm.de/product',
    )
  })

  test('strips all params from Mueller URLs', () => {
    expect(
      normalizeProductUrl(
        'https://www.mueller.de/p/some-product/?itemId=12345',
      ),
    ).toBe('https://www.mueller.de/p/some-product')
  })

  test('handles already-clean URLs', () => {
    expect(normalizeProductUrl('https://www.dm.de/product-p123.html')).toBe(
      'https://www.dm.de/product-p123.html',
    )
  })

  test('handles invalid URLs gracefully', () => {
    const result = normalizeProductUrl('not-a-url?foo=bar')
    expect(result).toBe('not-a-url')
  })
})

describe('normalizeVariantUrl', () => {
  test('preserves query parameters', () => {
    expect(
      normalizeVariantUrl(
        'https://www.mueller.de/p/product/?itemId=12345',
      ),
    ).toBe('https://www.mueller.de/p/product/?itemId=12345')
  })

  test('preserves PURISH variant param', () => {
    expect(
      normalizeVariantUrl(
        'https://purish.com/products/some-product?variant=48308942700862',
      ),
    ).toBe(
      'https://purish.com/products/some-product?variant=48308942700862',
    )
  })

  test('strips hash fragments', () => {
    expect(
      normalizeVariantUrl(
        'https://www.mueller.de/p/product/?itemId=123#top',
      ),
    ).toBe('https://www.mueller.de/p/product/?itemId=123')
  })

  test('strips trailing slashes (no params)', () => {
    expect(
      normalizeVariantUrl('https://www.dm.de/product-p123.html/'),
    ).toBe('https://www.dm.de/product-p123.html')
  })

  test('handles invalid URLs gracefully', () => {
    const result = normalizeVariantUrl('not-a-url#hash')
    expect(result).toBe('not-a-url')
  })
})
