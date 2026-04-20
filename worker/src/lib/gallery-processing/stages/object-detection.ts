/**
 * Stage 1: Object Detection
 *
 * Runs Grounding DINO zero-shot object detection on each gallery item's image.
 * Crops each detected region using sharp, uploads the crops to detection-media,
 * and writes results to the item's `objects[]` array.
 *
 * Simplified vs video: one image per item, no frames iteration.
 */

import sharp from 'sharp'
import { getDetector } from '@/lib/models/grounding-dino'
import type { GalleryStageContext, GalleryStageResult } from './index'

export async function executeObjectDetection(ctx: GalleryStageContext, galleryId: number): Promise<GalleryStageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('gallery-processings', config.jobId)
  const minBoxArea = config.minBoxArea ?? 0.25
  const detectionThreshold = config.detectionThreshold ?? 0.3
  const detectionPrompt = config.detectionPrompt ?? 'cosmetics packaging.'

  // Lazily load the Grounding DINO model
  jlog.info('Loading Grounding DINO model (first call may download ~700MB)')
  const detector = await getDetector()
  jlog.info('Grounding DINO model ready', { prompt: detectionPrompt, threshold: detectionThreshold, minBoxAreaPct: (minBoxArea * 100).toFixed(0) })

  // Fetch all items for this gallery
  const itemsResult = await payload.find({
    collection: 'gallery-items',
    where: { gallery: { equals: galleryId } },
    limit: 1000,
    sort: 'position',
  })

  if (itemsResult.docs.length === 0) {
    jlog.info('No gallery items found, skipping object detection', { galleryId })
    return { success: true }
  }

  let totalDetections = 0
  let itemsProcessed = 0
  let itemsWithDetections = 0
  const serverUrl = payload.serverUrl

  for (const itemDoc of itemsResult.docs) {
    const item = itemDoc as Record<string, unknown>
    const itemId = item.id as number
    const imageRef = item.image as number | Record<string, unknown> | null
    if (!imageRef) continue

    // Resolve the image media URL
    let mediaUrl: string | undefined
    if (typeof imageRef === 'number') {
      const mediaDoc = (await payload.findByID({ collection: 'gallery-media', id: imageRef })) as Record<string, unknown>
      mediaUrl = mediaDoc.url as string | undefined
    } else {
      mediaUrl = (imageRef as { url?: string }).url
    }

    if (!mediaUrl) {
      jlog.event('gallery_processing.warning', { galleryId, warning: `No media URL for item ${itemId}` })
      continue
    }

    const fullImageUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
    const objectEntries: Array<Record<string, unknown>> = []

    jlog.debug('Fetching gallery item image', { itemId, mediaUrl, fullImageUrl, serverUrl })

    try {
      // Download the image for processing
      const imageRes = await fetch(fullImageUrl)
      if (!imageRes.ok) {
        jlog.event('gallery_processing.warning', { galleryId, warning: `Failed to download item ${itemId} (status=${imageRes.status})` })
        continue
      }
      const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

      // Get original image dimensions for cropping
      const metadata = await sharp(imageBuffer).metadata()
      const imgWidth = metadata.width ?? 0
      const imgHeight = metadata.height ?? 0
      if (imgWidth === 0 || imgHeight === 0) {
        jlog.event('gallery_processing.warning', { galleryId, warning: `Could not get image dimensions for item ${itemId}` })
        continue
      }

      // Run Grounding DINO detection
      const { RawImage } = await import('@huggingface/transformers')
      const rawImage = await RawImage.fromBlob(new Blob([imageBuffer]))

      const detections = await Promise.race([
        detector(rawImage, [detectionPrompt], { threshold: detectionThreshold }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Object detection timed out after 60s')), 60_000),
        ),
      ])

      itemsProcessed++

      const rawCount = detections?.length ?? 0
      let keptCount = 0

      if (detections && detections.length > 0) {
        itemsWithDetections++

        for (const det of detections) {
          // Clamp box coordinates to image bounds
          const xmin = Math.max(0, Math.round(det.box.xmin))
          const ymin = Math.max(0, Math.round(det.box.ymin))
          const xmax = Math.min(imgWidth, Math.round(det.box.xmax))
          const ymax = Math.min(imgHeight, Math.round(det.box.ymax))
          const cropWidth = xmax - xmin
          const cropHeight = ymax - ymin

          if (cropWidth <= 0 || cropHeight <= 0) continue

          // Filter by minimum relative box area
          const boxAreaRatio = (cropWidth * cropHeight) / (imgWidth * imgHeight)
          if (boxAreaRatio < minBoxArea) continue

          // Crop the region using sharp
          const croppedBuffer = await sharp(imageBuffer)
            .extract({ left: xmin, top: ymin, width: cropWidth, height: cropHeight })
            .png()
            .toBuffer()

          // Upload cropped image to detection-media
          const cropMediaDoc = await payload.create({
            collection: 'detection-media',
            data: { alt: `Gallery ${galleryId} item ${itemId} – detection (${det.score.toFixed(2)})` },
            file: {
              data: croppedBuffer,
              mimetype: 'image/png',
              name: `detection-g${galleryId}-i${itemId}-${objectEntries.length}.png`,
              size: croppedBuffer.length,
            },
          })
          const cropMediaId = (cropMediaDoc as { id: number }).id

          objectEntries.push({
            crop: cropMediaId,
            score: det.score,
            boxXMin: xmin,
            boxYMin: ymin,
            boxXMax: xmax,
            boxYMax: ymax,
          })

          keptCount++
          totalDetections++
        }
      }

      jlog.event('gallery_processing.object_detection_detail', {
        galleryId,
        itemId,
        imageWidth: imgWidth,
        imageHeight: imgHeight,
        rawDetections: rawCount,
        keptDetections: keptCount,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.stack ?? error.message : String(error)
      jlog.warn('Object detection failed for item', { itemId, galleryId, error: msg })
      jlog.event('gallery_processing.warning', { galleryId, warning: `Object detection failed for item ${itemId}: ${msg}` })
    }

    // Write objects to the item (overwrite for idempotency)
    // Retry once on fetch failure — undici connection pool can go stale during long ML inference
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await payload.update({
          collection: 'gallery-items',
          id: itemId,
          data: { objects: objectEntries },
        })
        break
      } catch (updateErr) {
        if (attempt === 0 && updateErr instanceof Error && updateErr.message.includes('fetch failed')) {
          jlog.warn('Retrying gallery item update after stale connection', { itemId })
          continue
        }
        throw updateErr
      }
    }

    await ctx.heartbeat()
  }

  jlog.event('gallery_processing.objects_detected', {
    galleryId,
    items: itemsResult.docs.length,
    detections: totalDetections,
    itemsProcessed,
    itemsWithDetections,
  })

  jlog.info('Object detection complete', {
    galleryId,
    items: itemsResult.docs.length,
    processed: itemsProcessed,
    withDetections: itemsWithDetections,
    totalKept: totalDetections,
  })
  return { success: true }
}
