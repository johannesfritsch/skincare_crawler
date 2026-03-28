import { describe, test, expect } from 'vitest'
import {
  parseAmount,
  normalizeUnit,
  decodeEntities,
  stripHtml,
  parseJsonLdBlocks,
} from '@/lib/source-discovery/drivers/shopapotheke/helpers'

describe('parseAmount', () => {
  test('parses simple "9.5 g"', () => {
    expect(parseAmount('9.5 g')).toEqual({ amount: 9.5, amountUnit: 'g' })
  })

  test('parses German comma decimal "100,5 ml"', () => {
    expect(parseAmount('100,5 ml')).toEqual({ amount: 100.5, amountUnit: 'ml' })
  })

  test('parses integer amount "60 St"', () => {
    expect(parseAmount('60 St')).toEqual({ amount: 60, amountUnit: 'Stück' })
  })

  test('parses "St." with period', () => {
    expect(parseAmount('30 St.')).toEqual({ amount: 30, amountUnit: 'Stück' })
  })

  test('parses multiplied "2x60 St" pattern', () => {
    expect(parseAmount('2x60 St')).toEqual({ amount: 120, amountUnit: 'Stück' })
  })

  test('parses "Stück" directly', () => {
    expect(parseAmount('10 Stück')).toEqual({ amount: 10, amountUnit: 'Stück' })
  })

  test('parses "mg" unit', () => {
    expect(parseAmount('500 mg')).toEqual({ amount: 500, amountUnit: 'mg' })
  })

  test('parses "kg" unit', () => {
    expect(parseAmount('1,5 kg')).toEqual({ amount: 1.5, amountUnit: 'kg' })
  })

  test('returns null for empty string', () => {
    expect(parseAmount('')).toBeNull()
  })

  test('returns null for no match', () => {
    expect(parseAmount('no amount here')).toBeNull()
  })
})

describe('normalizeUnit', () => {
  test('normalizes "St" to "Stück"', () => {
    expect(normalizeUnit('St')).toBe('Stück')
  })

  test('normalizes "St." to "Stück"', () => {
    expect(normalizeUnit('St.')).toBe('Stück')
  })

  test('passes through "ml"', () => {
    expect(normalizeUnit('ml')).toBe('ml')
  })

  test('passes through "g"', () => {
    expect(normalizeUnit('g')).toBe('g')
  })
})

describe('decodeEntities', () => {
  test('decodes &amp;', () => {
    expect(decodeEntities('A &amp; B')).toBe('A & B')
  })

  test('decodes &nbsp;', () => {
    expect(decodeEntities('hello&nbsp;world')).toBe('hello world')
  })

  test('decodes &lt; and &gt;', () => {
    expect(decodeEntities('&lt;div&gt;')).toBe('<div>')
  })

  test('decodes &quot;', () => {
    expect(decodeEntities('&quot;hello&quot;')).toBe('"hello"')
  })

  test('decodes &#39; and &#x27;', () => {
    expect(decodeEntities("it&#39;s")).toBe("it's")
    expect(decodeEntities("it&#x27;s")).toBe("it's")
  })

  test('decodes numeric entities', () => {
    expect(decodeEntities('&#169;')).toBe('\u00A9') // ©
  })

  test('passes through plain text', () => {
    expect(decodeEntities('no entities')).toBe('no entities')
  })
})

describe('stripHtml', () => {
  test('removes HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world')
  })

  test('collapses whitespace', () => {
    expect(stripHtml('<p>Hello</p>  <p>World</p>')).toBe('Hello World')
  })

  test('decodes entities after stripping', () => {
    expect(stripHtml('<span>A &amp; B</span>')).toBe('A & B')
  })

  test('handles empty input', () => {
    expect(stripHtml('')).toBe('')
  })
})

describe('parseJsonLdBlocks', () => {
  test('parses a single JSON-LD block', () => {
    const html = `
      <html>
      <head>
        <script type="application/ld+json">{"@type":"Product","name":"Test"}</script>
      </head>
      </html>
    `
    const result = parseJsonLdBlocks(html)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ '@type': 'Product', name: 'Test' })
  })

  test('parses multiple JSON-LD blocks', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product"}</script>
      <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
    `
    const result = parseJsonLdBlocks(html)
    expect(result).toHaveLength(2)
  })

  test('skips malformed JSON', () => {
    const html = `
      <script type="application/ld+json">{not valid json}</script>
      <script type="application/ld+json">{"@type":"Product"}</script>
    `
    const result = parseJsonLdBlocks(html)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ '@type': 'Product' })
  })

  test('returns empty array for no blocks', () => {
    expect(parseJsonLdBlocks('<html><head></head></html>')).toEqual([])
  })
})
