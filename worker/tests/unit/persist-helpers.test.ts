import { describe, test, expect } from 'vitest'
import {
  normalizeReviewerAge,
  parseAmountFromText,
  computePerUnitPrice,
} from '@/lib/work-protocol/persist'

describe('normalizeReviewerAge', () => {
  test('returns null for null/undefined/empty', () => {
    expect(normalizeReviewerAge(null)).toBeNull()
    expect(normalizeReviewerAge(undefined)).toBeNull()
    expect(normalizeReviewerAge('')).toBeNull()
    expect(normalizeReviewerAge('  ')).toBeNull()
  })

  test('passes through already-normalized values', () => {
    expect(normalizeReviewerAge('>=18&<=24')).toBe('>=18&<=24')
    expect(normalizeReviewerAge('<=17')).toBe('<=17')
    expect(normalizeReviewerAge('>=65')).toBe('>=65')
  })

  test('normalizes "17orUnder" → "<=17"', () => {
    expect(normalizeReviewerAge('17orUnder')).toBe('<=17')
  })

  test('normalizes "unter18" → "<=18"', () => {
    expect(normalizeReviewerAge('unter18')).toBe('<=18')
  })

  test('normalizes "65orOver" → ">=65"', () => {
    expect(normalizeReviewerAge('65orOver')).toBe('>=65')
  })

  test('normalizes "70JahreUndAlter" → ">=70"', () => {
    expect(normalizeReviewerAge('70JahreUndAlter')).toBe('>=70')
  })

  test('normalizes "über65" → ">=65"', () => {
    expect(normalizeReviewerAge('über65')).toBe('>=65')
  })

  test('normalizes range "18-24" → ">=18&<=24"', () => {
    expect(normalizeReviewerAge('18-24')).toBe('>=18&<=24')
  })

  test('normalizes "18to24" → ">=18&<=24"', () => {
    expect(normalizeReviewerAge('18to24')).toBe('>=18&<=24')
  })

  test('normalizes "25 bis 34" → ">=25&<=34"', () => {
    expect(normalizeReviewerAge('25 bis 34')).toBe('>=25&<=34')
  })

  test('normalizes bare 4-digit "6069" → ">=60&<=69"', () => {
    expect(normalizeReviewerAge('6069')).toBe('>=60&<=69')
  })

  test('returns unrecognized values as-is', () => {
    expect(normalizeReviewerAge('unknown')).toBe('unknown')
  })
})

describe('parseAmountFromText', () => {
  test('extracts "100 ml"', () => {
    expect(parseAmountFromText('Tagescreme 50 ml')).toEqual({
      amount: 50,
      amountUnit: 'ml',
    })
  })

  test('extracts "1,5l" with German comma', () => {
    expect(parseAmountFromText('Shampoo 1,5 l')).toEqual({
      amount: 1.5,
      amountUnit: 'l',
    })
  })

  test('extracts amount with dot decimal', () => {
    expect(parseAmountFromText('Cream 2.5 g')).toEqual({
      amount: 2.5,
      amountUnit: 'g',
    })
  })

  test('extracts mg', () => {
    expect(parseAmountFromText('Supplement 500 mg daily')).toEqual({
      amount: 500,
      amountUnit: 'mg',
    })
  })

  test('extracts kg', () => {
    expect(parseAmountFromText('Big bottle 2 kg pack')).toEqual({
      amount: 2,
      amountUnit: 'kg',
    })
  })

  test('returns null for no match', () => {
    expect(parseAmountFromText('No amount here')).toBeNull()
  })

  test('returns null for units embedded in words (e.g. "global")', () => {
    expect(parseAmountFromText('A global thing')).toBeNull()
  })

  test('handles amount at end of string', () => {
    expect(parseAmountFromText('Product 200 ml')).toEqual({
      amount: 200,
      amountUnit: 'ml',
    })
  })
})

describe('computePerUnitPrice', () => {
  test('ml → price per 100ml', () => {
    expect(computePerUnitPrice(999, 50, 'ml')).toEqual({
      perUnitAmount: 1998,
      perUnitQuantity: 100,
      perUnitUnit: 'ml',
    })
  })

  test('g → price per 100g', () => {
    expect(computePerUnitPrice(500, 250, 'g')).toEqual({
      perUnitAmount: 200,
      perUnitQuantity: 100,
      perUnitUnit: 'g',
    })
  })

  test('l → price per 1l', () => {
    expect(computePerUnitPrice(299, 0.5, 'l')).toEqual({
      perUnitAmount: 598,
      perUnitQuantity: 1,
      perUnitUnit: 'l',
    })
  })

  test('kg → price per 1kg', () => {
    expect(computePerUnitPrice(1000, 2, 'kg')).toEqual({
      perUnitAmount: 500,
      perUnitQuantity: 1,
      perUnitUnit: 'kg',
    })
  })

  test('unknown unit → price per 1 unit, preserves casing', () => {
    expect(computePerUnitPrice(600, 3, 'Stück')).toEqual({
      perUnitAmount: 200,
      perUnitQuantity: 1,
      perUnitUnit: 'Stück',
    })
  })
})
