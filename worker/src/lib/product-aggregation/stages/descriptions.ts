/**
 * Stage 5: Descriptions
 *
 * Per variant: runs consensusDescription() to synthesize a single
 * description from multiple sources, and deduplicateLabels() to
 * normalize and filter retailer labels. Writes both to the product-variant.
 */

import { consensusDescription } from '@/lib/consensus-description'
import { deduplicateLabels } from '@/lib/deduplicate-labels'
import { aggregateSourceVariantsToVariant } from '@/lib/aggregate-product'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeDescriptions(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  let tokensUsed = 0

  for (const v of workItem.variants) {
    const vd = aggregateSourceVariantsToVariant(v.sources, {
      imageSourcePriority: config.imageSourcePriority,
    })
    if (!vd) continue

    // Find the product-variant for this GTIN
    const pvResult = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: v.gtin } },
      limit: 1,
    })
    if (pvResult.docs.length === 0) continue
    const variantId = (pvResult.docs[0] as { id: number }).id

    const updateData: Record<string, unknown> = {}

    // Consensus description
    if (vd.descriptions.length > 0) {
      try {
        const descResult = await consensusDescription(vd.descriptions)
        if (descResult.description) {
          updateData.description = descResult.description
        }
        tokensUsed += descResult.tokensUsed.totalTokens
        jlog.event('description.consensus', {
          inputCount: vd.descriptions.length,
          uniqueCount: new Set(vd.descriptions.map((d) => d.trim().toLowerCase())).size,
          cacheHit: descResult.cacheHit,
        })
      } catch (e) {
        log.error('Description consensus error', { gtin: v.gtin, error: e instanceof Error ? e.message : String(e) })
        // Fallback: use the longest description
        updateData.description = vd.descriptions.reduce((a, b) => (b.length > a.length ? b : a), '')
      }
    }

    // Deduplicate labels
    if (vd.allLabels.length > 0) {
      try {
        const labelResult = await deduplicateLabels(vd.allLabels)
        updateData.labels = labelResult.labels.map((label) => ({ label }))
        tokensUsed += labelResult.tokensUsed.totalTokens
        jlog.event('labels.deduplicated', {
          inputCount: vd.allLabels.length,
          outputCount: labelResult.labels.length,
          cacheHit: labelResult.cacheHit,
        })
      } catch (e) {
        log.error('Label deduplication error', { gtin: v.gtin, error: e instanceof Error ? e.message : String(e) })
        // Fallback: unique raw labels
        updateData.labels = [...new Set(vd.allLabels)].map((label) => ({ label }))
      }
    }

    if (Object.keys(updateData).length > 0) {
      await payload.update({
        collection: 'product-variants',
        id: variantId,
        data: updateData,
      })
    }

    await ctx.heartbeat()
  }

  log.info('Descriptions stage complete', { productId, tokens: tokensUsed })
  return { success: true, productId, tokensUsed }
}
