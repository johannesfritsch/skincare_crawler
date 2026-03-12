/**
 * Stage 3: Ingredients
 *
 * Per variant: parseIngredients() from raw INCI text, then matchIngredients()
 * to link to the ingredients collection. Writes the ingredients array to
 * each product-variant.
 */

import { parseIngredients } from '@/lib/parse-ingredients'
import { matchIngredients } from '@/lib/match-ingredients'
import { aggregateSourceVariantsToVariant } from '@/lib/aggregate-product'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeIngredients(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
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
    if (!vd?.ingredientsText) continue

    // Find the product-variant for this GTIN
    const pvResult = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: v.gtin } },
      limit: 1,
    })
    if (pvResult.docs.length === 0) continue
    const variantId = (pvResult.docs[0] as { id: number }).id

    try {
      const ingredientNames = await parseIngredients(vd.ingredientsText)
      if (ingredientNames.length === 0) continue

      const matchResult = await matchIngredients(payload, ingredientNames, jlog)
      tokensUsed += matchResult.tokensUsed.totalTokens

      const matchedMap = new Map(
        matchResult.matched.map((m) => [m.originalName, m.ingredientId]),
      )

      await payload.update({
        collection: 'product-variants',
        id: variantId,
        data: {
          ingredients: ingredientNames.map((name) => ({
            name,
            ingredient: matchedMap.get(name) ?? null,
          })),
        },
      })

      jlog.event('aggregation.ingredients_matched', {
        matched: matchResult.matched.length,
        unmatched: matchResult.unmatched.length,
        total: ingredientNames.length,
      })
      log.info('Ingredients matched for variant', { gtin: v.gtin, matched: matchResult.matched.length, unmatched: matchResult.unmatched.length })
    } catch (error) {
      log.error('Ingredient parsing/matching failed', { gtin: v.gtin, error: error instanceof Error ? error.message : String(error) })
    }

    await ctx.heartbeat()
  }

  log.info('Ingredients stage complete', { productId, tokens: tokensUsed })
  return { success: true, productId, tokensUsed }
}
