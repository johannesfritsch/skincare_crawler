/**
 * Reviews stage — fetch reviews from store review APIs for source-products
 * that were scraped in the current job.
 *
 * For each source-product at stage 'scrape' in the crawlProgress map:
 *   1. Look up the review key from source-variants or source-product
 *   2. Fetch reviews via fetchProductReviews()
 *   3. Persist reviews to source-reviews
 *   4. Update source-product rating/ratingCount if provided (Yotpo bottomline)
 */

import type { PayloadRestClient } from '@/lib/payload-client'
import type { SourceSlug } from '@/lib/source-discovery/types'
import { fetchProductReviews } from '@/lib/source-discovery/fetch-reviews'
import { persistReviews } from '@/lib/work-protocol/persist'
import { createLogger } from '@/lib/logger'

const log = createLogger('CrawlReviews')

export interface ReviewWorkItem {
  sourceProductId: number
  source: SourceSlug
}

export interface ReviewResult {
  sourceProductId: number
  success: boolean
  reviewsFetched: number
  reviewsCreated: number
  reviewsLinked: number
  reviewsBackfilled: number
  error?: string
}

/**
 * Execute the reviews stage for a single source-product.
 * Looks up the appropriate review key, fetches reviews, and persists them.
 */
export async function executeReviewStage(
  payload: PayloadRestClient,
  item: ReviewWorkItem,
  jlog: ReturnType<typeof createLogger>,
): Promise<ReviewResult> {
  const { sourceProductId, source } = item

  const emptyResult = { sourceProductId, success: true, reviewsFetched: 0, reviewsCreated: 0, reviewsLinked: 0, reviewsBackfilled: 0 }

  // Mueller has no review API — skip gracefully
  if (source === 'mueller') {
    return emptyResult
  }

  try {
    // Look up the review key based on store
    const reviewKey = await getReviewKey(payload, sourceProductId, source)
    if (!reviewKey) {
      log.debug('No review key found, skipping reviews', { sourceProductId, source })
      return emptyResult
    }

    // Fetch reviews from store API
    const fetchResult = await fetchProductReviews(source, reviewKey)
    const fetched = fetchResult.reviews.length

    if (fetched === 0) {
      return emptyResult
    }

    // Look up all variant IDs to link reviews to (product-level reviews apply to all variants)
    const variantResult = await payload.find({
      collection: 'source-variants',
      where: { sourceProduct: { equals: sourceProductId } },
      limit: 1000,
    })
    const sourceVariantIds = variantResult.docs.map(
      (doc) => (doc as Record<string, unknown>).id as number,
    )

    // Persist reviews
    const persistResult = await persistReviews(
      payload,
      sourceProductId,
      sourceVariantIds.length > 0 ? sourceVariantIds : undefined,
      fetchResult.reviews,
      source,
      jlog,
    )

    // Update source-product rating/ratingCount if Yotpo bottomline provided
    if (fetchResult.averageScore != null || fetchResult.totalReviews != null) {
      const updateData: Record<string, unknown> = {}
      if (fetchResult.averageScore != null) updateData.averageRating = fetchResult.averageScore
      if (fetchResult.totalReviews != null) updateData.ratingCount = fetchResult.totalReviews
      if (Object.keys(updateData).length > 0) {
        await payload.update({
          collection: 'source-products',
          id: sourceProductId,
          data: updateData,
        })
      }
    }

    jlog.event('reviews.fetched', {
      source,
      sourceProductId,
      fetched,
      created: persistResult.created,
      linked: persistResult.linked,
      backfilled: persistResult.backfilled,
    })

    return {
      sourceProductId,
      success: true,
      reviewsFetched: fetched,
      reviewsCreated: persistResult.created,
      reviewsLinked: persistResult.linked,
      reviewsBackfilled: persistResult.backfilled,
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log.error('Review stage error', { sourceProductId, source, error })
    return { sourceProductId, success: false, reviewsFetched: 0, reviewsCreated: 0, reviewsLinked: 0, reviewsBackfilled: 0, error }
  }
}

/**
 * Look up the review API key for a source-product.
 * - DM: DAN from source-variant's sourceArticleNumber
 * - Rossmann: GTIN from source-variant
 * - PURISH: Shopify product ID from source-product's sourceArticleNumber
 */
async function getReviewKey(
  payload: PayloadRestClient,
  sourceProductId: number,
  source: SourceSlug,
): Promise<string | null> {
  if (source === 'purish' || source === 'douglas') {
    // PURISH: review key is the Shopify product ID stored on source-product.sourceArticleNumber
    // Douglas: review key is the base product code stored on source-product.sourceArticleNumber
    const sp = await payload.findByID({ collection: 'source-products', id: sourceProductId }) as Record<string, unknown>
    const articleNumber = sp.sourceArticleNumber as string | undefined
    return articleNumber || null
  }

  // DM and Rossmann: review key comes from source-variants
  const variants = await payload.find({
    collection: 'source-variants',
    where: { sourceProduct: { equals: sourceProductId } },
    limit: 1,
  })

  if (variants.docs.length === 0) return null
  const variant = variants.docs[0] as Record<string, unknown>

  if (source === 'dm') {
    // DM: DAN from sourceArticleNumber
    return (variant.sourceArticleNumber as string) || null
  }

  if (source === 'rossmann') {
    // Rossmann: GTIN
    return (variant.gtin as string) || null
  }

  return null
}
