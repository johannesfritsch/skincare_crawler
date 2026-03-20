/**
 * Stage 4: OCR Extraction
 *
 * Reads detection crops from each scene's `objects[]` array (from stage 2:
 * object_detection) and extracts visible text from product packaging using
 * GPT-4.1-mini vision. OCR results inform compile_detections downstream
 * (product matching + LLM consolidation).
 *
 * All crops for a scene are sent in a SINGLE vision API call (OCR is cheap
 * via batch). Results are written back to each object entry as ocrBrand,
 * ocrProductName, and ocrText fields.
 *
 * Crop images are downloaded from the server and sent as base64 data URLs
 * (the server may be localhost, which OpenAI's API can't reach).
 */

import { getOpenAI } from '@/lib/openai'
import type { StageContext, StageResult } from './index'

const OCR_MODEL = 'gpt-4.1-mini'

interface OcrResult {
  brandName: string | null
  productName: string | null
  allText: string | null
  volume: string | null
}

export async function executeOcrExtraction(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Fetch all scenes for this video
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    log.info('No scenes found, skipping OCR extraction', { videoId })
    return { success: true }
  }

  let totalTokens = 0
  let totalCropsProcessed = 0
  let totalCropsWithText = 0
  let scenesProcessed = 0
  const serverUrl = payload.serverUrl

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number
    const objects = scene.objects as Array<{
      id?: string
      frame?: number | Record<string, unknown>
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

    // Collect crop images as base64 data URLs for all objects in this scene
    // We download from the server because the server may be localhost (unreachable by OpenAI)
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

      if (!mediaUrl) {
        log.debug('No media URL for crop, skipping', { sceneId, objIdx })
        continue
      }

      const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

      try {
        const res = await fetch(fullUrl)
        if (!res.ok) {
          log.warn('Failed to download crop image', { sceneId, objIdx, url: fullUrl, status: res.status })
          continue
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        const contentType = res.headers.get('content-type') || 'image/png'
        const base64 = buffer.toString('base64')
        const dataUrl = `data:${contentType};base64,${base64}`
        cropImages.push({ dataUrl, objIdx })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn('Failed to fetch crop image', { sceneId, objIdx, url: fullUrl, error: msg })
      }
    }

    if (cropImages.length === 0) {
      log.info('No crop images available for OCR', { sceneId, objectCount: objects.length })
      continue
    }

    log.info('Sending crops to OCR', { sceneId, crops: cropImages.length })

    // Send ALL crop images in a single GPT-4.1-mini vision call
    try {
      const imageContent = cropImages.map(({ dataUrl }) => ({
        type: 'image_url' as const,
        image_url: { url: dataUrl, detail: 'low' as const },
      }))

      // Scale max_tokens with crop count — each crop can produce ~300 tokens of OCR text
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
      const tokens = (response.usage?.total_tokens ?? 0)
      totalTokens += tokens

      log.info('OCR LLM response received', { sceneId, tokens, responseLength: content.length })
      log.debug('OCR raw response', { sceneId, content: content.substring(0, 500) })

      // Parse the JSON response
      let ocrResults: Array<OcrResult | null> = []
      try {
        // Strip markdown code fences if present
        const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
        ocrResults = JSON.parse(cleaned)
        log.info('OCR parsed results', {
          sceneId,
          resultCount: ocrResults.length,
          expectedCount: cropImages.length,
          withBrand: ocrResults.filter(r => r?.brandName).length,
          withProduct: ocrResults.filter(r => r?.productName).length,
          withText: ocrResults.filter(r => r?.allText).length,
        })
      } catch (parseError) {
        const msg = parseError instanceof Error ? parseError.message : String(parseError)
        log.warn('Failed to parse OCR response as JSON', { sceneId, error: msg, content: content.substring(0, 300) })
        ocrResults = []
      }

      // Write OCR results back to each object entry
      let sceneHasText = false
      const updatedObjects = objects.map((obj, idx) => {
        // Find this object's position in the cropImages array
        const cropEntry = cropImages.findIndex(ci => ci.objIdx === idx)
        const ocrResult = cropEntry >= 0 && cropEntry < ocrResults.length
          ? ocrResults[cropEntry]
          : null

        // Resolve relationship refs to IDs for the update
        const frameId = typeof obj.frame === 'number' ? obj.frame : (obj.frame as { id: number } | undefined)?.id
        const cropId = typeof obj.crop === 'number' ? obj.crop : (obj.crop as { id: number }).id

        const hasText = ocrResult && (ocrResult.brandName || ocrResult.productName || ocrResult.allText)
        if (hasText) {
          totalCropsWithText++
          sceneHasText = true
          log.info('OCR result for crop', {
            sceneId,
            objIdx: idx,
            brand: ocrResult.brandName,
            product: ocrResult.productName,
            textLength: ocrResult.allText?.length ?? 0,
          })
        }

        return {
          ...obj,
          frame: frameId,
          crop: cropId,
          ocrBrand: ocrResult?.brandName ?? null,
          ocrProductName: ocrResult?.productName ?? null,
          ocrText: ocrResult?.allText ?? null,
        }
      })

      totalCropsProcessed += cropImages.length

      log.info('Updating scene with OCR data', {
        sceneId,
        objectCount: updatedObjects.length,
        withOcr: updatedObjects.filter(o => o.ocrBrand || o.ocrProductName || o.ocrText).length,
      })

      await payload.update({
        collection: 'video-scenes',
        id: sceneId,
        data: { objects: updatedObjects },
      })

      if (sceneHasText) {
        scenesProcessed++
      }

      log.info('OCR extraction for scene complete', {
        sceneId,
        crops: cropImages.length,
        withText: updatedObjects.filter(o => o.ocrBrand || o.ocrProductName || o.ocrText).length,
        tokens,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.warn('OCR extraction failed for scene', { sceneId, error: msg })
    }

    await ctx.heartbeat()
  }

  jlog.event('video_processing.ocr_extracted', {
    title,
    scenes: scenesProcessed,
    cropsProcessed: totalCropsProcessed,
    cropsWithText: totalCropsWithText,
    tokens: totalTokens,
  })

  log.info('OCR extraction stage complete', {
    videoId,
    scenes: scenesProcessed,
    cropsProcessed: totalCropsProcessed,
    cropsWithText: totalCropsWithText,
    tokens: totalTokens,
  })

  return {
    success: true,
    tokens: { recognition: totalTokens, total: totalTokens },
  }
}
