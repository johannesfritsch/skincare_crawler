/**
 * Stage 3: OCR Extraction
 *
 * Reads detection crops from each gallery item's `objects[]` array and
 * extracts visible text from product packaging using GPT-4.1-mini vision.
 * OCR results inform compile_detections downstream.
 *
 * Simplified vs video: operates on gallery items instead of video scenes.
 */

import { getOpenAI } from '@/lib/openai'
import type { GalleryStageContext, GalleryStageResult } from './index'

const OCR_MODEL = 'gpt-4.1-mini'

interface OcrResult {
  brandName: string | null
  productName: string | null
  allText: string | null
  volume: string | null
}

export async function executeOcrExtraction(ctx: GalleryStageContext, galleryId: number): Promise<GalleryStageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('gallery-processings', config.jobId)

  // Fetch all items for this gallery
  const itemsResult = await payload.find({
    collection: 'gallery-items',
    where: { gallery: { equals: galleryId } },
    limit: 1000,
    sort: 'position',
  })

  if (itemsResult.docs.length === 0) {
    log.info('No gallery items found, skipping OCR extraction', { galleryId })
    return { success: true }
  }

  let totalTokens = 0
  let totalCropsProcessed = 0
  let totalCropsWithText = 0
  let itemsProcessed = 0
  const serverUrl = payload.serverUrl

  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const itemId = item.id as number
    const objects = item.objects as Array<{
      id?: string
      crop: number | { id: number; url?: string }
      score?: number
      boxXMin?: number
      boxYMin?: number
      boxXMax?: number
      boxYMax?: number
      ocrBrand?: string | null
      ocrProductName?: string | null
      ocrText?: string | null
    }> | null

    if (!objects || objects.length === 0) continue

    // Collect crop images as base64 data URLs
    const cropImages: Array<{ dataUrl: string; objIdx: number }> = []

    for (let objIdx = 0; objIdx < objects.length; objIdx++) {
      const obj = objects[objIdx]
      const cropRef = obj.crop
      let mediaUrl: string | undefined

      if (typeof cropRef === 'number') {
        const mediaDoc = (await payload.findByID({ collection: 'detection-media', id: cropRef })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaUrl = cropRef.url
      }

      if (!mediaUrl) continue

      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

      try {
        const res = await fetch(fullUrl)
        if (!res.ok) continue
        const buffer = Buffer.from(await res.arrayBuffer())
        const contentType = res.headers.get('content-type') || 'image/png'
        const base64 = buffer.toString('base64')
        const dataUrl = `data:${contentType};base64,${base64}`
        cropImages.push({ dataUrl, objIdx })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn('Failed to fetch crop image', { itemId, objIdx, error: msg })
      }
    }

    if (cropImages.length === 0) continue

    log.info('Sending crops to OCR', { itemId, crops: cropImages.length })

    try {
      const imageContent = cropImages.map(({ dataUrl }) => ({
        type: 'image_url' as const,
        image_url: { url: dataUrl, detail: 'low' as const },
      }))

      const maxTokens = Math.min(16000, Math.max(4000, cropImages.length * 500))

      const openai = getOpenAI()
      const response = await openai.chat.completions.create({
        model: OCR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are reading text from ${cropImages.length} product packaging image(s).
For each image (in order), read ALL visible text on the product packaging.
Return a JSON array with exactly ${cropImages.length} entries (one per image, in order):
[{ "brandName": "...", "productName": "...", "allText": "all visible text", "volume": "50ml" }]
Return null for fields you cannot read. Return null for the entire entry if no text is visible at all.
Keep the "allText" field concise — include brand, product name, key claims, and volume. Omit lengthy ingredient lists and legal text.
Return ONLY the JSON array, no markdown formatting.`,
              },
              ...imageContent,
            ],
          },
        ],
        temperature: 0,
        max_tokens: maxTokens,
      })

      const content = response.choices[0]?.message?.content?.trim() ?? '[]'
      const tokens = response.usage?.total_tokens ?? 0
      totalTokens += tokens

      // Parse the JSON response
      let ocrResults: Array<OcrResult | null> = []
      try {
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
        ocrResults = JSON.parse(cleaned)
      } catch {
        log.warn('Failed to parse OCR response as JSON', { itemId, content: content.substring(0, 300) })
        ocrResults = []
      }

      // Write OCR results back to each object entry
      let itemHasText = false
      const updatedObjects = objects.map((obj, idx) => {
        const cropEntry = cropImages.findIndex(ci => ci.objIdx === idx)
        const ocrResult = cropEntry >= 0 && cropEntry < ocrResults.length
          ? ocrResults[cropEntry]
          : null

        const cropId = typeof obj.crop === 'number' ? obj.crop : (obj.crop as { id: number }).id

        const hasText = ocrResult && (ocrResult.brandName || ocrResult.productName || ocrResult.allText)
        if (hasText) {
          totalCropsWithText++
          itemHasText = true
        }

        return {
          ...obj,
          crop: cropId,
          ocrBrand: ocrResult?.brandName ?? null,
          ocrProductName: ocrResult?.productName ?? null,
          ocrText: ocrResult?.allText ?? null,
        }
      })

      totalCropsProcessed += cropImages.length

      await payload.update({
        collection: 'gallery-items',
        id: itemId,
        data: { objects: updatedObjects },
      })

      if (itemHasText) {
        itemsProcessed++
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn('OCR extraction failed for item', { itemId, error: msg })
    }

    await ctx.heartbeat()
  }

  jlog.event('gallery_processing.ocr_extracted', {
    galleryId,
    items: itemsProcessed,
    cropsProcessed: totalCropsProcessed,
    cropsWithText: totalCropsWithText,
    tokens: totalTokens,
  })

  log.info('OCR extraction stage complete', {
    galleryId,
    items: itemsProcessed,
    cropsProcessed: totalCropsProcessed,
    cropsWithText: totalCropsWithText,
    tokens: totalTokens,
  })

  return {
    success: true,
    tokens: { recognition: totalTokens, total: totalTokens },
  }
}
