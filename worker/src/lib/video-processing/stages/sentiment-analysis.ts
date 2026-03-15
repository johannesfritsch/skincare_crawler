/**
 * Stage 7: Sentiment Analysis
 *
 * Reads scenes with compiled detections and transcript data,
 * runs LLM sentiment analysis per scene, creates video-mentions
 * as the final compiled output with full detection provenance.
 */

import { analyzeSentiment } from '@/lib/video-processing/analyze-sentiment'
import type { StageContext, StageResult } from './index'

export async function executeSentimentAnalysis(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Fetch all scenes
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  // Derive full transcript from scene transcripts (no longer stored on video)
  const fullTranscript = scenesResult.docs
    .map((s) => ((s as Record<string, unknown>).transcript as string) ?? '')
    .filter(Boolean)
    .join(' ')

  let tokensSentiment = 0

  // Build product info map for all detected products across scenes
  const allProductIds = new Set<number>()
  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const detections = scene.detections as Array<Record<string, unknown>> | undefined
    if (detections) {
      for (const det of detections) {
        const productRef = det.product as number | Record<string, unknown> | null
        if (productRef) {
          const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
          allProductIds.add(pid)
        }
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

  // Delete existing video-mentions for this video's scenes (idempotent re-run)
  for (const sceneDoc of scenesResult.docs) {
    const sceneId = (sceneDoc as { id: number }).id
    await payload.delete({
      collection: 'video-mentions',
      where: { videoScene: { equals: sceneId } },
    })
  }

  // Run sentiment analysis per scene
  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number
    const transcript = (scene.transcript as string) ?? ''

    // Get compiled detections for this scene
    const detections = scene.detections as Array<Record<string, unknown>> | undefined
    if (!detections || detections.length === 0 || !transcript.trim()) {
      continue
    }

    // Build product list from compiled detections
    const detectionByProduct = new Map<number, Record<string, unknown>>()
    for (const det of detections) {
      const productRef = det.product as number | Record<string, unknown> | null
      if (!productRef) continue
      const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
      if (!detectionByProduct.has(pid)) {
        detectionByProduct.set(pid, det)
      }
    }

    const segProducts = [...detectionByProduct.keys()]
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
      transcript,
      segProducts,
      fullTranscript,
    )
    tokensSentiment += sentimentResult.tokensUsed.totalTokens

    // Create video-mentions with detection provenance
    for (const productResult of sentimentResult.products) {
      const det = detectionByProduct.get(productResult.productId)

      await payload.create({
        collection: 'video-mentions',
        data: {
          videoScene: sceneId,
          product: productResult.productId,
          // Detection provenance (from compiled detections)
          confidence: det?.confidence ?? null,
          sources: det?.sources ?? [],
          barcodeValue: det?.barcodeValue ?? null,
          clipDistance: det?.clipDistance ?? null,
          // Sentiment
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
      log.info('Created video-mention', { sceneId, productId: productResult.productId, quoteCount: productResult.quotes.length, sentiment: productResult.overallSentiment })
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
