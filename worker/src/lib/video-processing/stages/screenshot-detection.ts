/**
 * Stage 2: Screenshot Detection
 *
 * Runs Grounding DINO object detection on video screenshot cluster
 * representatives to detect cosmetics packaging. Crops each detected
 * region using sharp, uploads the crops as media, and stores them in
 * the video-snippet's `detections` array field.
 *
 * Uses the shared Grounding DINO singleton from @/lib/models/grounding-dino.
 *
 * Detection prompt and threshold are configurable via the job's Configuration
 * tab (detectionPrompt, detectionThreshold). Emits per-candidate detail events
 * for full observability in the admin UI.
 */

import sharp from 'sharp'
import { getDetector } from '@/lib/models/grounding-dino'
import type { StageContext, StageResult } from './index'

export async function executeScreenshotDetection(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)
  const minBoxArea = config.minBoxArea ?? 0.25
  const detectionThreshold = config.detectionThreshold ?? 0.3
  const detectionPrompt = config.detectionPrompt ?? 'cosmetics packaging.'

  const video = (await payload.findByID({ collection: 'videos', id: videoId })) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Lazily load the Grounding DINO model
  jlog.info('Loading Grounding DINO model (first call may download ~700MB)')
  const detector = await getDetector()
  jlog.info('Grounding DINO model ready', { prompt: detectionPrompt, threshold: detectionThreshold, minBoxAreaPct: (minBoxArea * 100).toFixed(0) })

  // Fetch all snippets for this video
  const snippetsResult = await payload.find({
    collection: 'video-snippets',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (snippetsResult.docs.length === 0) {
    jlog.info('No snippets found, skipping screenshot detection', { videoId })
    return { success: true }
  }

  let totalDetections = 0
  let snippetsProcessed = 0
  let candidatesProcessed = 0
  let candidatesWithDetections = 0
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
          jlog.event('video_processing.warning', { title, warning: `Failed to download screenshot ${ssIndex} in snippet ${snippetId} (status=${imageRes.status})` })
          continue
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

        // Get original image dimensions for cropping
        const metadata = await sharp(imageBuffer).metadata()
        const imgWidth = metadata.width ?? 0
        const imgHeight = metadata.height ?? 0
        if (imgWidth === 0 || imgHeight === 0) {
          jlog.event('video_processing.warning', { title, warning: `Could not get image dimensions for screenshot ${ssIndex} in snippet ${snippetId}` })
          continue
        }

        // Run Grounding DINO detection
        const detections = await detector(fullImageUrl, [detectionPrompt], {
          threshold: detectionThreshold,
        })

        candidatesProcessed++

        const rawCount = detections?.length ?? 0
        let keptCount = 0
        let skippedSmall = 0
        let skippedInvalid = 0
        const allScores: number[] = detections ? detections.map((d: { score: number }) => d.score) : []

        if (detections && detections.length > 0) {
          candidatesWithDetections++

          for (const det of detections) {
            // Clamp box coordinates to image bounds
            const xmin = Math.max(0, Math.round(det.box.xmin))
            const ymin = Math.max(0, Math.round(det.box.ymin))
            const xmax = Math.min(imgWidth, Math.round(det.box.xmax))
            const ymax = Math.min(imgHeight, Math.round(det.box.ymax))
            const cropWidth = xmax - xmin
            const cropHeight = ymax - ymin

            if (cropWidth <= 0 || cropHeight <= 0) {
              skippedInvalid++
              continue
            }

            // Filter by minimum relative box area
            const boxAreaRatio = (cropWidth * cropHeight) / (imgWidth * imgHeight)
            if (boxAreaRatio < minBoxArea) {
              skippedSmall++
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

            keptCount++
            totalDetections++
          }
        }

        // Emit per-candidate detail event (always — even when rawCount is 0)
        jlog.event('video_processing.screenshot_detection_detail', {
          title,
          snippetId,
          screenshotIndex: ssIndex,
          imageWidth: imgWidth,
          imageHeight: imgHeight,
          rawDetections: rawCount,
          keptDetections: keptCount,
          skippedSmall,
          skippedInvalid,
          topScore: allScores.length > 0 ? Math.max(...allScores) : 0,
          scores: allScores.map((s) => s.toFixed(3)).join(',') || '-',
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        jlog.event('video_processing.warning', { title, warning: `Object detection failed for screenshot ${ssIndex} in snippet ${snippetId}: ${msg}` })
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

  // Always emit aggregate event (even when 0 detections — that's useful info)
  jlog.event('video_processing.screenshots_detected', {
    title,
    snippets: snippetsProcessed,
    detections: totalDetections,
    candidatesProcessed,
    candidatesWithDetections,
  })

  jlog.info('Screenshot detection complete', {
    videoId,
    snippets: snippetsProcessed,
    candidates: candidatesProcessed,
    withDetections: candidatesWithDetections,
    totalKept: totalDetections,
  })
  return { success: true }
}
