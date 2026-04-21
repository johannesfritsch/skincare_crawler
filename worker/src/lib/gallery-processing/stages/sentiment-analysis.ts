/**
 * Stage 5: Sentiment Analysis
 *
 * Reads gallery items with compiled detections and the parent gallery's
 * caption/comments. Runs LLM sentiment analysis using caption + OCR text
 * as input (instead of transcript). Creates gallery-mentions as the final
 * compiled output with full detection provenance.
 *
 * KEY DIFFERENCE from video: Uses gallery caption + comments + OCR text
 * instead of video transcript.
 */

import { analyzeSentiment } from '@/lib/video-processing/analyze-sentiment'
import type { GalleryStageContext, GalleryStageResult } from './index'

export async function executeSentimentAnalysis(ctx: GalleryStageContext, galleryId: number): Promise<GalleryStageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('gallery-processings', config.jobId)

  // Fetch the gallery for caption
  const gallery = await payload.findByID({ collection: 'galleries', id: galleryId }) as Record<string, unknown>
  const caption = (gallery.caption as string) ?? ''

  // Build full text context from caption + comments (fetched from gallery-comments collection)
  let commentsText = ''
  const commentsResult = await payload.find({
    collection: 'gallery-comments',
    where: { gallery: { equals: galleryId } },
    limit: 100,
    sort: '-likeCount',
  })
  const comments = commentsResult.docs as Array<Record<string, unknown>>
  commentsText = comments
    .map((c) => {
      const user = (c.username as string) ?? ''
      const text = (c.text as string) ?? ''
      return user ? `${user}: ${text}` : text
    })
    .filter(Boolean)
    .join('\n')

  // Fetch all items
  const itemsResult = await payload.find({
    collection: 'gallery-items',
    where: { gallery: { equals: galleryId } },
    limit: 1000,
    sort: 'position',
  })

  // Build product info map for all detected products across items
  const allProductIds = new Set<number>()
  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const detections = item.detections as Array<Record<string, unknown>> | undefined
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

  if (allProductIds.size === 0) {
    log.info('No detected products, skipping sentiment analysis', { galleryId })
    return { success: true }
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

  // Delete existing gallery-mentions for this gallery's items (idempotent re-run)
  for (const itemDoc of itemsResult.docs) {
    const itemId = (itemDoc as { id: number }).id
    await payload.delete({
      collection: 'gallery-mentions',
      where: { galleryItem: { equals: itemId } },
    })
  }

  let tokensSentiment = 0

  // Collect OCR text from all items for context
  const allOcrTexts: string[] = []
  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const objects = item.objects as Array<Record<string, unknown>> | undefined
    if (objects) {
      for (const obj of objects) {
        const ocrText = obj.ocrText as string | null
        if (ocrText) allOcrTexts.push(ocrText)
      }
    }
  }

  // Build the text input: caption is primary, OCR text provides additional context
  const ocrContext = allOcrTexts.length > 0 ? `\n\nProduct packaging text found in images:\n${allOcrTexts.join('\n')}` : ''
  const commentsContext = commentsText ? `\n\nUser comments:\n${commentsText}` : ''
  const fullText = caption + ocrContext + commentsContext

  if (!fullText.trim()) {
    log.info('No text content for sentiment analysis', { galleryId })
    return { success: true }
  }

  // Run sentiment analysis per item (each item may have different detected products)
  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const itemId = item.id as number

    const detections = item.detections as Array<Record<string, unknown>> | undefined
    if (!detections || detections.length === 0) continue

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

    const itemProducts = [...detectionByProduct.keys()]
      .filter((id) => productInfoMap.has(id))
      .map((id) => ({
        productId: id,
        brandName: productInfoMap.get(id)!.brandName,
        productName: productInfoMap.get(id)!.productName,
      }))

    if (itemProducts.length === 0) continue

    // Use the full gallery text as both the segment and context
    const sentimentResult = await analyzeSentiment(
      fullText,
      itemProducts,
    )
    tokensSentiment += sentimentResult.tokensUsed.totalTokens

    // Create gallery-mentions with detection provenance
    for (const productResult of sentimentResult.products) {
      const det = detectionByProduct.get(productResult.productId)

      await payload.create({
        collection: 'gallery-mentions',
        data: {
          galleryItem: itemId,
          gallery: galleryId,
          product: productResult.productId,
          // Detection provenance
          confidence: det?.confidence ?? null,
          sources: det?.sources ?? [],
          barcodeValue: det?.barcodeValue ?? null,
          clipDistance: det?.clipDistance ?? null,
          // Sentiment
          quotes: productResult.quotes.map((q) => ({
            text: q.text,
            summary: (q.summary ?? []).map((s) => ({ text: s })),
            sentiment: q.sentiment,
            sentimentScore: q.sentimentScore,
          })),
          overallSentiment: productResult.overallSentiment,
          overallSentimentScore: productResult.overallSentimentScore,
        },
      })
      log.info('Created gallery-mention', { itemId, productId: productResult.productId, quoteCount: productResult.quotes.length, sentiment: productResult.overallSentiment })
    }

    await ctx.heartbeat()
  }

  jlog.event('gallery_processing.sentiment_analyzed', { galleryId, tokens: tokensSentiment })
  log.info('Sentiment analysis stage complete', { galleryId, tokens: tokensSentiment })
  return {
    success: true,
    tokens: { sentiment: tokensSentiment, total: tokensSentiment },
  }
}
