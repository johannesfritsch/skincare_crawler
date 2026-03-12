/**
 * Stage 6: Score History
 *
 * Computes store scores (from source-product ratings) and creator scores
 * (from video-mention sentiments) and prepends a new entry to the
 * product's scoreHistory array.
 */

import type { StageContext, StageResult, AggregationWorkItem } from './index'

export async function executeScoreHistory(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  const allSources = workItem.variants.flatMap((v) => v.sources)
  const sourceProductIds = [...new Set(allSources.map((s) => s.sourceProductId))]

  // Compute store score from source-product ratings
  let storeScore: number | null = null
  if (sourceProductIds.length > 0) {
    const sourceProducts = await payload.find({
      collection: 'source-products',
      where: { id: { in: sourceProductIds } },
      limit: sourceProductIds.length,
    })
    const rated = (sourceProducts.docs as Array<{ rating?: number | null; ratingNum?: number | null }>)
      .filter(sp => sp.rating != null && sp.ratingNum != null && Number(sp.ratingNum) > 0)
    if (rated.length > 0) {
      const avgRating = rated.reduce((sum, sp) => sum + Number(sp.rating), 0) / rated.length
      storeScore = Math.round(avgRating * 2 * 10) / 10
    }
  }

  // Compute creator score from video-mention sentiments
  let creatorScore: number | null = null
  const mentions = await payload.find({
    collection: 'video-mentions',
    where: { product: { equals: productId } },
    limit: 500,
  })
  const scoredMentions = (mentions.docs as Array<{ overallSentimentScore?: number | null }>)
    .filter(m => m.overallSentimentScore != null)
  if (scoredMentions.length > 0) {
    const avgSentiment = scoredMentions.reduce((sum, m) => sum + Number(m.overallSentimentScore), 0) / scoredMentions.length
    creatorScore = Math.round(((avgSentiment + 1) * 5) * 10) / 10
  }

  if (storeScore == null && creatorScore == null) {
    log.info('No scores to compute (no rated sources or mentions)', { productId })
    return { success: true, productId }
  }

  // Read existing score history
  const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
  const existingHistory = ((product.scoreHistory ?? []) as Array<{
    recordedAt: string
    storeScore?: number | null
    creatorScore?: number | null
    change?: string | null
  }>)

  // Determine change direction
  let change: string | null = null
  if (existingHistory.length > 0) {
    const prev = existingHistory[0]
    const scoreChange = (current: number, previous: number): 'drop' | 'increase' | 'stable' => {
      if (previous === 0) return current > 0 ? 'increase' : 'stable'
      const pct = (current - previous) / previous
      if (pct <= -0.05) return 'drop'
      if (pct >= 0.05) return 'increase'
      return 'stable'
    }
    if (storeScore != null && prev.storeScore != null) {
      change = scoreChange(storeScore, Number(prev.storeScore))
    } else if (creatorScore != null && prev.creatorScore != null) {
      change = scoreChange(creatorScore, Number(prev.creatorScore))
    }
    if (change === 'stable' && creatorScore != null && prev.creatorScore != null && storeScore != null && prev.storeScore != null) {
      const creatorChange = scoreChange(creatorScore, Number(prev.creatorScore))
      if (creatorChange !== 'stable') change = creatorChange
    }
  }

  await payload.update({
    collection: 'products',
    id: productId,
    data: {
      scoreHistory: [{
        recordedAt: new Date().toISOString(),
        storeScore,
        creatorScore,
        change,
      }, ...existingHistory],
    },
  })

  log.info('Score history stage complete', { productId, storeScore, creatorScore, change })
  return { success: true, productId }
}
