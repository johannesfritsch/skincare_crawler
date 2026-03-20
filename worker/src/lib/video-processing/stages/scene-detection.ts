/**
 * Stage 0: Scene Detection
 *
 * Reads the video media from the DB, downloads it to a temp dir,
 * detects scene changes, extracts screenshots per segment,
 * deduplicates near-identical frames by perceptual hash,
 * uploads all unique screenshots as media, and creates
 * video-scenes with video-frames.
 *
 * Unlike the previous version, this stage does NOT cluster frames
 * or select cluster representatives. Clustering now happens at the
 * detection-crop level in the side_detection stage (stage 3), after
 * object detection has run on all frames.
 *
 * Transient data (hash, hamming distance) is used for dedup only.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  detectSceneChanges,
  extractScreenshots,
  createThumbnailAndHash,
  hammingDistance,
  getVideoDuration,
} from '@/lib/video-processing/process-video'
import type { StageContext, StageResult } from './index'

/** Hamming distance threshold for considering two frames as near-identical duplicates. */
const DEDUP_THRESHOLD = 5

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

    let totalFrames = 0
    let totalDeduped = 0

    // Process each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const segLabel = `Segment ${i + 1}/${segments.length}`

      log.info('Processing segment', { segment: segLabel, startS: Number(seg.start.toFixed(1)), endS: Number(seg.end.toFixed(1)) })

      // Extract screenshots at 1fps
      const prefix = `seg${String(i).padStart(3, '0')}`
      const screenshotFiles = await extractScreenshots(videoPath, screenshotsDir, prefix, seg.start, seg.end - seg.start)

      // Hash-based dedup: eliminate near-identical consecutive frames
      // We keep the first frame and skip any subsequent frames whose perceptual hash
      // is within DEDUP_THRESHOLD of any already-kept frame in this segment.
      const keptFrames: { file: string; hash: string }[] = []

      for (let j = 0; j < screenshotFiles.length; j++) {
        const { hash } = await createThumbnailAndHash(screenshotFiles[j])

        let isDuplicate = false
        for (const kept of keptFrames) {
          if (hammingDistance(hash, kept.hash) <= DEDUP_THRESHOLD) {
            isDuplicate = true
            break
          }
        }

        if (!isDuplicate) {
          keptFrames.push({ file: screenshotFiles[j], hash })
        }
      }

      const removedCount = screenshotFiles.length - keptFrames.length
      totalFrames += screenshotFiles.length
      totalDeduped += removedCount

      log.info('Frames deduplicated', { segment: segLabel, extracted: screenshotFiles.length, kept: keptFrames.length, removed: removedCount })

      // Upload first screenshot as scene image
      const firstTs = Math.floor(seg.start)
      const firstImageMediaId = await ctx.uploadMedia(keptFrames[0].file, `${title} – ${firstTs}s`, 'image/jpeg')

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

      // Create video-frame records for each kept (deduplicated) screenshot
      for (let j = 0; j < keptFrames.length; j++) {
        const file = keptFrames[j].file
        const ts = Math.floor(seg.start) + j

        const imageMediaId = j === 0
          ? firstImageMediaId
          : await ctx.uploadMedia(file, `${title} – ${ts}s`, 'image/jpeg')

        await payload.create({
          collection: 'video-frames',
          data: {
            scene: sceneId,
            image: imageMediaId,
            frameIndex: j,
            videoTime: Math.floor(seg.start) + j,
          },
        })
      }

      await ctx.heartbeat()
    }

    log.info('Scene detection stage complete', { videoId, segments: segments.length, totalFrames, totalDeduped, framesKept: totalFrames - totalDeduped })
    return { success: true }
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
    }
  }
}
