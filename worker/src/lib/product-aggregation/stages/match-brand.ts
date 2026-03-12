/**
 * Stage 2: Match Brand
 *
 * Runs matchBrand() to find/create the brand in the brands collection
 * and links it to the product.
 */

import { matchBrand } from '@/lib/match-brand'
import { aggregateVariantsToProduct } from '@/lib/aggregate-product'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeMatchBrand(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // Get brand name from sources
  const allSources = workItem.variants.flatMap((v) => v.sources)
  const productData = aggregateVariantsToProduct(allSources)

  if (!productData?.brandName) {
    log.info('No brand name in sources, skipping brand matching', { productId })
    return { success: true, productId, tokensUsed: 0 }
  }

  const brandResult = await matchBrand(payload, productData.brandName, jlog)
  const tokensUsed = brandResult.tokensUsed.totalTokens

  await payload.update({
    collection: 'products',
    id: productId,
    data: { brand: brandResult.brandId },
  })

  jlog.event('aggregation.brand_matched', { brandName: productData.brandName, brandId: brandResult.brandId })
  log.info('Match brand stage complete', { productId, brandName: productData.brandName, brandId: brandResult.brandId })

  return { success: true, productId, tokensUsed }
}
