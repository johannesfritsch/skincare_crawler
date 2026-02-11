import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Payload } from 'payload'

interface SceneChange {
  frame: number
  time: number
  score: number
}

export interface ProcessVideoResult {
  success: boolean
  error?: string
  segmentsCreated?: number
  screenshotsCreated?: number
}

function run(cmd: string, args: string[], timeoutMs = 600_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    console.log(`[processVideo] $ ${cmd} ${args.join(' ')}`)
    execFile(
      cmd,
      args,
      { maxBuffer: 100 * 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} failed (exit ${error.code ?? 'unknown'}): ${stderr || error.message}`))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  console.log(`[processVideo] ── Step: Download Video ──`)
  console.log(`[processVideo] URL: ${url}`)
  console.log(`[processVideo] Output: ${outputPath}`)

  await run('yt-dlp', ['--merge-output-format', 'mp4', '-o', outputPath, url], 600_000)

  const stats = fs.statSync(outputPath)
  console.log(`[processVideo] Download complete: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
}

async function getVideoDuration(videoPath: string): Promise<number> {
  console.log(`[processVideo] ── Step: Get Duration ──`)
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'json',
    videoPath,
  ])

  const result = JSON.parse(stdout) as { format?: { duration?: string } }
  const duration = parseFloat(result.format?.duration ?? '0')
  console.log(`[processVideo] Duration: ${duration.toFixed(1)}s`)
  return duration
}

async function detectSceneChanges(videoPath: string, threshold: number): Promise<SceneChange[]> {
  console.log(`[processVideo] ── Step: Scene Detection ──`)
  console.log(`[processVideo] Threshold: ${threshold}`)

  const { stdout } = await run('ffmpeg', [
    '-hide_banner', '-v', 'error',
    '-i', videoPath,
    '-vf', `select='gt(scene,${threshold})',metadata=print:file=-`,
    '-an', '-f', 'null', '-',
  ], 600_000)

  const scenes: SceneChange[] = []
  let current: Partial<SceneChange> = {}

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('frame:')) {
      if (current.time !== undefined && current.score !== undefined) {
        scenes.push(current as SceneChange)
      }
      current = {}
      const match = trimmed.match(/frame:(\d+).*pts_time:([0-9.]+)/)
      if (match) {
        current.frame = parseInt(match[1])
        current.time = parseFloat(match[2])
      }
    } else if (trimmed.startsWith('lavfi.scene_score=')) {
      current.score = parseFloat(trimmed.split('=')[1])
    }
  }

  if (current.time !== undefined && current.score !== undefined) {
    scenes.push(current as SceneChange)
  }

  console.log(`[processVideo] Found ${scenes.length} scene changes:`)
  for (const scene of scenes) {
    console.log(`[processVideo]   t=${scene.time.toFixed(2)}s  score=${scene.score.toFixed(3)}  frame=${scene.frame}`)
  }

  return scenes
}

async function extractScreenshots(
  videoPath: string,
  outputDir: string,
  prefix: string,
  startTime: number,
  duration: number,
): Promise<string[]> {
  console.log(`[processVideo]   Extracting screenshots: start=${startTime.toFixed(1)}s duration=${duration.toFixed(1)}s`)

  const outputPattern = path.join(outputDir, `${prefix}_%04d.jpg`)

  await run('ffmpeg', [
    '-hide_banner', '-v', 'error',
    '-ss', startTime.toString(),
    '-t', duration.toString(),
    '-i', videoPath,
    '-vf', 'fps=1',
    '-vsync', 'vfr',
    outputPattern,
  ])

  const files = fs.readdirSync(outputDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.jpg'))
    .sort()
    .map((f) => path.join(outputDir, f))

  console.log(`[processVideo]   Extracted ${files.length} screenshots`)
  return files
}

async function uploadFile(
  payload: Payload,
  filePath: string,
  alt: string,
  mimetype: string,
): Promise<number> {
  const buffer = fs.readFileSync(filePath)
  const name = path.basename(filePath)

  const media = await payload.create({
    collection: 'media',
    data: { alt },
    file: {
      data: buffer,
      mimetype,
      name,
      size: buffer.length,
    },
  })

  return media.id
}

export async function processVideo(
  payload: Payload,
  videoId: number,
  sceneThreshold: number = 0.4,
): Promise<ProcessVideoResult> {
  const video = await payload.findByID({
    collection: 'videos',
    id: videoId,
  })

  if (!video.externalUrl) {
    return { success: false, error: `Video ${videoId} has no externalUrl` }
  }

  console.log(`\n[processVideo] ════════════════════════════════════════════════════`)
  console.log(`[processVideo] Processing: "${video.title}" (id=${videoId})`)
  console.log(`[processVideo] URL: ${video.externalUrl}`)

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-processing-'))
  const videoPath = path.join(tmpDir, 'video.mp4')
  const screenshotsDir = path.join(tmpDir, 'screenshots')
  fs.mkdirSync(screenshotsDir)

  console.log(`[processVideo] Temp directory: ${tmpDir}`)

  let totalSegments = 0
  let totalScreenshots = 0

  try {
    // Step 1: Download
    await downloadVideo(video.externalUrl, videoPath)

    // Step 2: Upload video to Payload media
    console.log(`[processVideo] ── Step: Upload Video to Media ──`)
    const videoMediaId = await uploadFile(
      payload,
      videoPath,
      video.title || `Video ${videoId}`,
      'video/mp4',
    )
    console.log(`[processVideo] Uploaded video as media #${videoMediaId}`)

    // Step 3: Get duration
    const duration = await getVideoDuration(videoPath)

    // Step 4: Scene detection
    const sceneChanges = await detectSceneChanges(videoPath, sceneThreshold)

    // Step 5: Build segments
    console.log(`[processVideo] ── Step: Build Segments ──`)
    const timestamps = [0, ...sceneChanges.map((s) => s.time), duration]
    const segments: { start: number; end: number }[] = []
    for (let i = 0; i < timestamps.length - 1; i++) {
      const start = timestamps[i]
      const end = timestamps[i + 1]
      if (end - start >= 0.5) {
        segments.push({ start, end })
      }
    }

    console.log(`[processVideo] ${segments.length} segments from ${sceneChanges.length} scene changes:`)
    for (const seg of segments) {
      console.log(`[processVideo]   [${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s] (${(seg.end - seg.start).toFixed(1)}s)`)
    }

    // Step 6: Process each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const segDuration = seg.end - seg.start

      console.log(`\n[processVideo] ── Segment ${i + 1}/${segments.length}: ${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s ──`)

      // Extract screenshots
      const prefix = `seg${String(i).padStart(3, '0')}`
      const screenshotFiles = await extractScreenshots(
        videoPath,
        screenshotsDir,
        prefix,
        seg.start,
        segDuration,
      )

      // Upload screenshots
      const screenshotMediaIds: number[] = []
      for (let j = 0; j < screenshotFiles.length; j++) {
        const file = screenshotFiles[j]
        const ts = Math.floor(seg.start) + j
        console.log(`[processVideo]   Uploading screenshot ${j + 1}/${screenshotFiles.length} (t=${ts}s)`)
        const mediaId = await uploadFile(
          payload,
          file,
          `${video.title} – ${ts}s`,
          'image/jpeg',
        )
        screenshotMediaIds.push(mediaId)
      }

      // Create VideoSnippet
      const firstScreenshot = screenshotMediaIds[0] ?? null
      console.log(`[processVideo]   Creating VideoSnippet: ${screenshotMediaIds.length} screenshots, image=${firstScreenshot}`)

      await payload.create({
        collection: 'video-snippets',
        data: {
          video: videoId,
          image: firstScreenshot,
          timestampStart: Math.round(seg.start),
          timestampEnd: Math.round(seg.end),
          screenshots: screenshotMediaIds.map((id) => ({ image: id })),
        },
      })

      totalSegments++
      totalScreenshots += screenshotMediaIds.length
    }

    // Step 7: Mark video as processed
    console.log(`\n[processVideo] ── Step: Mark as Processed ──`)
    await payload.update({
      collection: 'videos',
      id: videoId,
      data: { processingStatus: 'processed' },
    })

    console.log(`[processVideo] Done: ${totalSegments} segments, ${totalScreenshots} screenshots`)
    console.log(`[processVideo] ════════════════════════════════════════════════════\n`)

    return { success: true, segmentsCreated: totalSegments, screenshotsCreated: totalScreenshots }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[processVideo] FAILED: ${msg}`)
    return { success: false, error: msg }
  } finally {
    console.log(`[processVideo] Cleaning up: ${tmpDir}`)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      console.warn(`[processVideo] Cleanup failed: ${e}`)
    }
  }
}
