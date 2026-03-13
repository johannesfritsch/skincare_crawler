/**
 * Stage 3: Screenshot Detection
 *
 * Runs Grounding DINO object detection on video screenshot cluster
 * representatives to detect cosmetics packaging. Crops each detected
 * region using sharp, uploads the crops as media, and stores them in
 * the video-snippet's `detections` array field.
 *
 * Uses the shared Grounding DINO singleton from @/lib/models/grounding-dino.
 */

import sharp from 'sharp'
import { getDetector } from '@/lib/models/grounding-dino'
import type { StageContext, StageResult } from './index'

const DETECTION_PROMPT = 'cosmetics packaging.'
const BOX_THRESHOLD = 0.3

export async function executeScreenshotDetection(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)
  const minBoxArea = config.minBoxArea ?? 0.25

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Lazily load the Grounding DINO model
  log.info('Loading Grounding DINO model (first call may download ~700MB)')
  const detector = await getDetector()
  log.info('Grounding DINO model ready')

  // Fetch all snippets for this video
  const snippetsResult = await payload.find({
    collection: 'video-snippets',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (snippetsResult.docs.length === 0) {
    log.info('No snippets found, skipping screenshot detection', { videoId })
    return { success: true }
  }

  let totalDetections = 0
  let snippetsProcessed = 0
  const serverUrl = payload.serverUrl

  for (const snippetDoc of snippetsResult.docs) {
    const snippet = snippetDoc as Record<string, unknown>
    const snippetId = snippet.id as number
    const matchingType = snippet.matchingType as string
    const screenshots = snippet.screenshots as Array<Record<string, unknown>> | undefined

    // Only process visual snippets with screenshots
    if (matchingType !== 'visual' || !screenshots || screenshots.length === 0) continue

    const detectionEntries: Array<Record<string, unknown>> = []

    for (let ssIndex = 0; ssIndex < screenshots.length; ssIndex++) {
      const ss = screenshots[ssIndex]

      // Only process cluster representatives
      if (!ss.recognitionCandidate) continue

      // Resolve the screenshot image media URL
      const imageRef = ss.image as number | Record<string, unknown>
      let mediaUrl: string | undefined
      let mediaId: number

      if (typeof imageRef === 'number') {
        mediaId = imageRef
        const mediaDoc = (await payload.findByID({ collection: 'video-media', id: mediaId })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaId = (imageRef as { id: number }).id
        mediaUrl = (imageRef as { url?: string }).url
      }

      if (!mediaUrl) {
        jlog.event('video_processing.warning', { title, warning: `No media URL for screenshot ${ssIndex} in snippet ${snippetId}` })
        continue
      }

      const fullImageUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

      try {
        // Download the image for processing
        const imageRes = await fetch(fullImageUrl)
        if (!imageRes.ok) {
          jlog.event('video_processing.warning', { title, warning: `Failed to download screenshot ${ssIndex} (status=${imageRes.status})` })
          continue
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

        // Get original image dimensions for cropping
        const metadata = await sharp(imageBuffer).metadata()
        const imgWidth = metadata.width ?? 0
        const imgHeight = metadata.height ?? 0
        if (imgWidth === 0 || imgHeight === 0) {
          jlog.event('video_processing.warning', { title, warning: `Could not get image dimensions for screenshot ${ssIndex}` })
          continue
        }

        // Run Grounding DINO detection
        const detections = await detector(fullImageUrl, [DETECTION_PROMPT], {
          threshold: BOX_THRESHOLD,
        })

        if (!detections || detections.length === 0) {
          log.info('No objects detected in screenshot', { snippetId, ssIndex })
          continue
        }

        log.info('Objects detected', { snippetId, ssIndex, count: detections.length })

        for (const det of detections) {
          // Clamp box coordinates to image bounds
          const xmin = Math.max(0, Math.round(det.box.xmin))
          const ymin = Math.max(0, Math.round(det.box.ymin))
          const xmax = Math.min(imgWidth, Math.round(det.box.xmax))
          const ymax = Math.min(imgHeight, Math.round(det.box.ymax))
          const cropWidth = xmax - xmin
          const cropHeight = ymax - ymin

          if (cropWidth <= 0 || cropHeight <= 0) {
            jlog.event('video_processing.warning', { title, warning: `Invalid detection box: ${xmin},${ymin},${xmax},${ymax}` })
            continue
          }

          // Filter by minimum relative box area
          const boxAreaRatio = (cropWidth * cropHeight) / (imgWidth * imgHeight)
          if (boxAreaRatio < minBoxArea) {
            log.info('Detection too small, skipping', { snippetId, ssIndex, boxAreaPct: (boxAreaRatio * 100).toFixed(1), minPct: (minBoxArea * 100).toFixed(1) })
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
            data: { alt: `${title} – detection ss${ssIndex} (${det.score.toFixed(2)})` },
            file: {
              data: croppedBuffer,
              mimetype: 'image/png',
              name: `detection-v${videoId}-sn${snippetId}-ss${ssIndex}-${detectionEntries.length}.png`,
              size: croppedBuffer.length,
            },
          })
          const cropMediaId = (cropMediaDoc as { id: number }).id

          detectionEntries.push({
            image: cropMediaId,
            score: det.score,
            screenshotIndex: ssIndex,
            boxXMin: xmin,
            boxYMin: ymin,
            boxXMax: xmax,
            boxYMax: ymax,
          })

          totalDetections++
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('video_processing.warning', { title, warning: `Object detection failed for screenshot ${ssIndex}: ${msg}` })
      }
    }

    // Update snippet with detections (overwrite for idempotency)
    await payload.update({
      collection: 'video-snippets',
      id: snippetId,
      data: { detections: detectionEntries },
    })

    snippetsProcessed++
    await ctx.heartbeat()
  }

  if (totalDetections > 0 || snippetsProcessed > 0) {
    jlog.event('video_processing.screenshots_detected', {
      title,
      snippets: snippetsProcessed,
      detections: totalDetections,
    })
  }

  log.info('Screenshot detection stage complete', { videoId, snippets: snippetsProcessed, detections: totalDetections })
  return { success: true }
}
