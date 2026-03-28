import { describe, test, expect } from 'vitest'
import {
  descriptionGroupsToMarkdown,
  parseProductAmount,
  parsePerUnitPrice,
  extractGtinFromDmUrl,
  type DmDescriptionGroup,
} from '@/lib/source-discovery/drivers/dm/helpers'

describe('descriptionGroupsToMarkdown', () => {
  test('converts bulletpoints to markdown list', () => {
    const groups: DmDescriptionGroup[] = [
      {
        header: 'Vorteile',
        contentBlock: [{ bulletpoints: ['Vorteil 1', 'Vorteil 2'] }],
      },
    ]
    expect(descriptionGroupsToMarkdown(groups)).toBe(
      '## Vorteile\n\n- Vorteil 1\n- Vorteil 2',
    )
  })

  test('converts texts to paragraphs', () => {
    const groups: DmDescriptionGroup[] = [
      {
        header: 'Beschreibung',
        contentBlock: [{ texts: ['First paragraph', 'Second paragraph'] }],
      },
    ]
    expect(descriptionGroupsToMarkdown(groups)).toBe(
      '## Beschreibung\n\nFirst paragraph\nSecond paragraph',
    )
  })

  test('converts descriptionList to bold key-value pairs', () => {
    const groups: DmDescriptionGroup[] = [
      {
        header: 'Details',
        contentBlock: [
          {
            descriptionList: [
              { title: 'Marke', description: 'alverde' },
              { title: 'Typ', description: 'Tagescreme' },
            ],
          },
        ],
      },
    ]
    expect(descriptionGroupsToMarkdown(groups)).toBe(
      '## Details\n\n**Marke:** alverde\n**Typ:** Tagescreme',
    )
  })

  test('combines multiple groups', () => {
    const groups: DmDescriptionGroup[] = [
      {
        header: 'A',
        contentBlock: [{ texts: ['text a'] }],
      },
      {
        header: 'B',
        contentBlock: [{ bulletpoints: ['item b'] }],
      },
    ]
    const result = descriptionGroupsToMarkdown(groups)
    expect(result).toBe('## A\n\ntext a\n\n## B\n\n- item b')
  })

  test('returns null for empty groups', () => {
    expect(descriptionGroupsToMarkdown([])).toBeNull()
  })

  test('skips groups with empty content blocks', () => {
    const groups: DmDescriptionGroup[] = [
      { header: 'Empty', contentBlock: [{}] },
      { header: 'Has content', contentBlock: [{ texts: ['hello'] }] },
    ]
    expect(descriptionGroupsToMarkdown(groups)).toBe('## Has content\n\nhello')
  })
})

describe('parseProductAmount', () => {
  test('parses liters amount', () => {
    expect(parseProductAmount(['0,3 l (2,17 € je 1 l)'])).toEqual({
      amount: 300,
      unit: 'ml',
    })
  })

  test('parses small liters → converts to ml', () => {
    expect(parseProductAmount(['0,055 l (271,82 € je 1 l)'])).toEqual({
      amount: 55,
      unit: 'ml',
    })
  })

  test('parses 1+ liters without conversion', () => {
    expect(parseProductAmount(['1,5 l (3,30 € je 1 l)'])).toEqual({
      amount: 1.5,
      unit: 'l',
    })
  })

  test('parses kg → converts to g when < 1', () => {
    expect(parseProductAmount(['0,25 kg (7,80 € je 1 kg)'])).toEqual({
      amount: 250,
      unit: 'g',
    })
  })

  test('returns null for undefined', () => {
    expect(parseProductAmount(undefined)).toBeNull()
  })

  test('returns null for non-matching strings', () => {
    expect(parseProductAmount(['no match here'])).toBeNull()
  })

  test('picks first matching info string', () => {
    expect(
      parseProductAmount(['not a match', '0,1 l (14,95 € je 1 l)']),
    ).toEqual({ amount: 100, unit: 'ml' })
  })
})

describe('parsePerUnitPrice', () => {
  test('parses per-liter price', () => {
    expect(parsePerUnitPrice(['0,3 l (2,17 € je 1 l)'])).toEqual({
      amount: 217,
      quantity: 1,
      unit: 'l',
    })
  })

  test('parses per-100ml price', () => {
    expect(parsePerUnitPrice(['0,05 l (29,90 € je 100 ml)'])).toEqual({
      amount: 2990,
      quantity: 100,
      unit: 'ml',
    })
  })

  test('returns null for undefined', () => {
    expect(parsePerUnitPrice(undefined)).toBeNull()
  })

  test('returns null for non-matching strings', () => {
    expect(parsePerUnitPrice(['just a price'])).toBeNull()
  })
})

describe('extractGtinFromDmUrl', () => {
  test('extracts GTIN from standard DM URL', () => {
    expect(
      extractGtinFromDmUrl(
        'https://www.dm.de/alverde-naturkosmetik-tagescreme-p4058172936791.html',
      ),
    ).toBe('4058172936791')
  })

  test('extracts GTIN from URL with path segments', () => {
    expect(
      extractGtinFromDmUrl(
        'https://www.dm.de/some-product-name-p1234567890123.html',
      ),
    ).toBe('1234567890123')
  })

  test('returns null for non-DM URL pattern', () => {
    expect(extractGtinFromDmUrl('https://www.dm.de/some-page')).toBeNull()
  })

  test('returns null for invalid URL', () => {
    expect(extractGtinFromDmUrl('not-a-url')).toBeNull()
  })
})
