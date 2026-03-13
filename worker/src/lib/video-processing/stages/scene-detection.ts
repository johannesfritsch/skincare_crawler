/**
 * Stage 2: Scene Detection
 *
 * Reads the video media from the DB, downloads it to a temp dir,
 * detects scene changes, extracts screenshots per segment,
 * scans for barcodes, clusters visual screenshots,
 * uploads all screenshots as media, and creates video-snippets.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  detectSceneChanges,
  extractScreenshots,
  scanBarcode,
  createThumbnailAndHash,
  createRecognitionThumbnail,
  hammingDistance,
  getVideoDuration,
  formatTime,
} from '@/lib/video-processing/process-video'
import type { StageContext, StageResult } from './index'

export async function executeSceneDetection(ctx: StageContext, videoId: number): Promise<StageResult> {
  const { payload, config, log } = ctx
  const jlog = log.forJob('video-processings', config.jobId)

  // Fetch the video to get its media (uploaded in download stage)
  const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
  const title = (video.title as string) || `Video ${videoId}`

  // Get the video media URL to download locally
  const imageRef = video.videoFile as number | Record<string, unknown> | null
  if (!imageRef) {
    return { success: false, error: 'Video has no media file (video must be crawled first)' }
  }

  const mediaId = typeof imageRef === 'number' ? imageRef : (imageRef as { id: number }).id
  const mediaDoc = await payload.findByID({ collection: 'media', id: mediaId }) as Record<string, unknown>
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

    // Delete existing snippets for this video (idempotent re-run)
    const existingSnippets = await payload.find({
      collection: 'video-snippets',
      where: { video: { equals: videoId } },
      limit: 1000,
    })
    if (existingSnippets.docs.length > 0) {
      // Delete video-mentions for existing snippets first
      for (const snippet of existingSnippets.docs) {
        const snippetId = (snippet as { id: number }).id
        await payload.delete({
          collection: 'video-mentions',
          where: { videoSnippet: { equals: snippetId } },
        })
      }
      await payload.delete({
        collection: 'video-snippets',
        where: { video: { equals: videoId } },
      })
      log.info('Deleted existing snippets and video-mentions', { snippetCount: existingSnippets.docs.length, videoId })
    }

    // Process each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const segLabel = `Segment ${i + 1}/${segments.length}`
      const segTime = `[${formatTime(seg.start)} – ${formatTime(seg.end)}]`

      log.info('Processing segment', { segment: segLabel, startS: Number(seg.start.toFixed(1)), endS: Number(seg.end.toFixed(1)) })

      // Extract screenshots
      const prefix = `seg${String(i).padStart(3, '0')}`
      const screenshotFiles = await extractScreenshots(videoPath, screenshotsDir, prefix, seg.start, seg.end - seg.start)

      // Scan for barcodes
      let foundBarcode: string | null = null
      let barcodeScreenshotIndex: number | null = null

      for (let j = 0; j < screenshotFiles.length; j++) {
        const barcode = await scanBarcode(screenshotFiles[j])
        if (barcode) {
          foundBarcode = barcode
          barcodeScreenshotIndex = j
          log.info('Barcode found', { screenshot: j + 1, barcode })
          break
        }
      }

      if (foundBarcode) {
        // ── Barcode path ──
        jlog.event('video_processing.barcode_found', { title, segment: i + 1, barcode: foundBarcode })

        const screenshotEntries: Array<Record<string, unknown>> = []
        for (let j = 0; j < screenshotFiles.length; j++) {
          const ts = Math.floor(seg.start) + j
          const imageMediaId = await ctx.uploadMedia(screenshotFiles[j], `${title} – ${ts}s`, 'image/jpeg')
          const entry: Record<string, unknown> = { image: imageMediaId }
          if (j === barcodeScreenshotIndex) {
            entry.barcode = foundBarcode
          }
          screenshotEntries.push(entry)
        }

        const firstScreenshot = screenshotEntries[0]?.image ?? null

        await payload.create({
          collection: 'video-snippets',
          data: {
            video: videoId,
            image: firstScreenshot as number,
            matchingType: 'barcode',
            timestampStart: Math.round(seg.start),
            timestampEnd: Math.round(seg.end),
            screenshots: screenshotEntries,
          },
        })
      } else {
        // ── Visual path ──
        log.info('No barcode found, using visual recognition path')

        // Compute hashes and cluster
        const hashResults: { thumbnailPath: string; hash: string; distance: number | null; screenshotGroup: number }[] = []
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

          hashResults.push({ thumbnailPath, hash, distance: bestDistance, screenshotGroup: assignedGroup })
        }

        log.info('Clusters formed', { clusters: clusterRepresentatives.length })
        jlog.event('video_processing.clustered', { title, segment: i + 1, clusters: clusterRepresentatives.length })

        // Create recognition thumbnails for cluster representatives
        const recogThumbnails: { clusterGroup: number; recogPath: string }[] = []
        for (const rep of clusterRepresentatives) {
          const recogPath = await createRecognitionThumbnail(screenshotFiles[rep.screenshotIndex])
          recogThumbnails.push({ clusterGroup: rep.group, recogPath })
        }

        // Upload screenshots with hash/cluster metadata
        const repScreenshotIndices = new Set(clusterRepresentatives.map((r) => r.screenshotIndex))
        const recogPathByGroup = new Map<number, string>()
        for (const rt of recogThumbnails) {
          recogPathByGroup.set(rt.clusterGroup, rt.recogPath)
        }

        const screenshotEntries: Array<Record<string, unknown>> = []

        for (let j = 0; j < screenshotFiles.length; j++) {
          const file = screenshotFiles[j]
          const hr = hashResults[j]
          const ts = Math.floor(seg.start) + j

          const imageMediaId = await ctx.uploadMedia(file, `${title} – ${ts}s`, 'image/jpeg')
          const thumbnailMediaId = await ctx.uploadMedia(hr.thumbnailPath, `${title} – ${ts}s thumb`, 'image/png')

          const entry: Record<string, unknown> = {
            image: imageMediaId,
            thumbnail: thumbnailMediaId,
            hash: hr.hash,
            screenshotGroup: hr.screenshotGroup,
          }
          if (hr.distance !== null) {
            entry.distance = hr.distance
          }

          if (repScreenshotIndices.has(j)) {
            const recogPath = recogPathByGroup.get(hr.screenshotGroup)
            if (recogPath) {
              entry.recognitionCandidate = true
              entry.recognitionThumbnail = await ctx.uploadMedia(recogPath, `${title} – ${ts}s recog`, 'image/png')
            }
          }

          screenshotEntries.push(entry)
        }

        const firstScreenshot = screenshotEntries[0]?.image ?? null

        await payload.create({
          collection: 'video-snippets',
          data: {
            video: videoId,
            image: firstScreenshot as number,
            matchingType: 'visual',
            timestampStart: Math.round(seg.start),
            timestampEnd: Math.round(seg.end),
            screenshots: screenshotEntries,
          },
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
