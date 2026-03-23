/**
 * Stage 10: Sentiment Conclusion
 *
 * Reads aggregated product-sentiments for the product, builds origin groups
 * (All, Incentivized, Organic, per-individual-origin), filters topics with
 * sufficient volume (dynamic thresholds), determines the overall conclusion
 * (positive/negative/divided) and strength (based on volume), then upserts
 * product-sentiment-conclusions records per group.
 *
 * No LLM needed — conclusions are derived algorithmically from the counts.
 */

import type { StageContext, StageResult, AggregationWorkItem } from './index'

/** Minimum total votes for aggregate groups (All, Incentivized, Organic) */
const MIN_VOTES_AGGREGATE = 5
/** Lower threshold for individual origin groups */
const MIN_VOTES_INDIVIDUAL = 3

type GroupType = 'all' | 'incentivized' | 'organic' | 'individual'

interface SentimentRecord {
  topic: string
  sentiment: 'positive' | 'neutral' | 'negative'
  amount: number
  reviewOrigin: { id: number; incentivized?: boolean | null } | number | null
}

interface TopicSummary {
  topic: string
  positive: number
  neutral: number
  negative: number
  total: number
}

interface GroupDef {
  groupType: GroupType
  originId: number | null
  minVotes: number
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

function getOriginId(origin: SentimentRecord['reviewOrigin']): number | null {
  if (!origin) return null
  if (typeof origin === 'number') return origin
  return (origin.id as number) ?? null
}

function isIncentivized(origin: SentimentRecord['reviewOrigin']): boolean {
  if (!origin || typeof origin === 'number') return false
  return origin.incentivized === true
}

export async function executeSentimentConclusion(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, log } = ctx
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // 1. Fetch all product-sentiments for this product (depth=1 to populate reviewOrigin)
  const sentimentsResult = await payload.find({
    collection: 'product-sentiments',
    where: { product: { equals: productId } },
    limit: 500,
    depth: 1,
  })
  const sentiments = sentimentsResult.docs as unknown as SentimentRecord[]

  if (sentiments.length === 0) {
    log.info('No sentiment data for conclusions — skipping', { productId })
    return { success: true, productId }
  }

  // 2. Discover distinct origins and build group definitions
  const individualOriginIds = new Set<number>()
  let hasOriginData = false
  for (const s of sentiments) {
    const oid = getOriginId(s.reviewOrigin)
    if (oid !== null) {
      individualOriginIds.add(oid)
      hasOriginData = true
    }
  }

  const groups: GroupDef[] = [
    { groupType: 'all', originId: null, minVotes: MIN_VOTES_AGGREGATE },
  ]

  // Only add Incentivized/Organic/Individual groups if origin data exists
  if (hasOriginData) {
    groups.push(
      { groupType: 'incentivized', originId: null, minVotes: MIN_VOTES_AGGREGATE },
      { groupType: 'organic', originId: null, minVotes: MIN_VOTES_AGGREGATE },
    )
    for (const oid of individualOriginIds) {
      groups.push({ groupType: 'individual', originId: oid, minVotes: MIN_VOTES_INDIVIDUAL })
    }
  }

  log.debug('Sentiment conclusion: groups', {
    productId,
    groups: groups.length,
    individualOrigins: individualOriginIds.size,
    hasOriginData,
  })

  // 3. For each group, aggregate topic summaries and derive conclusions
  let totalCreated = 0
  let totalUpdated = 0
  const allQualifiedKeys = new Set<string>() // track for cleanup

  for (const group of groups) {
    // Filter sentiments for this group
    const filtered = sentiments.filter((s) => {
      if (group.groupType === 'all') return true
      if (group.groupType === 'individual') return getOriginId(s.reviewOrigin) === group.originId
      if (group.groupType === 'incentivized') return isIncentivized(s.reviewOrigin)
      // organic = NOT incentivized (includes null origin and incentivized !== true)
      return !isIncentivized(s.reviewOrigin)
    })

    // Group by topic
    const byTopic = new Map<string, TopicSummary>()
    for (const s of filtered) {
      if (!byTopic.has(s.topic)) {
        byTopic.set(s.topic, { topic: s.topic, positive: 0, neutral: 0, negative: 0, total: 0 })
      }
      const entry = byTopic.get(s.topic)!
      entry[s.sentiment] += s.amount
      entry.total += s.amount
    }

    // Filter by threshold
    const qualified = Array.from(byTopic.values()).filter((t) => t.total >= group.minVotes)

    // Upsert conclusions for this group
    for (const topic of qualified) {
      const conclusion = deriveConclusion(topic)
      const strength = deriveStrength(topic.total)

      // Build unique key for cleanup tracking
      const cleanupKey = `${topic.topic}:${group.groupType}:${group.originId ?? 'null'}`
      allQualifiedKeys.add(cleanupKey)

      // Upsert by (product, topic, groupType, reviewOrigin)
      const whereConditions: Array<Record<string, unknown>> = [
        { product: { equals: productId } },
        { topic: { equals: topic.topic } },
        { groupType: { equals: group.groupType } },
      ]
      if (group.originId) {
        whereConditions.push({ reviewOrigin: { equals: group.originId } })
      } else {
        whereConditions.push({ reviewOrigin: { exists: false } })
      }

      const existing = await payload.find({
        collection: 'product-sentiment-conclusions',
        where: { and: whereConditions },
        limit: 1,
      })

      if (existing.docs.length > 0) {
        const doc = existing.docs[0] as Record<string, unknown>
        await payload.update({
          collection: 'product-sentiment-conclusions',
          id: doc.id as number,
          data: { conclusion, strength, volume: topic.total },
        })
        totalUpdated++
      } else {
        await payload.create({
          collection: 'product-sentiment-conclusions',
          data: {
            product: productId,
            topic: topic.topic,
            groupType: group.groupType,
            conclusion,
            strength,
            volume: topic.total,
            ...(group.originId ? { reviewOrigin: group.originId } : {}),
          },
        })
        totalCreated++
      }
    }
  }

  // 4. Delete stale conclusions for this product that are no longer qualified
  const allExisting = await payload.find({
    collection: 'product-sentiment-conclusions',
    where: { product: { equals: productId } },
    limit: 500,
    depth: 1,
  })
  let totalDeleted = 0
  for (const doc of allExisting.docs as Array<Record<string, unknown>>) {
    const docOriginId = getOriginId(doc.reviewOrigin as SentimentRecord['reviewOrigin'])
    const key = `${doc.topic}:${doc.groupType}:${docOriginId ?? 'null'}`
    if (!allQualifiedKeys.has(key)) {
      await payload.delete({
        collection: 'product-sentiment-conclusions',
        where: { id: { equals: doc.id } },
      })
      totalDeleted++
    }
  }

  log.info('Sentiment conclusion stage complete', {
    productId,
    groups: groups.length,
    created: totalCreated,
    updated: totalUpdated,
    deleted: totalDeleted,
  })

  return { success: true, productId }
}
