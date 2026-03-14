/**
 * Stage 0: Scene Detection
 *
 * Reads the video media from the DB, downloads it to a temp dir,
 * detects scene changes, extracts screenshots per segment,
 * clusters visually similar screenshots, uploads all screenshots
 * as media, and creates video-scenes with video-frames.
 *
 * Barcode scanning is handled by the separate barcode_scan stage.
 *
 * Transient data (hash, thumbnail, distance, screenshotGroup)
 * is used for clustering but NOT persisted on frames.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  detectSceneChanges,
  extractScreenshots,
  createThumbnailAndHash,
  createRecognitionThumbnail,
  hammingDistance,
  getVideoDuration,
} from '@/lib/video-processing/process-video'
import type { StageContext, StageResult } from './index'

export async function executeSceneDetection(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  // Fetch the video to get its media (uploaded in crawl stage)
  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Get the video media URL to download locally
  const imageRef = video.videoFile as number | Record<string, unknown> | null
  if (!imageRef) {
    return { success: false, error: 'Video has no media file (video must be crawled first)' }
  }

  const mediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id
  const mediaDoc = await payload.findByID({ collection: 'video-media', id: mediaId }) as Record<string, unknown>
  const mediaUrl = mediaDoc.url as string
  if (!mediaUrl) {
    return { success: false, error: 'Video media record has no URL' }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-scene-'))
  const videoPath = path.join(tmpDir, 'video.mp4')
  const screenshotsDir = path.join(tmpDir, 'screenshots')
  fs.mkdirSync(screenshotsDir)

  try {
    // Download the media file locally
    log.info('Downloading video media for scene detection', { videoId, mediaId })
    const serverUrl = payload.serverUrl
    const fullUrl = mediaUrl.startsWith('http') ? mediaUrl : `${serverUrl}${mediaUrl}`
    const res = await fetch(fullUrl)
    if (!res.ok) {
      return { success: false, error: `Failed to download video media: ${res.status}` }
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(videoPath, buffer)
    await ctx.heartbeat()

    // Get duration + scene detection
    const duration = await getVideoDuration(videoPath)
    const sceneChanges = await detectSceneChanges(videoPath, config.sceneThreshold)
    await ctx.heartbeat()

    // Build segments
    const timestamps = [0, ...sceneChanges.map((s) => s.time), duration]
    const segments: { start: number; end: number }[] = []
    for (let i = 0; i < timestamps.length - 1; i++) {
      const start = timestamps[i]
      const end = timestamps[i + 1]
      if (end - start >= 0.5) {
        segments.push({ start, end })
      }
    }

    log.info('Segments built', { segments: segments.length, sceneChanges: sceneChanges.length })
    jlog.event('video_processing.scene_detected', { title, sceneChanges: sceneChanges.length, segments: segments.length })

    // Delete existing scenes for this video (idempotent re-run)
    // The beforeDelete hook on video-scenes will cascade-delete video-frames and video-mentions
    const existingScenes = await payload.find({
      collection: 'video-scenes',
      where: { video: { equals: videoId } },
      limit: 1000,
    })
    if (existingScenes.docs.length > 0) {
      for (const scene of existingScenes.docs) {
        const sceneId = (scene as { id: number }).id
        // Delete video-mentions first (required FK)
        await payload.delete({
          collection: 'video-mentions',
          where: { videoScene: { equals: sceneId } },
        })
        // Delete video-frames (required FK)
        await payload.delete({
          collection: 'video-frames',
          where: { scene: { equals: sceneId } },
        })
      }
      await payload.delete({
        collection: 'video-scenes',
        where: { video: { equals: videoId } },
      })
      log.info('Deleted existing scenes, frames, and video-mentions', { sceneCount: existingScenes.docs.length, videoId })
    }

    // Process each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const segLabel = `Segment ${i + 1}/${segments.length}`

      log.info('Processing segment', { segment: segLabel, startS: Number(seg.start.toFixed(1)), endS: Number(seg.end.toFixed(1)) })

      // Extract screenshots
      const prefix = `seg${String(i).padStart(3, '0')}`
      const screenshotFiles = await extractScreenshots(videoPath, screenshotsDir, prefix, seg.start, seg.end - seg.start)

      // Cluster all screenshots by perceptual hash (transient — not persisted)
      const hashResults: { thumbnailPath: string; hash: string; screenshotGroup: number }[] = []
      const clusterRepresentatives: { hash: string; group: number; screenshotIndex: number }[] = []

      for (let j = 0; j < screenshotFiles.length; j++) {
        const { thumbnailPath, hash } = await createThumbnailAndHash(screenshotFiles[j])

        let bestDistance: number | null = null
        let bestGroup = -1
        for (const rep of clusterRepresentatives) {
          const d = hammingDistance(hash, rep.hash)
          if (bestDistance === null || d < bestDistance) {
            bestDistance = d
            bestGroup = rep.group
          }
        }

        let assignedGroup: number
        if (bestDistance !== null && bestDistance <= config.clusterThreshold) {
          assignedGroup = bestGroup
        } else {
          assignedGroup = clusterRepresentatives.length
          clusterRepresentatives.push({ hash, group: assignedGroup, screenshotIndex: j })
        }

        hashResults.push({ thumbnailPath, hash, screenshotGroup: assignedGroup })
      }

      log.info('Clusters formed', { clusters: clusterRepresentatives.length })
      jlog.event('video_processing.clustered', { title, segment: i + 1, clusters: clusterRepresentatives.length })

      // Create cluster thumbnails for cluster representatives
      const recogThumbnails: { clusterGroup: number; recogPath: string }[] = []
      for (const rep of clusterRepresentatives) {
        const recogPath = await createRecognitionThumbnail(screenshotFiles[rep.screenshotIndex])
        recogThumbnails.push({ clusterGroup: rep.group, recogPath })
      }

      // Build lookup maps
      const repScreenshotIndices = new Set(clusterRepresentatives.map((r) => r.screenshotIndex))
      const recogPathByGroup = new Map<number, string>()
      for (const rt of recogThumbnails) {
        recogPathByGroup.set(rt.clusterGroup, rt.recogPath)
      }

      // Upload first screenshot as scene image
      const firstTs = Math.floor(seg.start)
      const firstImageMediaId = await ctx.uploadMedia(screenshotFiles[0], `${title} – ${firstTs}s`, 'image/jpeg')

      // Create the scene
      const sceneDoc = await payload.create({
        collection: 'video-scenes',
        data: {
          video: videoId,
          image: firstImageMediaId,
          timestampStart: Math.round(seg.start),
          timestampEnd: Math.round(seg.end),
        },
      })
      const sceneId = (sceneDoc as { id: number }).id

      // Create video-frame records for each screenshot
      for (let j = 0; j < screenshotFiles.length; j++) {
        const file = screenshotFiles[j]
        const hr = hashResults[j]
        const ts = Math.floor(seg.start) + j

        const imageMediaId = j === 0
          ? firstImageMediaId
          : await ctx.uploadMedia(file, `${title} – ${ts}s`, 'image/jpeg')

        const frameData: Record<string, unknown> = {
          scene: sceneId,
          image: imageMediaId,
        }

        if (repScreenshotIndices.has(j)) {
          const recogPath = recogPathByGroup.get(hr.screenshotGroup)
          if (recogPath) {
            frameData.isClusterRepresentative = true
            frameData.clusterThumbnail = await ctx.uploadMedia(recogPath, `${title} – ${ts}s recog`, 'image/png')
          }
        }

        await payload.create({
          collection: 'video-frames',
          data: frameData,
        })
      }

      await ctx.heartbeat()
    }

    log.info('Scene detection stage complete', { videoId, segments: segments.length })
    return { success: true }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
