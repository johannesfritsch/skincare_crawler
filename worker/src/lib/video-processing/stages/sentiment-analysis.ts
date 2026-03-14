/**
 * Stage 5: Sentiment Analysis
 *
 * Reads snippets with referencedProducts and transcript data,
 * runs LLM sentiment analysis per snippet, creates video-mentions.
 */

import { analyzeSentiment } from '@/lib/video-processing/analyze-sentiment'
import type { StageContext, StageResult } from './index'

export async function executeSentimentAnalysis(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`
  const fullTranscript = (video.transcript as string) ?? ''

  // Fetch all snippets
  const snippetsResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  let tokensSentiment = 0

  // Build product info map for all referenced products across snippets
  const allProductIds = new Set<number>()
  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const refs = snippet.referencedProducts as Array<number | Record<string, unknown>> | undefined
    if (refs) {
      for (const ref of refs) {
        const pid = typeof ref === 'number' ? ref : (ref as { id: number }).id
        allProductIds.add(pid)
      }
    }
  }

  const productInfoMap = new Map<number, { brandName: string; productName: string }>()
  for (const productId of allProductIds) {
    try {
      const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
      const brandRel = product.brand as Record<string, unknown> | number | null
      let brandName = ''
      if (brandRel && typeof brandRel === 'object' && 'name' in brandRel) {
        brandName = brandRel.name as string
      }
      productInfoMap.set(productId, {
        brandName,
        productName: (product.name as string) ?? '',
      })
    } catch {
      // Product not found, skip
    }
  }

  // Delete existing video-mentions for this video's snippets (idempotent re-run)
  for (const snippetDoc of snippetsResult.docs) {
    const snippetId = (snippetDoc as { id: number }).id
    await payload.delete({
      collection: 'video-mentions',
      where: { videoScene: { equals: snippetId } },
    })
  }

  // Run sentiment analysis per snippet
  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const snippetId = snippet.id as number
    const preTranscript = (snippet.preTranscript as string) ?? ''
    const transcript = (snippet.transcript as string) ?? ''
    const postTranscript = (snippet.postTranscript as string) ?? ''

    // Get product IDs for this snippet
    const refs = snippet.referencedProducts as Array<number | Record<string, unknown>> | undefined
    if (!refs || refs.length === 0 || !transcript.trim()) {
      continue
    }

    const segProductIds = refs.map((ref) =>
      typeof ref === 'number' ? ref : (ref as { id: number }).id,
    )

    const segProducts = [...new Set(segProductIds)]
      .filter((id) => productInfoMap.has(id))
      .map((id) => ({
        productId: id,
        brandName: productInfoMap.get(id)!.brandName,
        productName: productInfoMap.get(id)!.productName,
      }))

    if (segProducts.length === 0) {
      continue
    }

    const sentimentResult = await analyzeSentiment(
      preTranscript,
      transcript,
      postTranscript,
      segProducts,
      fullTranscript,
    )
    tokensSentiment += sentimentResult.tokensUsed.totalTokens

    // Create video-mentions
    for (const productResult of sentimentResult.products) {
      await payload.create({
        collection: 'video-mentions',
        data: {
          videoScene: snippetId,
          product: productResult.productId,
          quotes: productResult.quotes.map((q) => ({
            text: q.text,
            summary: q.summary ?? [],
            sentiment: q.sentiment,
            sentimentScore: q.sentimentScore,
          })),
          overallSentiment: productResult.overallSentiment,
          overallSentimentScore: productResult.overallSentimentScore,
        },
      })
      log.info('Created video-mention', { snippetId, productId: productResult.productId, quoteCount: productResult.quotes.length, sentiment: productResult.overallSentiment })
    }

    await ctx.heartbeat()
  }

  jlog.event('video_processing.sentiment_analyzed', { title, tokens: tokensSentiment })
  log.info('Sentiment analysis stage complete', { videoId, tokens: tokensSentiment })
  return {
    success: true,
    tokens: { sentiment: tokensSentiment, total: tokensSentiment },
  }
}
