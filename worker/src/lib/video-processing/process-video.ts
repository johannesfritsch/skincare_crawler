import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import phash from 'sharp-phash'

export interface SceneChange {
  frame: number
  time: number
  score: number
}

export interface ProcessVideoResult {
  success: boolean
  error?: string
  segmentsCreated?: number
  screenshotsCreated?: number
  tokensUsed?: number
}

export function run(cmd: string, args: string[], timeoutMs = 600_000): Promise<{ stdout: string; stderr: string }> {
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

export async function downloadVideo(url: string, outputPath: string): Promise<void> {
  console.log(`[processVideo] ── Step: Download Video ──`)
  console.log(`[processVideo] URL: ${url}`)
  console.log(`[processVideo] Output: ${outputPath}`)

  await run('yt-dlp', ['--merge-output-format', 'mp4', '-o', outputPath, url], 600_000)

  const stats = fs.statSync(outputPath)
  console.log(`[processVideo] Download complete: ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
}

export async function getVideoDuration(videoPath: string): Promise<number> {
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

export async function detectSceneChanges(videoPath: string, threshold: number): Promise<SceneChange[]> {
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

export async function extractScreenshots(
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

export async function scanBarcode(imagePath: string): Promise<string | null> {
  console.log(`[processVideo]     Scanning for barcode: ${path.basename(imagePath)}`)

  return new Promise((resolve) => {
    execFile(
      'zbarimg',
      ['--quiet', imagePath],
      { timeout: 30_000 },
      (error, stdout) => {
        if (error || !stdout.trim()) {
          console.log(`[processVideo]     No barcode found`)
          resolve(null)
          return
        }

        for (const line of stdout.trim().split('\n')) {
          const colonIdx = line.indexOf(':')
          if (colonIdx === -1) continue
          const type = line.substring(0, colonIdx)
          const data = line.substring(colonIdx + 1).trim()

          // Skip QR codes, only accept EAN-13, EAN-8, UPC-A
          if (type === 'QR-Code' || type === 'QR_Code') {
            console.log(`[processVideo]     Skipping QR code: ${data.substring(0, 40)}...`)
            continue
          }

          if (type === 'EAN-13' || type === 'EAN-8' || type === 'UPC-A') {
            console.log(`[processVideo]     Found barcode: ${type}:${data}`)
            resolve(data)
            return
          }

          console.log(`[processVideo]     Skipping unsupported barcode type: ${type}:${data}`)
        }

        console.log(`[processVideo]     No EAN-13/EAN-8 barcode in scan results`)
        resolve(null)
      },
    )
  })
}

export async function createThumbnailAndHash(imagePath: string): Promise<{ thumbnailPath: string; hash: string }> {
  const thumbnailPath = imagePath.replace(/\.\w+$/, '_thumb.png')

  await sharp(imagePath)
    .resize(64, 64, { fit: 'fill' })
    .grayscale()
    .png()
    .toFile(thumbnailPath)

  const hash: string = await phash(thumbnailPath)
  return { thumbnailPath, hash }
}

export async function createRecognitionThumbnail(imagePath: string): Promise<string> {
  const recogPath = imagePath.replace(/\.\w+$/, '_recog.png')

  await sharp(imagePath)
    .resize(128, 128, { fit: 'cover' })
    .png()
    .toFile(recogPath)

  return recogPath
}

export function hammingDistance(a: string, b: string): number {
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++
  }
  return dist
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`
}


