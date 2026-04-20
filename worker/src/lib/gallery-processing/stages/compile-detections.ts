/**
 * Stage 4: Compile Detections — Product Matching + LLM Consolidation
 *
 * Collects ALL evidence for each gallery item (barcodes, visual search candidates,
 * OCR text), resolves OCR text to products via matchProduct(), and makes a final
 * product decision via LLM.
 *
 * Barcode matches are definitive (confidence 1.0, skip LLM).
 * Items with no objects skip heavy processing.
 * Everything else goes through ONE LLM call per item.
 *
 * Simplified vs video: operates on gallery items instead of video scenes,
 * uses gallery caption instead of transcript for context.
 */

import { getOpenAI } from '@/lib/openai'
import { matchProduct } from '@/lib/match-product'
import type { GalleryStageContext, GalleryStageResult } from './index'

const CONSOLIDATION_MODEL = 'gpt-4.1-mini'

interface EvidenceCandidate {
  productId: number
  productName: string
  brandName: string
  sources: Set<string>
  barcodeValue: string | null
  clipDistances: number[]
}

interface LlmDetection {
  productId: number
  confidence: number
  reasoning: string
}

export async function executeCompileDetections(ctx: GalleryStageContext, galleryId: number): Promise<GalleryStageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('gallery-processings', config.jobId)

  // Fetch the gallery for caption context
  const gallery = await payload.findByID({ collection: 'galleries', id: galleryId }) as Record<string, unknown>
  const caption = (gallery.caption as string) ?? ''

  // Fetch all items for this gallery
  const itemsResult = await payload.find({
    collection: 'gallery-items',
    where: { gallery: { equals: galleryId } },
    limit: 1000,
    sort: 'position',
  })

  if (itemsResult.docs.length === 0) {
    log.info('No gallery items found, skipping compile detections', { galleryId })
    return { success: true }
  }

  let totalDetections = 0
  let barcodeDetections = 0
  let llmDetections = 0
  let totalTokens = 0

  // Cache product info to avoid repeated lookups
  const productInfoCache = new Map<number, { name: string; brand: string }>()

  async function getProductInfo(productId: number): Promise<{ name: string; brand: string }> {
    const cached = productInfoCache.get(productId)
    if (cached) return cached

    try {
      const product = await payload.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
      const name = (product.name as string) || `Product ${productId}`
      const brandRef = product.brand as number | Record<string, unknown> | null
      let brandName = ''
      if (brandRef) {
        if (typeof brandRef === 'number') {
          try {
            const brand = await payload.findByID({ collection: 'brands', id: brandRef }) as Record<string, unknown>
            brandName = (brand.name as string) || ''
          } catch { /* brand not found */ }
        } else {
          brandName = ((brandRef as Record<string, unknown>).name as string) || ''
        }
      }
      const info = { name, brand: brandName }
      productInfoCache.set(productId, info)
      return info
    } catch {
      const info = { name: `Product ${productId}`, brand: '' }
      productInfoCache.set(productId, info)
      return info
    }
  }

  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const itemId = item.id as number

    const candidates = new Map<number, EvidenceCandidate>()

    function getOrCreate(productId: number): EvidenceCandidate {
      let c = candidates.get(productId)
      if (!c) {
        c = {
          productId,
          productName: '',
          brandName: '',
          sources: new Set(),
          barcodeValue: null,
          clipDistances: [],
        }
        candidates.set(productId, c)
      }
      return c
    }

    // ── Step 1: Barcode matches → direct detections (definitive) ──

    const barcodes = item.barcodes as Array<Record<string, unknown>> | undefined
    const barcodeProductIds = new Set<number>()
    if (barcodes) {
      for (const bc of barcodes) {
        const productRef = bc.product as number | Record<string, unknown> | null
        if (!productRef) continue
        const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
        const c = getOrCreate(productId)
        c.sources.add('barcode')
        c.barcodeValue = (bc.barcode as string) ?? null
        barcodeProductIds.add(productId)
      }
    }

    const detectionEntries: Array<Record<string, unknown>> = []

    for (const productId of barcodeProductIds) {
      const c = candidates.get(productId)!
      detectionEntries.push({
        product: productId,
        confidence: 1.0,
        sources: Array.from(c.sources),
        barcodeValue: c.barcodeValue,
        clipDistance: null,
        reasoning: null,
      })
      barcodeDetections++
      totalDetections++
      candidates.delete(productId)
    }

    // ── Step 2: If item has NO objects, skip heavy processing ──

    const objects = item.objects as Array<Record<string, unknown>> | undefined
    const hasObjects = objects && objects.length > 0

    if (!hasObjects) {
      if (detectionEntries.length > 0) {
        detectionEntries.sort((a, b) => (b.confidence as number) - (a.confidence as number))
        await payload.update({
          collection: 'gallery-items',
          id: itemId,
          data: { detections: detectionEntries },
        })
      } else {
        await payload.update({
          collection: 'gallery-items',
          id: itemId,
          data: { detections: [] },
        })
      }
      await ctx.heartbeat()
      continue
    }

    // ── Step 3: Collect candidate products ──

    const recognitions = item.recognitions as Array<Record<string, unknown>> | undefined
    if (recognitions) {
      for (const rec of recognitions) {
        const productRef = rec.product as number | Record<string, unknown> | null
        if (!productRef) continue
        const productId = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
        const c = getOrCreate(productId)
        c.sources.add('object_detection')
        const distance = rec.distance as number | null
        if (distance != null) c.clipDistances.push(distance)
      }
    }

    // Resolve product info for existing candidates
    for (const c of candidates.values()) {
      const info = await getProductInfo(c.productId)
      c.productName = info.name
      c.brandName = info.brand
    }

    // ── Step 4: OCR → product matching ──

    const ocrData: Array<{ cropIndex: number; brand: string | null; productName: string | null; text: string | null }> = []
    if (objects) {
      for (let i = 0; i < objects.length; i++) {
        const obj = objects[i]
        const ocrBrand = obj.ocrBrand as string | null
        const ocrProductName = obj.ocrProductName as string | null
        const ocrText = obj.ocrText as string | null
        if (ocrBrand || ocrProductName || ocrText) {
          ocrData.push({ cropIndex: i, brand: ocrBrand, productName: ocrProductName, text: ocrText })
        }
      }
    }

    const ocrMatchedPairs = new Set<string>()
    for (const ocr of ocrData) {
      if (!ocr.brand && !ocr.productName) continue
      const pairKey = `${(ocr.brand || '').toLowerCase()}|${(ocr.productName || '').toLowerCase()}`
      if (ocrMatchedPairs.has(pairKey)) continue
      ocrMatchedPairs.add(pairKey)

      const alreadyMatched = [...candidates.values()].some(c => {
        if (ocr.brand && c.brandName && ocr.brand.toLowerCase().includes(c.brandName.toLowerCase())) return true
        if (ocr.productName && c.productName && ocr.productName.toLowerCase().includes(c.productName.toLowerCase())) return true
        return false
      })
      if (alreadyMatched) continue

      const searchTerms: string[] = []
      if (ocr.productName) searchTerms.push(ocr.productName)
      if (ocr.brand) searchTerms.push(ocr.brand)

      try {
        const matchResult = await matchProduct(
          payload,
          ocr.brand,
          ocr.productName,
          searchTerms,
          jlog,
        )

        if (matchResult) {
          totalTokens += matchResult.tokensUsed.totalTokens
          const c = getOrCreate(matchResult.productId)
          c.sources.add('ocr')
          c.productName = matchResult.productName
          const info = await getProductInfo(matchResult.productId)
          c.brandName = info.brand
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn('OCR product matching failed', { itemId, brand: ocr.brand, product: ocr.productName, error: msg })
      }
      await ctx.heartbeat()
    }

    // Mark OCR as a source for existing candidates whose text matches
    for (const c of candidates.values()) {
      for (const ocr of ocrData) {
        const nameMatch = ocr.brand && c.brandName && ocr.brand.toLowerCase().includes(c.brandName.toLowerCase())
        const productMatch = ocr.productName && c.productName && ocr.productName.toLowerCase().includes(c.productName.toLowerCase())
        if (nameMatch || productMatch) c.sources.add('ocr')
      }
    }

    // ── Step 5: LLM consolidation (one call per item) ──

    const hasCaption = caption.length > 0

    // Mark caption as a source for candidates mentioned by name
    if (hasCaption) {
      const lowerCaption = caption.toLowerCase()
      for (const c of candidates.values()) {
        if (c.brandName && lowerCaption.includes(c.brandName.toLowerCase())) c.sources.add('caption')
        if (c.productName && lowerCaption.includes(c.productName.toLowerCase())) c.sources.add('caption')
      }
    }

    const nonBarcodeProducts = [...candidates.values()]

    if (nonBarcodeProducts.length > 0) {
      const sections: string[] = []

      const candidateLines = nonBarcodeProducts.map((c, i) => {
        const lines: string[] = []
        const label = c.brandName ? `"${c.productName}" by ${c.brandName}` : `"${c.productName}"`
        lines.push(`${i + 1}. ${label} (ID: ${c.productId})`)
        if (c.clipDistances.length > 0) {
          const best = Math.min(...c.clipDistances)
          lines.push(`   - Visual search: best distance ${best.toFixed(4)} (lower = better match, ${c.clipDistances.length} candidate(s))`)
        }
        if (c.sources.has('ocr')) {
          lines.push(`   - OCR text match`)
        }
        return lines.join('\n')
      })
      sections.push(`CANDIDATE PRODUCTS (identified by visual search, OCR, and/or LLM recognition):\n${candidateLines.join('\n\n')}`)

      if (ocrData.length > 0) {
        const ocrLines = ocrData.map(o => {
          const parts: string[] = [`Crop #${o.cropIndex}`]
          if (o.brand) parts.push(`brand: "${o.brand}"`)
          if (o.productName) parts.push(`product: "${o.productName}"`)
          if (o.text) parts.push(`all text: "${o.text}"`)
          return `- ${parts.join(', ')}`
        })
        sections.push(`OCR TEXT READ FROM PRODUCT CROPS:\n${ocrLines.join('\n')}`)
      }

      if (hasCaption) {
        sections.push(`GALLERY CAPTION:\n"${caption}"`)
      }

      try {
        const prompt = `You are analyzing an Instagram gallery image to determine which beauty/skincare products are actually visible or present.

${sections.join('\n\n')}

Based on ALL the evidence above, which products are actually present in this image?
For each product you believe IS present, provide a confidence score (0.0-1.0) and brief reasoning.
Only include products you are confident are actually present — do NOT include uncertain matches.

Return ONLY a JSON array (no markdown):
[{"productId": <number>, "confidence": <0.0-1.0>, "reasoning": "<brief explanation>"}]
Return an empty array [] if no products are confidently identified.`

        const openai = getOpenAI()
        const response = await openai.chat.completions.create({
          model: CONSOLIDATION_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 1000,
        })

        const content = response.choices[0]?.message?.content?.trim() ?? '[]'
        totalTokens += response.usage?.total_tokens ?? 0

        let llmResults: LlmDetection[] = []
        try {
          const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
          llmResults = JSON.parse(cleaned)
        } catch {
          log.warn('Failed to parse LLM consolidation response', { itemId, content: content.substring(0, 200) })
        }

        for (const det of llmResults) {
          const c = candidates.get(det.productId)
          if (!c) continue

          detectionEntries.push({
            product: det.productId,
            confidence: Math.round(Math.max(0, Math.min(1, det.confidence)) * 100) / 100,
            sources: Array.from(c.sources),
            barcodeValue: null,
            clipDistance: c.clipDistances.length > 0 ? Math.round(Math.min(...c.clipDistances) * 10000) / 10000 : null,
            reasoning: det.reasoning || null,
          })
          llmDetections++
          totalDetections++
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.warn('LLM consolidation failed for item, falling back to formula scoring', { itemId, error: msg })

        // Fallback: formula-based scoring
        for (const c of nonBarcodeProducts) {
          let confidence = 0
          if (c.sources.has('object_detection') && c.clipDistances.length > 0) {
            confidence = Math.max(confidence, 1.0 - Math.min(...c.clipDistances))
          }
          if (c.sources.has('ocr')) {
            confidence = Math.max(confidence, 0.5)
          }
          if (c.sources.size > 1) {
            confidence = Math.min(1.0, confidence + (c.sources.size - 1) * 0.1)
          }
          if (confidence > 0.3) {
            detectionEntries.push({
              product: c.productId,
              confidence: Math.round(confidence * 100) / 100,
              sources: Array.from(c.sources),
              barcodeValue: null,
              clipDistance: c.clipDistances.length > 0 ? Math.round(Math.min(...c.clipDistances) * 10000) / 10000 : null,
              reasoning: 'Fallback: LLM consolidation failed, used formula scoring',
            })
            totalDetections++
          }
        }
      }
    }

    // Sort by confidence descending
    detectionEntries.sort((a, b) => (b.confidence as number) - (a.confidence as number))

    await payload.update({
      collection: 'gallery-items',
      id: itemId,
      data: { detections: detectionEntries },
    })

    if (detectionEntries.length > 0) {
      log.info('Consolidated detections for item', {
        itemId,
        products: detectionEntries.length,
        sources: detectionEntries.map(d => (d.sources as string[]).join('+')).join(', '),
      })
    }

    await ctx.heartbeat()
  }

  jlog.info(`Compile detections complete for gallery ${galleryId}`, { galleryId, totalDetections, barcodeDetections, llmDetections, tokens: totalTokens })
  return {
    success: true,
    tokens: { recognition: totalTokens, total: totalTokens },
  }
}
