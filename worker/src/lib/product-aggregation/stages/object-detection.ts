/**
 * Stage 5: Object Detection
 *
 * Per variant: takes ALL uploaded product images (public + recognition_only),
 * runs Grounding DINO to detect "cosmetics packaging" bounding boxes on each,
 * crops each detected region using sharp, uploads the crops as media, and stores
 * them in the product-variant's `recognitionImages` array field.
 *
 * This gives us detection crops from every store's image of the product — not just
 * the single "best" image — providing a much richer set of recognition embeddings
 * for the video search pipeline to match against.
 *
 * Uses @huggingface/transformers with onnxruntime-node for local inference.
 * The model (onnx-community/grounding-dino-tiny-ONNX) is lazily loaded
 * on first call and reused across all subsequent invocations.
 */

import sharp from 'sharp'
import { getDetector } from '@/lib/models/grounding-dino'
import type { StageContext, StageResult, AggregationWorkItem } from './index'

const DETECTION_PROMPT = 'cosmetics packaging.'

export async function executeObjectDetection(ctx: StageContext, workItem: AggregationWorkItem): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('product-aggregations', config.jobId)
  const detectionThreshold = config.detectionThreshold ?? 0.3
  const minBoxArea = config.minBoxArea ?? 0.05
  const productId = workItem.productId

  if (!productId) {
    return { success: false, error: 'No productId — resolve stage must run first' }
  }

  // Lazily load the detector
  log.info('Loading Grounding DINO model (first call may download ~700MB)')
  const detector = await getDetector()
  log.info('Grounding DINO model ready')

  let totalDetections = 0

  for (const v of workItem.variants) {
    // Find the product-variant for this GTIN
    const pvResult = await payload.find({
      collection: 'product-variants',
      where: { gtin: { equals: v.gtin } },
      limit: 1,
    })
    if (pvResult.docs.length === 0) continue
    const pv = pvResult.docs[0] as Record<string, unknown>
    const variantId = (pv as { id: number }).id

    // Get ALL images from the variant's images array
    const images = pv.images as Array<{
      image: number | { id: number; url?: string; filename?: string }
      visibility?: string
      source?: string
    }> | null

    if (!images || images.length === 0) {
      log.info('No images on variant, skipping object detection', { gtin: v.gtin })
      // Clear any existing recognitionImages and their embeddings
      await payload.update({
        collection: 'product-variants',
        id: variantId,
        data: { recognitionImages: [] },
      })
      await payload.embeddings.delete('recognition-images', { product_variant_id: variantId })
      continue
    }

    log.info('Running object detection on all variant images', { gtin: v.gtin, imageCount: images.length })

    // Accumulate all detection crops across all images
    const recognitionImages: Array<{
      image: number
      score: number
      boxXMin: number
      boxYMin: number
      boxXMax: number
      boxYMax: number
    }> = []

    for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
      const imageEntry = images[imgIdx]
      const imageRef = imageEntry.image
      let mediaId: number
      let mediaUrl: string | undefined

      if (typeof imageRef === 'number') {
        mediaId = imageRef
        const mediaDoc = await payload.findByID({ collection: 'product-media', id: mediaId }) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaId = imageRef.id
        mediaUrl = imageRef.url
      }

      if (!mediaUrl) {
        log.debug('No media URL for image entry, skipping', { gtin: v.gtin, imgIdx, mediaId })
        continue
      }

      const fullImageUrl = mediaUrl.startsWith('http')
        ? mediaUrl
        : `${payload.serverUrl}${mediaUrl}`

      try {
        // Download the image for processing
        const imageRes = await fetch(fullImageUrl)
        if (!imageRes.ok) {
          log.debug('Failed to download image for detection', { gtin: v.gtin, imgIdx, status: imageRes.status })
          continue
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

        // Get original image dimensions for cropping
        const metadata = await sharp(imageBuffer).metadata()
        const imgWidth = metadata.width ?? 0
        const imgHeight = metadata.height ?? 0
        if (imgWidth === 0 || imgHeight === 0) continue

        // Run Grounding DINO detection
        const detections = await detector(fullImageUrl, [DETECTION_PROMPT], {
          threshold: detectionThreshold,
        })

        if (!detections || detections.length === 0) {
          log.debug('No objects detected in image', { gtin: v.gtin, imgIdx, source: imageEntry.source ?? '?' })
          continue
        }

        log.info('Objects detected', {
          gtin: v.gtin,
          imgIdx,
          source: imageEntry.source ?? '?',
          count: detections.length,
          scores: detections.map((d) => d.score.toFixed(2)).join(', '),
        })

        for (let i = 0; i < detections.length; i++) {
          const det = detections[i]

          const xmin = Math.max(0, Math.round(det.box.xmin))
          const ymin = Math.max(0, Math.round(det.box.ymin))
          const xmax = Math.min(imgWidth, Math.round(det.box.xmax))
          const ymax = Math.min(imgHeight, Math.round(det.box.ymax))
          const cropWidth = xmax - xmin
          const cropHeight = ymax - ymin

          if (cropWidth <= 0 || cropHeight <= 0) continue

          // Filter by minimum relative box area
          const boxAreaRatio = (cropWidth * cropHeight) / (imgWidth * imgHeight)
          if (boxAreaRatio < minBoxArea) {
            log.debug('Detection too small, skipping', {
              gtin: v.gtin,
              imgIdx,
              boxAreaPct: (boxAreaRatio * 100).toFixed(1),
              minPct: (minBoxArea * 100).toFixed(1),
            })
            continue
          }

          // Crop the region using sharp
          const croppedBuffer = await sharp(imageBuffer)
            .extract({ left: xmin, top: ymin, width: cropWidth, height: cropHeight })
            .png()
            .toBuffer()

          // Upload cropped image to media
          const cropMediaDoc = await payload.create({
            collection: 'detection-media',
            data: { alt: `Product detection img${imgIdx}/${i + 1} (${det.score.toFixed(2)}) — ${v.gtin}` },
            file: {
              data: croppedBuffer,
              mimetype: 'image/png',
              name: `detection-${v.gtin}-img${imgIdx}-${i + 1}.png`,
              size: croppedBuffer.length,
            },
          })
          const cropMediaId = (cropMediaDoc as { id: number }).id

          recognitionImages.push({
            image: cropMediaId,
            score: Math.round(det.score * 1000) / 1000,
            boxXMin: xmin,
            boxYMin: ymin,
            boxXMax: xmax,
            boxYMax: ymax,
          })

          totalDetections++
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        log.debug('Object detection failed for image', { gtin: v.gtin, imgIdx, error: msg })
      }
    }

    // Clean up old embeddings before rewriting recognitionImages
    // (new detection crops may have different detection_media_ids)
    await payload.embeddings.delete('recognition-images', { product_variant_id: variantId })

    // Update product-variant with recognition images from ALL source images
    await payload.update({
      collection: 'product-variants',
      id: variantId,
      data: { recognitionImages },
    })

    jlog.event('aggregation.objects_detected', {
      gtin: v.gtin,
      images: images.length,
      detections: recognitionImages.length,
      scores: recognitionImages.map((r) => r.score).join(', '),
    })

    log.info('Recognition images saved', { gtin: v.gtin, images: images.length, crops: recognitionImages.length })

    await ctx.heartbeat()
  }

  log.info('Object detection stage complete', { productId, totalDetections })
  return { success: true, productId }
}
