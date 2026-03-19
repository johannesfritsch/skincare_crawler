/**
 * Stage 10: Sentiment Conclusion
 *
 * Reads aggregated product-sentiments for the product, filters topics with
 * sufficient volume (>= 5 total votes), determines the overall conclusion
 * (positive/negative/divided) and strength (based on volume), then upserts
 * product-sentiment-conclusions records.
 *
 * No LLM needed — conclusions are derived algorithmically from the counts.
 */

import type { StageContext, StageResult, AggregationWorkItem } from './index'

/** Minimum total votes in a topic before a conclusion is generated */
const MIN_VOTES_FOR_CONCLUSION = 5

interface SentimentRecord {
  topic: string
  sentiment: 'positive' | 'neutral' | 'negative'
  amount: number
}

interface TopicSummary {
  topic: string
  positive: number
  neutral: number
  negative: number
  total: number
}

function deriveConclusion(s: TopicSummary): 'positive' | 'negative' | 'divided' {
  const favorable = s.positive + s.neutral
  const unfavorable = s.negative
  const total = favorable + unfavorable

  if (total === 0) return 'divided'

  const favorableRatio = favorable / total
  // > 65% favorable → positive, > 65% unfavorable → negative, else divided
  if (favorableRatio >= 0.65) return 'positive'
  if (favorableRatio <= 0.35) return 'negative'
  return 'divided'
}

function deriveStrength(total: number): 'low' | 'medium' | 'high' | 'ultra' {
  if (total >= 50) return 'ultra'
  if (total >= 25) return 'high'
  if (total >= 10) return 'medium'
  return 'low'
}

export async function executeSentimentConclusion(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, log } = ctx
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // 1. Fetch all product-sentiments for this product
  const sentimentsResult = await payload.find({
    collection: 'product-sentiments',
    where: { product: { equals: productId } },
    limit: 100,
  })
  const sentiments = sentimentsResult.docs as unknown as SentimentRecord[]

  if (sentiments.length === 0) {
    log.info('No sentiment data for conclusions — skipping', { productId })
    return { success: true, productId }
  }

  // 2. Group by topic
  const byTopic = new Map<string, TopicSummary>()
  for (const s of sentiments) {
    if (!byTopic.has(s.topic)) {
      byTopic.set(s.topic, { topic: s.topic, positive: 0, neutral: 0, negative: 0, total: 0 })
    }
    const entry = byTopic.get(s.topic)!
    entry[s.sentiment] += s.amount
    entry.total += s.amount
  }

  // 3. Filter topics with sufficient volume
  const qualifiedTopics = Array.from(byTopic.values()).filter(
    (t) => t.total >= MIN_VOTES_FOR_CONCLUSION,
  )

  log.debug('Sentiment conclusion: topic analysis', {
    productId,
    totalTopics: byTopic.size,
    qualifiedTopics: qualifiedTopics.length,
    skippedTopics: byTopic.size - qualifiedTopics.length,
    minVotes: MIN_VOTES_FOR_CONCLUSION,
  })

  if (qualifiedTopics.length === 0) {
    log.info('No topics with enough votes for conclusions', {
      productId,
      totalTopics: byTopic.size,
      minVotes: MIN_VOTES_FOR_CONCLUSION,
    })
    return { success: true, productId }
  }

  // 4. Derive conclusions and upsert
  let created = 0
  let updated = 0

  for (const topic of qualifiedTopics) {
    const conclusion = deriveConclusion(topic)
    const strength = deriveStrength(topic.total)

    log.debug('Sentiment conclusion: derived', {
      productId,
      topic: topic.topic,
      positive: topic.positive,
      neutral: topic.neutral,
      negative: topic.negative,
      total: topic.total,
      conclusion,
      strength,
    })

    // Upsert by product + topic
    const existing = await payload.find({
      collection: 'product-sentiment-conclusions',
      where: {
        and: [
          { product: { equals: productId } },
          { topic: { equals: topic.topic } },
        ],
      },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      const doc = existing.docs[0] as Record<string, unknown>
      await payload.update({
        collection: 'product-sentiment-conclusions',
        id: doc.id as number,
        data: { conclusion, strength, volume: topic.total },
      })
      updated++
    } else {
      await payload.create({
        collection: 'product-sentiment-conclusions',
        data: { product: productId, topic: topic.topic, conclusion, strength, volume: topic.total },
      })
      created++
    }
  }

  // 5. Delete conclusions for topics that no longer qualify (dropped below threshold)
  const qualifiedTopicNames = new Set(qualifiedTopics.map((t) => t.topic))
  const allExisting = await payload.find({
    collection: 'product-sentiment-conclusions',
    where: { product: { equals: productId } },
    limit: 100,
  })
  let deleted = 0
  for (const doc of allExisting.docs as Array<Record<string, unknown>>) {
    if (!qualifiedTopicNames.has(doc.topic as string)) {
      await payload.delete({
        collection: 'product-sentiment-conclusions',
        where: { id: { equals: doc.id } },
      })
      deleted++
    }
  }

  log.info('Sentiment conclusion stage complete', {
    productId,
    qualifiedTopics: qualifiedTopics.length,
    created,
    updated,
    deleted,
  })

  return { success: true, productId }
}
