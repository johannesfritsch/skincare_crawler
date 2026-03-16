/**
 * Stage 2: Match Brand
 *
 * Picks the brand from the highest-priority source (via brandSourcePriority),
 * upserts the brand in the brands collection (with image download if available),
 * and links it to the product.
 *
 * Falls back to LLM fuzzy matching only when no source-brand data is available
 * (i.e. all source-products lack a sourceBrand relationship).
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

  // Get brand data from sources using priority ordering
  const allSources = workItem.variants.flatMap((v) => v.sources)
  const productData = aggregateVariantsToProduct(allSources, {
    brandSourcePriority: config.brandSourcePriority,
  })

  if (!productData?.brandName) {
    log.info('No brand name in sources, skipping brand matching', { productId })
    return { success: true, productId, tokensUsed: 0 }
  }

  let brandId: number
  let tokensUsed = 0

  if (productData.sourceBrandId) {
    // We have a source-brand record — upsert the unified brand directly (no LLM needed)
    brandId = await upsertBrandFromSource(ctx, productData.brandName, productData.sourceBrandImageUrl ?? null)
    jlog.event('aggregation.brand_matched', {
      brandName: productData.brandName,
      brandId,
      method: 'source_brand',
    })
  } else {
    // No source-brand available — fall back to LLM matching
    const brandResult = await matchBrand(payload, productData.brandName, jlog)
    brandId = brandResult.brandId
    tokensUsed = brandResult.tokensUsed.totalTokens
    jlog.event('aggregation.brand_matched', {
      brandName: productData.brandName,
      brandId,
      method: 'llm',
    })
  }

  await payload.update({
    collection: 'products',
    id: productId,
    data: { brand: brandId },
  })

  log.info('Match brand stage complete', { productId, brandName: productData.brandName, brandId })

  return { success: true, productId, tokensUsed }
}

/**
 * Upsert a brand record from source-brand data.
 * Finds or creates by exact name match, then downloads and uploads the brand image
 * if one is available from the source and the brand doesn't already have an image.
 */
async function upsertBrandFromSource(
  ctx: StageContext,
  brandName: string,
  imageUrl: string | null,
): Promise<number> {
  const { payload, log } = ctx

  // Try exact match first
  const existing = await payload.find({
    collection: 'brands',
    where: { name: { equals: brandName } },
    limit: 1,
  })

  let brandId: number
  let hasImage: boolean

  if (existing.docs.length === 1) {
    const doc = existing.docs[0] as { id: number; image?: unknown }
    brandId = doc.id
    hasImage = !!doc.image
    log.info('Brand found (exact match)', { brand: brandName, brandId })
  } else {
    // Re-check before creating (race condition guard)
    const recheck = await payload.find({
      collection: 'brands',
      where: { name: { equals: brandName } },
      limit: 1,
    })

    if (recheck.docs.length === 1) {
      const doc = recheck.docs[0] as { id: number; image?: unknown }
      brandId = doc.id
      hasImage = !!doc.image
      log.info('Brand found (recheck)', { brand: brandName, brandId })
    } else {
      const created = await payload.create({
        collection: 'brands',
        data: { name: brandName },
      }) as { id: number }
      brandId = created.id
      hasImage = false
      log.info('Brand created', { brand: brandName, brandId })
    }
  }

  // Download and upload brand image if we have a URL and the brand doesn't have one yet
  if (imageUrl && !hasImage) {
    try {
      const imageRes = await fetch(imageUrl)
      if (imageRes.ok) {
        const contentType = imageRes.headers.get('content-type') || 'image/jpeg'
        const buffer = Buffer.from(await imageRes.arrayBuffer())
        const urlPath = new URL(imageUrl).pathname
        const filename = urlPath.split('/').pop() || `brand-${brandId}.jpg`

        const mediaDoc = await payload.create({
          collection: 'profile-media',
          data: { alt: brandName },
          file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
        })
        const mediaId = (mediaDoc as { id: number }).id

        await payload.update({
          collection: 'brands',
          id: brandId,
          data: { image: mediaId },
        })

        log.info('Brand image uploaded', { brand: brandName, brandId, mediaId })
      } else {
        log.debug('Brand image download failed', { url: imageUrl, status: imageRes.status })
      }
    } catch (error) {
      log.debug('Brand image download error', {
        url: imageUrl,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return brandId
}
