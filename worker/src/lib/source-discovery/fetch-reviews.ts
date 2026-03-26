/**
 * Standalone review-fetching dispatcher.
 *
 * Routes to the appropriate store-specific review API by source slug.
 * This allows fetching reviews independently of a full scrapeProduct() call.
 */

import type { ScrapedProductData } from './types'
import type { SourceSlug } from './types'

export interface ReviewFetchResult {
  reviews: NonNullable<ScrapedProductData['reviews']>
  /** Yotpo bottomline average score (PURISH only) */
  averageScore?: number | null
  /** Yotpo bottomline total reviews (PURISH only) */
  totalReviews?: number
}

/**
 * Fetch reviews for a product from the store's review API.
 *
 * @param source - Store slug
 * @param reviewKey - Store-specific review key:
 *   - DM: DAN (sourceArticleNumber from source-variant)
 *   - Rossmann: GTIN (from source-variant)
 *   - PURISH: Shopify product ID (sourceArticleNumber from source-product)
 *   - Mueller: not supported (returns empty)
 */
export async function fetchProductReviews(
  source: SourceSlug,
  reviewKey: string,
): Promise<ReviewFetchResult> {
  switch (source) {
    case 'dm': {
      const { fetchDmReviews } = await import('./drivers/dm/index')
      const reviews = await fetchDmReviews(reviewKey)
      return { reviews: reviews ?? [] }
    }
    case 'rossmann': {
      const { fetchRossmannReviews } = await import('./drivers/rossmann/index')
      const reviews = await fetchRossmannReviews(reviewKey)
      return { reviews }
    }
    case 'purish': {
      const { fetchPurishReviews } = await import('./drivers/purish/index')
      return fetchPurishReviews(reviewKey)
    }
    case 'douglas': {
      const { fetchDouglasReviews } = await import('./drivers/douglas/index')
      const reviews = await fetchDouglasReviews(reviewKey)
      return { reviews: reviews ?? [] }
    }
    case 'mueller':
      // Mueller has no review API
      return { reviews: [] }
    default:
      return { reviews: [] }
  }
}
