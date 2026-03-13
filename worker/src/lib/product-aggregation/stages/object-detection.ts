/**
 * Stage 5: Object Detection
 *
 * Per variant: takes the uploaded product image, runs Grounding DINO
 * to detect "cosmetics packaging" bounding boxes, crops each detected
 * region using sharp, uploads the crops as media, and stores them in
 * the product-variant's `recognitionImages` array field.
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

    // Get the first image from the variant's images array
    const images = pv.images as Array<{ image: number | { id: number; url?: string; filename?: string } }> | null
    if (!images || images.length === 0) {
      log.info('No image on variant, skipping object detection', { gtin: v.gtin })
      continue
    }

    const imageRef = images[0].image
    let mediaId: number
    let mediaUrl: string | undefined

    if (typeof imageRef === 'number') {
      mediaId = imageRef
      // Fetch the media document to get the URL
      const mediaDoc = await payload.findByID({ collection: 'media', id: mediaId }) as Record<string, unknown>
      mediaUrl = mediaDoc.url as string | undefined
    } else {
      mediaId = imageRef.id
      mediaUrl = imageRef.url
    }

    if (!mediaUrl) {
      jlog.event('aggregation.warning', { gtin: v.gtin, warning: `No media URL found for variant image (mediaId=${mediaId})` })
      continue
    }

    // Construct full URL if relative
    const fullImageUrl = mediaUrl.startsWith('http')
      ? mediaUrl
      : `${payload.serverUrl}${mediaUrl}`

    try {
      log.info('Running object detection', { gtin: v.gtin, url: fullImageUrl })

      // Download the image for processing
      const imageRes = await fetch(fullImageUrl)
      if (!imageRes.ok) {
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Failed to download image for detection (status=${imageRes.status})` })
        continue
      }
      const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

      // Get original image dimensions for cropping
      const metadata = await sharp(imageBuffer).metadata()
      const imgWidth = metadata.width ?? 0
      const imgHeight = metadata.height ?? 0
      if (imgWidth === 0 || imgHeight === 0) {
        jlog.event('aggregation.warning', { gtin: v.gtin, warning: 'Could not get image dimensions' })
        continue
      }

      // Run Grounding DINO detection
      // The pipeline accepts URLs, file paths, or RawImage objects
      // We pass the URL directly since the model handles loading
      const detections = await detector(fullImageUrl, [DETECTION_PROMPT], {
        threshold: detectionThreshold,
      })

      if (!detections || detections.length === 0) {
        log.info('No objects detected', { gtin: v.gtin })
        // Clear any existing recognitionImages
        await payload.update({
          collection: 'product-variants',
          id: variantId,
          data: { recognitionImages: [] },
        })
        continue
      }

      log.info('Objects detected', { gtin: v.gtin, count: detections.length, scores: detections.map((d) => d.score.toFixed(2)).join(', ') })

      // Crop each detected region and upload
      const recognitionImages: Array<{
        image: number
        score: number
        boxXMin: number
        boxYMin: number
        boxXMax: number
        boxYMax: number
      }> = []

      for (let i = 0; i < detections.length; i++) {
        const det = detections[i]

        // Grounding DINO returns pixel coordinates
        const xmin = Math.max(0, Math.round(det.box.xmin))
        const ymin = Math.max(0, Math.round(det.box.ymin))
        const xmax = Math.min(imgWidth, Math.round(det.box.xmax))
        const ymax = Math.min(imgHeight, Math.round(det.box.ymax))
        const cropWidth = xmax - xmin
        const cropHeight = ymax - ymin

        if (cropWidth <= 0 || cropHeight <= 0) {
          jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Invalid detection box dimensions: ${det.box.xmin},${det.box.ymin},${det.box.xmax},${det.box.ymax}` })
          continue
        }

        // Filter by minimum relative box area
        const boxAreaRatio = (cropWidth * cropHeight) / (imgWidth * imgHeight)
        if (boxAreaRatio < minBoxArea) {
          log.info('Detection too small, skipping', { gtin: v.gtin, boxAreaPct: (boxAreaRatio * 100).toFixed(1), minPct: (minBoxArea * 100).toFixed(1) })
          continue
        }

        // Crop the region using sharp
        const croppedBuffer = await sharp(imageBuffer)
          .extract({ left: xmin, top: ymin, width: cropWidth, height: cropHeight })
          .png()
          .toBuffer()

        // Upload cropped image to media
        const cropMediaDoc = await payload.create({
          collection: 'media',
          data: { alt: `Product detection ${i + 1} (${det.score.toFixed(2)}) — ${v.gtin}` },
          file: {
            data: croppedBuffer,
            mimetype: 'image/png',
            name: `detection-${v.gtin}-${i + 1}.png`,
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

      // Update product-variant with recognition images
      await payload.update({
        collection: 'product-variants',
        id: variantId,
        data: { recognitionImages },
      })

      jlog.event('aggregation.objects_detected', {
        gtin: v.gtin,
        detections: recognitionImages.length,
        scores: recognitionImages.map((r) => r.score).join(', '),
      })

      log.info('Recognition images saved', { gtin: v.gtin, count: recognitionImages.length })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      jlog.event('aggregation.warning', { gtin: v.gtin, warning: `Object detection failed: ${msg}` })
    }

    await ctx.heartbeat()
  }

  log.info('Object detection stage complete', { productId, totalDetections })
  return { success: true, productId }
}
