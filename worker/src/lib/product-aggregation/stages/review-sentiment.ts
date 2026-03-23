/**
 * Stage 9: Review Sentiment
 *
 * Analyzes source-reviews via GPT 4.1-mini to extract per-topic sentiment counts.
 * Each review can contribute +1 to multiple topic-sentiment pairs. Results are
 * stored in the product-sentiments collection. A reviewState JSON field on the job
 * prevents re-processing reviews that were already analyzed.
 */

import type { StageContext, StageResult, AggregationWorkItem } from './index'
import { getOpenAI } from '@/lib/openai'
import OpenAI from 'openai'

const TOPICS = [
  'smell', 'texture', 'color', 'consistency', 'absorption', 'stickiness',
  'lather', 'efficacy', 'longevity', 'finish', 'afterFeel', 'skinTolerance',
  'allergenPotential', 'dispensing', 'travelSafety', 'animalTesting',
] as const

const SENTIMENTS = ['positive', 'neutral', 'negative'] as const

type Topic = typeof TOPICS[number]
type Sentiment = typeof SENTIMENTS[number]

const SYSTEM_PROMPT = `You are a cosmetics review analyst. For each review, identify which product topics are mentioned and whether the sentiment toward each topic is positive, negative, or neutral.

Topics: smell, texture, color, consistency, absorption, stickiness, lather, efficacy, longevity, finish, afterFeel, skinTolerance, allergenPotential, dispensing, travelSafety, animalTesting

Rules:
- Only include topics that are EXPLICITLY discussed in the review text
- Each review may mention 0 or more topics
- A review mentioning "smells great" → { "t": "smell", "s": "positive" }
- A review mentioning "broke me out" → { "t": "skinTolerance", "s": "negative" }
- If a topic isn't mentioned, don't include it
- Return valid JSON array`

interface LLMReviewResult {
  i: number
  t: Array<{ t: string; s: string }>
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

export async function executeReviewSentiment(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // 1. Collect source-product IDs
  const allSources = workItem.variants.flatMap((v) => v.sources)
  const sourceProductIds = [...new Set(allSources.map((s) => s.sourceProductId))]

  log.debug('Review sentiment: collecting sources', {
    productId,
    sourceProductIds: sourceProductIds.length,
    variantCount: workItem.variants.length,
    gtins: workItem.gtins.join(', '),
  })

  if (sourceProductIds.length === 0) {
    log.info('No source products for review sentiment — skipping', { productId })
    return { success: true, productId }
  }

  // 2. Read reviewState from job
  const job = await payload.findByID({ collection: 'product-aggregations', id: config.jobId }) as Record<string, unknown>
  let reviewState: Record<string, number> = {}
  if (job.reviewState) {
    try {
      reviewState = typeof job.reviewState === 'string' ? JSON.parse(job.reviewState) : (job.reviewState as Record<string, number>)
    } catch {
      reviewState = {}
    }
  }
  const alreadyProcessed = reviewState[String(productId)] ?? 0

  log.debug('Review sentiment: state loaded', {
    productId,
    alreadyProcessed,
    reviewStateKeys: Object.keys(reviewState).length,
  })

  // 3. Count total reviews
  const countResult = await payload.count({
    collection: 'source-reviews',
    where: { sourceProduct: { in: sourceProductIds } },
  })
  const totalReviews = countResult.totalDocs

  log.debug('Review sentiment: review count', {
    productId,
    totalReviews,
    alreadyProcessed,
    newReviews: totalReviews - alreadyProcessed,
  })

  if (totalReviews === 0) {
    log.info('No reviews to analyze — skipping', { productId })
    return { success: true, productId }
  }

  if (totalReviews === alreadyProcessed) {
    log.info('All reviews already processed — skipping', { productId, totalReviews })
    return { success: true, productId }
  }

  // 3b. Delete-before-reprocess guard: when reviewState is 0 (fresh run), clear existing
  // product-sentiments for this product to prevent double-counting on re-runs
  if (alreadyProcessed === 0) {
    const existingSentiments = await payload.find({
      collection: 'product-sentiments',
      where: { product: { equals: productId } },
      limit: 1,
    })
    if (existingSentiments.totalDocs > 0) {
      await payload.delete({
        collection: 'product-sentiments',
        where: { product: { equals: productId } },
      })
      log.info('Review sentiment: cleared existing sentiments for fresh run', {
        productId,
        deleted: existingSentiments.totalDocs,
      })
    }
  }

  // 4. Fetch ALL reviews sorted by id for deterministic ordering (depth=1 to populate reviewOrigin)
  const allReviewsResult = await payload.find({
    collection: 'source-reviews',
    where: { sourceProduct: { in: sourceProductIds } },
    sort: 'id',
    limit: 10000,
    depth: 1,
  })
  const allReviews = allReviewsResult.docs as Array<Record<string, unknown>>

  log.debug('Review sentiment: fetched reviews', {
    productId,
    fetched: allReviews.length,
    totalDocs: allReviewsResult.totalDocs,
  })

  // 4b. Build origin map: reviewIndex → originId (or null for native reviews)
  // This maps each review's position in the array to its review-origin ID,
  // so we can tag topic-sentiment counts with the origin after LLM processing.
  const reviewOriginMap = new Map<number, number | null>()
  for (let i = 0; i < allReviews.length; i++) {
    const origin = allReviews[i].reviewOrigin as Record<string, unknown> | number | null | undefined
    if (origin && typeof origin === 'object' && origin.id) {
      reviewOriginMap.set(i, origin.id as number)
    } else if (origin && typeof origin === 'number') {
      reviewOriginMap.set(i, origin)
    } else {
      reviewOriginMap.set(i, null)
    }
  }

  // 5. Skip already-processed, keep new
  const newReviews = allReviews.slice(alreadyProcessed)

  if (newReviews.length === 0) {
    log.info('No new reviews after skip', { productId, alreadyProcessed })
    return { success: true, productId }
  }

  // 6. Read chunk size and timeout from job config
  const chunkSize = (job.reviewSentimentChunkSize as number) || 20
  const timeoutMs = ((job.reviewSentimentTimeoutSec as number) || 60) * 1000
  const maxChunkRetries = 3

  // 7. Batch into chunks and process with LLM
  const chunks = chunkArray(newReviews, chunkSize)
  const topicCounts = new Map<string, number>()
  let tokensUsed = 0
  let totalTopicEntries = 0
  let reviewsWithTopics = 0
  let reviewsWithoutTopics = 0
  let chunkErrors = 0
  let parseErrors = 0
  let skippedInvalidTopics = 0

  log.info('Review sentiment: starting LLM analysis', {
    productId,
    newReviews: newReviews.length,
    chunks: chunks.length,
    chunkSize,
  })

  const openai = getOpenAI()

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const chunk = chunks[chunkIdx]
    const chunkStartMs = Date.now()

    // Build user message with review texts
    const reviewLines = chunk.map((review, idx) => {
      const text = (review.reviewText as string) || (review.title as string) || ''
      return `[${idx}] "${text.replace(/"/g, '\\"')}"`
    }).join('\n')

    const userMessage = `Analyze these reviews:\n\n${reviewLines}\n\nReturn JSON: [{"i": 0, "t": [{"t": "smell", "s": "positive"}, ...]}, ...]`

    log.debug(`Review sentiment: chunk ${chunkIdx + 1}/${chunks.length}`, {
      productId,
      chunkReviews: chunk.length,
      inputChars: userMessage.length,
      timeoutMs,
    })

    // Retry loop for transient failures (timeouts, rate limits)
    let content: string | null = null
    let chunkTokens = 0
    let succeeded = false

    for (let attempt = 1; attempt <= maxChunkRetries; attempt++) {
      try {
        const response = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userMessage },
          ],
        }, { timeout: timeoutMs })

        chunkTokens = response.usage?.total_tokens ?? 0
        tokensUsed += chunkTokens
        content = response.choices[0]?.message?.content ?? null
        succeeded = true
        break
      } catch (err) {
        const isTimeout = err instanceof OpenAI.APIConnectionTimeoutError
          || (err instanceof Error && err.message.includes('timeout'))
        const isRetryable = isTimeout
          || err instanceof OpenAI.RateLimitError
          || err instanceof OpenAI.InternalServerError

        if (isRetryable && attempt < maxChunkRetries) {
          const waitMs = attempt * 2000
          log.warn(`Review sentiment: chunk ${chunkIdx + 1} attempt ${attempt}/${maxChunkRetries} failed, retrying in ${waitMs}ms`, {
            productId,
            error: String(err),
            isTimeout,
          })
          await new Promise((resolve) => setTimeout(resolve, waitMs))
          continue
        }

        log.warn(`Review sentiment: chunk ${chunkIdx + 1} failed after ${attempt} attempt(s)`, {
          productId,
          error: String(err),
          isTimeout,
        })
        break
      }
    }

    if (!succeeded) {
      chunkErrors++
      ctx.heartbeat()
      continue
    }

    if (!content) {
      log.warn(`Review sentiment: chunk ${chunkIdx + 1} returned empty content`, { productId })
      chunkErrors++
      ctx.heartbeat()
      continue
    }

    // Parse LLM response — json_object mode always returns an object wrapper,
    // so we need to find the array inside whatever key the LLM chose
    let parsed: LLMReviewResult[]
    try {
      const raw = JSON.parse(content)
      if (Array.isArray(raw)) {
        parsed = raw
      } else if (typeof raw === 'object' && raw !== null) {
        // Find the first array value in the object (LLM may use any key)
        const arrayValue = Object.values(raw).find((v) => Array.isArray(v))
        if (arrayValue) {
          parsed = arrayValue as LLMReviewResult[]
        } else {
          log.warn(`Review sentiment: chunk ${chunkIdx + 1} no array found in response`, {
            productId,
            responseKeys: Object.keys(raw).join(', '),
            contentPreview: content.slice(0, 500),
          })
          parseErrors++
          ctx.heartbeat()
          continue
        }
      } else {
        parsed = []
      }
    } catch {
      log.warn(`Review sentiment: chunk ${chunkIdx + 1} JSON parse failed`, {
        productId,
        contentPreview: content.slice(0, 500),
      })
      parseErrors++
      ctx.heartbeat()
      continue
    }

    log.debug(`Review sentiment: chunk ${chunkIdx + 1} parsed`, {
      productId,
      parsedEntries: parsed.length,
      sampleEntry: parsed.length > 0 ? JSON.stringify(parsed[0]).slice(0, 200) : 'none',
    })

    // Aggregate topic-sentiment counts from this chunk
    let chunkTopicEntries = 0
    let chunkReviewsWithTopics = 0
    let chunkReviewsWithoutTopics = 0
    let chunkInvalidTopics = 0

    for (const entry of parsed) {
      if (!Array.isArray(entry.t)) {
        chunkReviewsWithoutTopics++
        continue
      }
      if (entry.t.length === 0) {
        chunkReviewsWithoutTopics++
        continue
      }

      let hasValidTopic = false
      for (const topicEntry of entry.t) {
        const topic = topicEntry.t as Topic
        const sentiment = topicEntry.s as Sentiment
        if (!TOPICS.includes(topic) || !SENTIMENTS.includes(sentiment)) {
          chunkInvalidTopics++
          continue
        }
        // Tag with review's origin (post-LLM grouping)
        const reviewGlobalIdx = alreadyProcessed + (chunkIdx * chunkSize) + entry.i
        const originId = reviewOriginMap.get(reviewGlobalIdx) ?? null
        const key = `${topic}:${sentiment}:${originId ?? 'null'}`
        topicCounts.set(key, (topicCounts.get(key) ?? 0) + 1)
        chunkTopicEntries++
        hasValidTopic = true
      }

      if (hasValidTopic) {
        chunkReviewsWithTopics++
      } else {
        chunkReviewsWithoutTopics++
      }
    }

    totalTopicEntries += chunkTopicEntries
    reviewsWithTopics += chunkReviewsWithTopics
    reviewsWithoutTopics += chunkReviewsWithoutTopics
    skippedInvalidTopics += chunkInvalidTopics

    const chunkDurationMs = Date.now() - chunkStartMs

    log.debug(`Review sentiment: chunk ${chunkIdx + 1}/${chunks.length} done`, {
      productId,
      chunkDurationMs,
      chunkTokens,
      parsedEntries: parsed.length,
      chunkTopicEntries,
      chunkReviewsWithTopics,
      chunkReviewsWithoutTopics,
      chunkInvalidTopics,
    })

    ctx.heartbeat()
  }

  // Log aggregated topic counts before upserting
  log.info('Review sentiment: LLM analysis complete', {
    productId,
    newReviews: newReviews.length,
    reviewsWithTopics,
    reviewsWithoutTopics,
    totalTopicEntries,
    uniqueTopicSentimentPairs: topicCounts.size,
    chunkErrors,
    parseErrors,
    skippedInvalidTopics,
    tokensUsed,
  })

  // Log each topic:sentiment pair for full visibility
  if (topicCounts.size > 0) {
    const topicBreakdown: Record<string, number> = {}
    const sentimentTotals: Record<string, number> = { positive: 0, neutral: 0, negative: 0 }
    for (const [key, count] of topicCounts) {
      topicBreakdown[key] = count
      const sentiment = key.split(':')[1]
      sentimentTotals[sentiment] = (sentimentTotals[sentiment] ?? 0) + count
    }

    log.debug('Review sentiment: topic breakdown', {
      productId,
      ...topicBreakdown,
    })

    log.info('Review sentiment: sentiment totals', {
      productId,
      positive: sentimentTotals.positive,
      neutral: sentimentTotals.neutral,
      negative: sentimentTotals.negative,
      totalEntries: totalTopicEntries,
    })
  }

  // 8. Upsert product-sentiments records
  let upsertCreated = 0
  let upsertUpdated = 0

  for (const [key, count] of topicCounts) {
    const parts = key.split(':')
    const topic = parts[0]
    const sentiment = parts[1]
    const originIdStr = parts[2]
    const originId = originIdStr === 'null' ? null : Number(originIdStr)

    // Build where clause with origin dimension
    const whereConditions: Array<Record<string, unknown>> = [
      { product: { equals: productId } },
      { topic: { equals: topic } },
      { sentiment: { equals: sentiment } },
    ]
    if (originId) {
      whereConditions.push({ reviewOrigin: { equals: originId } })
    } else {
      whereConditions.push({ reviewOrigin: { exists: false } })
    }

    const existing = await payload.find({
      collection: 'product-sentiments',
      where: { and: whereConditions },
      limit: 1,
    })

    if (existing.docs.length > 0) {
      const doc = existing.docs[0] as Record<string, unknown>
      const oldAmount = (doc.amount as number) ?? 0
      const newAmount = oldAmount + count
      await payload.update({
        collection: 'product-sentiments',
        id: doc.id as number,
        data: { amount: newAmount },
      })
      log.debug('Review sentiment: updated record', {
        productId,
        topic,
        sentiment,
        originId,
        oldAmount,
        added: count,
        newAmount,
      })
      upsertUpdated++
    } else {
      await payload.create({
        collection: 'product-sentiments',
        data: {
          product: productId,
          topic,
          sentiment,
          amount: count,
          ...(originId ? { reviewOrigin: originId } : {}),
        },
      })
      log.debug('Review sentiment: created record', {
        productId,
        topic,
        sentiment,
        originId,
        amount: count,
      })
      upsertCreated++
    }
  }

  // 9. Update reviewState
  reviewState[String(productId)] = totalReviews
  await payload.update({
    collection: 'product-aggregations',
    id: config.jobId,
    data: { reviewState },
  })

  log.info('Review sentiment stage complete', {
    productId,
    newReviews: newReviews.length,
    totalReviews,
    reviewsWithTopics,
    reviewsWithoutTopics,
    uniquePairs: topicCounts.size,
    upsertCreated,
    upsertUpdated,
    chunkErrors,
    parseErrors,
    skippedInvalidTopics,
    tokensUsed,
  })

  return { success: true, productId, tokensUsed }
}
