/**
 * Stage 8: Score History
 *
 * Computes store scores (from source-product ratings) and creator scores
 * (from video-mention sentiments) and prepends a new entry to the
 * product's scoreHistory array with independent change tracking per score.
 */

import type { StageContext, StageResult, AggregationWorkItem } from './index'

function computeChange(current: number, previous: number): 'drop' | 'increase' | 'stable' {
  if (previous === 0) return current > 0 ? 'increase' : 'stable'
  const pct = (current - previous) / previous
  if (pct <= -0.05) return 'drop'
  if (pct >= 0.05) return 'increase'
  return 'stable'
}

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
    const rated = (sourceProducts.docs as Array<{ averageRating?: number | null; ratingCount?: number | null }>)
      .filter(sp => sp.averageRating != null && sp.ratingCount != null && Number(sp.ratingCount) > 0)
    if (rated.length > 0) {
      const avgRating = rated.reduce((sum, sp) => sum + Number(sp.averageRating), 0) / rated.length
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
    storeScoreChange?: string | null
    creatorScore?: number | null
    creatorScoreChange?: string | null
  }>)

  // Determine change direction independently for each score
  let storeScoreChange: string | null = null
  let creatorScoreChange: string | null = null

  if (existingHistory.length > 0) {
    const prev = existingHistory[0]
    if (storeScore != null && prev.storeScore != null) {
      storeScoreChange = computeChange(storeScore, Number(prev.storeScore))
    }
    if (creatorScore != null && prev.creatorScore != null) {
      creatorScoreChange = computeChange(creatorScore, Number(prev.creatorScore))
    }
  }

  await payload.update({
    collection: 'products',
    id: productId,
    data: {
      scoreHistory: [{
        recordedAt: new Date().toISOString(),
        storeScore,
        storeScoreChange,
        creatorScore,
        creatorScoreChange,
      }, ...existingHistory],
    },
  })

  log.info('Score history stage complete', { productId, storeScore, storeScoreChange, creatorScore, creatorScoreChange })
  return { success: true, productId }
}
