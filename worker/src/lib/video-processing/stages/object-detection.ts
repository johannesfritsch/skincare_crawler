/**
 * Stage 2: Object Detection
 *
 * Runs Grounding DINO zero-shot object detection on ALL deduplicated frames
 * for each scene (not just cluster representatives — clustering now happens
 * at the crop level in the side_detection stage).
 *
 * Crops each detected region using sharp, uploads the crops to detection-media,
 * and writes results to the scene's `objects[]` array.
 *
 * Uses the shared Grounding DINO singleton from @/lib/models/grounding-dino.
 *
 * Detection prompt and threshold are configurable via the job's Configuration
 * tab (detectionPrompt, detectionThreshold). Emits per-frame detail events
 * for full observability in the admin UI.
 */

import sharp from 'sharp'
import { getDetector } from '@/lib/models/grounding-dino'
import type { StageContext, StageResult } from './index'

export async function executeObjectDetection(ctx: StageContext, videoId: number): Promise<StageResult> {
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

  // Fetch all scenes for this video
  const scenesResult = await payload.find({
    collection: 'video-scenes',
    where: { video: { equals: videoId } },
    limit: 1000,
    sort: 'timestampStart',
  })

  if (scenesResult.docs.length === 0) {
    jlog.info('No scenes found, skipping object detection', { videoId })
    return { success: true }
  }

  let totalDetections = 0
  let candidatesProcessed = 0
  let candidatesWithDetections = 0
  const serverUrl = payload.serverUrl

  for (const sceneDoc of scenesResult.docs) {
    const scene = sceneDoc as Record<string, unknown>
    const sceneId = scene.id as number

    // Fetch ALL frames for this scene (no cluster representative filter —
    // clustering now happens at the crop level in the side_detection stage)
    const framesResult = await payload.find({
      collection: 'video-frames',
      where: { scene: { equals: sceneId } },
      limit: 1000,
    })

    const objectEntries: Array<Record<string, unknown>> = []

    for (const frameDoc of framesResult.docs) {
      const frame = frameDoc as Record<string, unknown>
      const frameId = frame.id as number
      const imageRef = frame.image as number | Record<string, unknown>

      // Resolve the frame image media URL
      let mediaUrl: string | undefined
      if (typeof imageRef === 'number') {
        const mediaDoc = (await payload.findByID({ collection: 'video-media', id: imageRef })) as Record<string, unknown>
        mediaUrl = mediaDoc.url as string | undefined
      } else {
        mediaUrl = (imageRef as { url?: string }).url
      }

      if (!mediaUrl) {
        jlog.event('video_processing.warning', { title, warning: `No media URL for frame ${frameId} in scene ${sceneId}` })
        continue
      }

      const fullImageUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`

      try {
        // Download the image for processing
        const imageRes = await fetch(fullImageUrl)
        if (!imageRes.ok) {
          jlog.event('video_processing.warning', { title, warning: `Failed to download frame ${frameId} in scene ${sceneId} (status=${imageRes.status})` })
          continue
        }
        const imageBuffer = Buffer.from(await imageRes.arrayBuffer())

        // Get original image dimensions for cropping
        const metadata = await sharp(imageBuffer).metadata()
        const imgWidth = metadata.width ?? 0
        const imgHeight = metadata.height ?? 0
        if (imgWidth === 0 || imgHeight === 0) {
          jlog.event('video_processing.warning', { title, warning: `Could not get image dimensions for frame ${frameId} in scene ${sceneId}` })
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

            // Upload cropped image to detection-media
            const cropMediaDoc = await payload.create({
              collection: 'detection-media',
              data: { alt: `${title} – detection f${frameId} (${det.score.toFixed(2)})` },
              file: {
                data: croppedBuffer,
                mimetype: 'image/png',
                name: `detection-v${videoId}-f${frameId}-${objectEntries.length}.png`,
                size: croppedBuffer.length,
              },
            })
            const cropMediaId = (cropMediaDoc as { id: number }).id

            objectEntries.push({
              frame: frameId,
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

        // Emit per-candidate detail event (always — even when rawCount is 0)
        jlog.event('video_processing.object_detection_detail', {
          title,
          sceneId,
          frameId,
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
        jlog.event('video_processing.warning', { title, warning: `Object detection failed for frame ${frameId} in scene ${sceneId}: ${msg}` })
      }

      await ctx.heartbeat()
    }

    // Write objects to the scene (overwrite for idempotency)
    await payload.update({
      collection: 'video-scenes',
      id: sceneId,
      data: { objects: objectEntries },
    })
  }

  // Always emit aggregate event
  jlog.event('video_processing.objects_detected', {
    title,
    scenes: scenesResult.docs.length,
    detections: totalDetections,
    candidatesProcessed,
    candidatesWithDetections,
  })

  jlog.info('Object detection complete', {
    videoId,
    scenes: scenesResult.docs.length,
    candidates: candidatesProcessed,
    withDetections: candidatesWithDetections,
    totalKept: totalDetections,
  })
  return { success: true }
}
