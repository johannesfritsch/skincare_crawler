import { execFile } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Payload } from 'payload'
import sharp from 'sharp'
import phash from 'sharp-phash'
import { classifyScreenshots, recognizeProduct } from './recognize-product'
import { matchProduct } from '../match-product'

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
  tokensUsed?: number
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

async function scanBarcode(imagePath: string): Promise<string | null> {
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

async function createThumbnailAndHash(imagePath: string): Promise<{ thumbnailPath: string; hash: string }> {
  const thumbnailPath = imagePath.replace(/\.\w+$/, '_thumb.png')

  await sharp(imagePath)
    .resize(64, 64, { fit: 'fill' })
    .grayscale()
    .png()
    .toFile(thumbnailPath)

  const hash: string = await phash(thumbnailPath)
  return { thumbnailPath, hash }
}

async function createRecognitionThumbnail(imagePath: string): Promise<string> {
  const recogPath = imagePath.replace(/\.\w+$/, '_recog.png')

  await sharp(imagePath)
    .resize(128, 128, { fit: 'cover' })
    .png()
    .toFile(recogPath)

  return recogPath
}

function hammingDistance(a: string, b: string): number {
  let dist = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) dist++
  }
  return dist
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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return m > 0 ? `${m}m${s.toString().padStart(2, '0')}s` : `${s}s`
}

async function emitEvent(
  payload: Payload,
  processingJobId: number | undefined,
  type: 'info' | 'warning' | 'error',
  message: string,
): Promise<void> {
  if (!processingJobId) return
  try {
    await payload.create({
      collection: 'events',
      data: {
        type,
        message,
        job: { relationTo: 'video-processings', value: processingJobId },
      },
    })
  } catch (e) {
    console.error('[processVideo] Failed to create event:', e)
  }
}

export async function processVideo(
  payload: Payload,
  videoId: number,
  sceneThreshold: number = 0.4,
  clusterThreshold: number = 25,
  processingJobId?: number,
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
  let totalTokensUsed = 0

  try {
    // Step 0: Delete existing snippets for this video
    console.log(`[processVideo] ── Step: Clean Up Existing Snippets ──`)
    const existingSnippets = await payload.find({
      collection: 'video-snippets',
      where: { video: { equals: videoId } },
      limit: 1000,
    })
    if (existingSnippets.docs.length > 0) {
      console.log(`[processVideo] Deleting ${existingSnippets.docs.length} existing snippets`)
      await payload.delete({
        collection: 'video-snippets',
        where: { video: { equals: videoId } },
      })
      console.log(`[processVideo] Deleted existing snippets`)
    } else {
      console.log(`[processVideo] No existing snippets to clean up`)
    }

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

    // Emit video-level overview event
    await emitEvent(payload, processingJobId, 'info', [
      `Video #${videoId}: "${video.title}"`,
      `URL: ${video.externalUrl}`,
      `Duration: ${formatTime(duration)}`,
      `Scene detection: ${sceneChanges.length} scene changes → ${segments.length} segments`,
      existingSnippets.docs.length > 0
        ? `Cleaned up ${existingSnippets.docs.length} existing snippets`
        : `No existing snippets`,
    ].join('\n'))

    // Step 6: Process each segment
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const segDuration = seg.end - seg.start
      const segLabel = `Segment ${i + 1}/${segments.length}`
      const segTime = `[${formatTime(seg.start)} – ${formatTime(seg.end)}]`

      // Event log lines for this segment
      const log: string[] = []
      log.push(`── ${segLabel} ${segTime} (${segDuration.toFixed(1)}s) ──`)

      console.log(`\n[processVideo] ── ${segLabel}: ${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s ──`)

      // Extract screenshots
      const prefix = `seg${String(i).padStart(3, '0')}`
      const screenshotFiles = await extractScreenshots(
        videoPath,
        screenshotsDir,
        prefix,
        seg.start,
        segDuration,
      )

      log.push(`Screenshots: ${screenshotFiles.length} extracted (1fps)`)

      // First pass: scan all screenshots for barcodes (stop at first hit)
      console.log(`[processVideo]   Scanning ${screenshotFiles.length} screenshots for barcodes...`)
      let foundBarcode: string | null = null
      let barcodeScreenshotIndex: number | null = null

      for (let j = 0; j < screenshotFiles.length; j++) {
        const barcode = await scanBarcode(screenshotFiles[j])
        if (barcode) {
          foundBarcode = barcode
          barcodeScreenshotIndex = j
          console.log(`[processVideo]   Barcode found in screenshot ${j + 1}, skipping remaining barcode scans`)
          break
        }
      }

      if (foundBarcode) {
        // ── Barcode path: upload raw screenshots, GTIN lookup ──
        console.log(`[processVideo]   Segment barcode result: ${foundBarcode}`)
        console.log(`[processVideo]   Using barcode path (skipping clustering and visual recognition)`)

        log.push(``)
        log.push(`Path: BARCODE`)
        log.push(`Barcode scan: found ${foundBarcode} in screenshot ${barcodeScreenshotIndex! + 1}/${screenshotFiles.length}`)

        const screenshotEntries: { image: number; barcode?: string }[] = []
        for (let j = 0; j < screenshotFiles.length; j++) {
          const ts = Math.floor(seg.start) + j
          console.log(`[processVideo]   Uploading screenshot ${j + 1}/${screenshotFiles.length} (t=${ts}s)`)
          const mediaId = await uploadFile(payload, screenshotFiles[j], `${video.title} – ${ts}s`, 'image/jpeg')

          const entry: { image: number; barcode?: string } = { image: mediaId }
          if (j === barcodeScreenshotIndex) {
            entry.barcode = foundBarcode
          }
          screenshotEntries.push(entry)
        }

        // Look up product by GTIN
        let referencedProductIds: number[] | undefined
        console.log(`[processVideo]   Looking up product for GTIN: ${foundBarcode}`)
        const products = await payload.find({
          collection: 'products',
          where: { gtin: { equals: foundBarcode } },
          limit: 1,
        })
        if (products.docs.length > 0) {
          referencedProductIds = [products.docs[0].id]
          const productName = products.docs[0].name ?? `#${products.docs[0].id}`
          console.log(`[processVideo]   Matched product #${products.docs[0].id} for GTIN ${foundBarcode}`)
          log.push(`GTIN lookup: matched "${productName}" (product #${products.docs[0].id})`)
        } else {
          console.log(`[processVideo]   No product found for GTIN ${foundBarcode}`)
          log.push(`GTIN lookup: no product found for ${foundBarcode}`)
        }

        log.push(``)
        log.push(`Uploaded ${screenshotEntries.length} screenshots`)
        log.push(`Created snippet (matchingType: barcode)`)

        // Create VideoSnippet
        const firstScreenshot = screenshotEntries[0]?.image ?? null
        console.log(`[processVideo]   Creating VideoSnippet (barcode): ${screenshotEntries.length} screenshots`)

        await payload.create({
          collection: 'video-snippets',
          data: {
            video: videoId,
            image: firstScreenshot,
            matchingType: 'barcode',
            timestampStart: Math.round(seg.start),
            timestampEnd: Math.round(seg.end),
            screenshots: screenshotEntries,
            ...(referencedProductIds ? { referencedProducts: referencedProductIds } : {}),
          },
        })

        totalSegments++
        totalScreenshots += screenshotEntries.length

        // Emit segment event
        await emitEvent(payload, processingJobId, 'info', log.join('\n'))
      } else {
        // ── Visual path: clustering + recognition ──
        console.log(`[processVideo]   No barcode found in segment, using visual recognition path`)

        log.push(`Barcode scan: no barcode found (scanned ${screenshotFiles.length} screenshots)`)
        log.push(``)
        log.push(`Path: VISUAL`)

        // Compute hashes and group by visual similarity using centroid-based clustering
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
          if (bestDistance !== null && bestDistance <= clusterThreshold) {
            assignedGroup = bestGroup
            console.log(`[processVideo]     Screenshot ${j + 1}: hash=${hash} distance=${bestDistance} → existing group ${assignedGroup}`)
          } else {
            assignedGroup = clusterRepresentatives.length
            clusterRepresentatives.push({ hash, group: assignedGroup, screenshotIndex: j })
            if (bestDistance !== null) {
              console.log(`[processVideo]     Screenshot ${j + 1}: hash=${hash} distance=${bestDistance} → new group ${assignedGroup}`)
            } else {
              console.log(`[processVideo]     Screenshot ${j + 1}: hash=${hash} → new group ${assignedGroup}`)
            }
          }

          hashResults.push({ thumbnailPath, hash, distance: bestDistance, screenshotGroup: assignedGroup })
        }

        console.log(`[processVideo]   ${clusterRepresentatives.length} clusters formed`)

        // Build clustering summary for event
        log.push(``)
        log.push(`Clustering: ${clusterRepresentatives.length} clusters from ${screenshotFiles.length} screenshots`)
        for (const rep of clusterRepresentatives) {
          const memberCount = hashResults.filter((h) => h.screenshotGroup === rep.group).length
          log.push(`  Group ${rep.group}: ${memberCount} screenshot${memberCount !== 1 ? 's' : ''} (rep: screenshot ${rep.screenshotIndex + 1})`)
        }

        // Phase 1: Create 128x128 recognition thumbnails for cluster reps and classify
        const recogThumbnails: { clusterGroup: number; imagePath: string; recogPath: string }[] = []
        for (const rep of clusterRepresentatives) {
          const recogPath = await createRecognitionThumbnail(screenshotFiles[rep.screenshotIndex])
          recogThumbnails.push({ clusterGroup: rep.group, imagePath: recogPath, recogPath })
        }

        const classifyResult = await classifyScreenshots(
          recogThumbnails.map((r) => ({ clusterGroup: r.clusterGroup, imagePath: r.imagePath })),
        )
        totalTokensUsed += classifyResult.tokensUsed.totalTokens
        const candidateClusters = new Set(classifyResult.candidates)
        console.log(`[processVideo]   Phase 1 classification: ${candidateClusters.size} product clusters out of ${clusterRepresentatives.length}`)

        log.push(``)
        if (candidateClusters.size > 0) {
          log.push(`Phase 1 — Classification: ${candidateClusters.size} product cluster${candidateClusters.size !== 1 ? 's' : ''} [${classifyResult.candidates.join(', ')}] out of ${clusterRepresentatives.length} (${classifyResult.tokensUsed.totalTokens} tokens)`)
        } else {
          log.push(`Phase 1 — Classification: no product clusters detected out of ${clusterRepresentatives.length} (${classifyResult.tokensUsed.totalTokens} tokens)`)
        }

        // Phase 2 & 3: Recognize and match products for qualifying clusters
        let referencedProductIds: number[] = []

        if (candidateClusters.size > 0) {
          log.push(``)
          log.push(`Phase 2 — Recognition:`)
        }

        const recognitionResults: { clusterGroup: number; brand: string | null; productName: string | null; searchTerms: string[] }[] = []

        for (const clusterGroup of candidateClusters) {
          // Select up to 4 evenly-spaced screenshots from this cluster
          const clusterScreenshots = screenshotFiles
            .map((file, idx) => ({ file, idx }))
            .filter((_, idx) => hashResults[idx].screenshotGroup === clusterGroup)

          const selected: string[] = []
          if (clusterScreenshots.length <= 4) {
            selected.push(...clusterScreenshots.map((s) => s.file))
          } else {
            const step = (clusterScreenshots.length - 1) / 3
            for (let k = 0; k < 4; k++) {
              selected.push(clusterScreenshots[Math.round(k * step)].file)
            }
          }

          console.log(`[processVideo]   Phase 2: Recognizing product from cluster ${clusterGroup} (${selected.length} screenshots)`)
          const recognition = await recognizeProduct(selected)
          if (recognition) {
            totalTokensUsed += recognition.tokensUsed.totalTokens
            recognitionResults.push({
              clusterGroup,
              brand: recognition.brand,
              productName: recognition.productName,
              searchTerms: recognition.searchTerms,
            })

            const brandStr = recognition.brand ? `"${recognition.brand}"` : 'unknown'
            const productStr = recognition.productName ? `"${recognition.productName}"` : 'unknown'
            const termsStr = recognition.searchTerms.length > 0 ? recognition.searchTerms.map((t) => `"${t}"`).join(', ') : 'none'
            log.push(`  Cluster ${clusterGroup}: brand=${brandStr}, product=${productStr}, terms=[${termsStr}] (${recognition.tokensUsed.totalTokens} tokens)`)
          } else {
            log.push(`  Cluster ${clusterGroup}: recognition failed (${selected.length} screenshots sent)`)
          }
        }

        if (recognitionResults.length > 0) {
          log.push(``)
          log.push(`Phase 3 — DB Matching:`)
        }

        for (const recog of recognitionResults) {
          if (recog.brand || recog.productName || recog.searchTerms.length > 0) {
            console.log(`[processVideo]   Phase 3: Matching product in DB for cluster ${recog.clusterGroup}`)
            const matchResult = await matchProduct(payload, recog.brand, recog.productName, recog.searchTerms)
            if (matchResult) {
              totalTokensUsed += matchResult.tokensUsed.totalTokens
              referencedProductIds.push(matchResult.productId)
              console.log(`[processVideo]   Matched product #${matchResult.productId} ("${matchResult.productName}") for cluster ${recog.clusterGroup}`)
              log.push(`  Cluster ${recog.clusterGroup}: matched "${matchResult.productName}" (product #${matchResult.productId}) (${matchResult.tokensUsed.totalTokens} tokens)`)
            } else {
              console.log(`[processVideo]   No product match for cluster ${recog.clusterGroup}`)
              log.push(`  Cluster ${recog.clusterGroup}: no match found`)
            }
          } else {
            log.push(`  Cluster ${recog.clusterGroup}: skipped (no brand/product/terms recognized)`)
          }
        }

        // Deduplicate product IDs
        referencedProductIds = [...new Set(referencedProductIds)]

        // Mark cluster rep screenshots
        const repScreenshotIndices = new Set(clusterRepresentatives.map((r) => r.screenshotIndex))
        // Map cluster group → recog thumbnail path for reps that are candidates
        const recogPathByGroup = new Map<number, string>()
        for (const rt of recogThumbnails) {
          if (candidateClusters.has(rt.clusterGroup)) {
            recogPathByGroup.set(rt.clusterGroup, rt.recogPath)
          }
        }

        // Upload screenshots with all metadata
        const screenshotEntries: {
          image: number
          thumbnail: number
          hash: string
          distance?: number
          screenshotGroup: number
          recognitionCandidate?: boolean
          recognitionThumbnail?: number
        }[] = []

        let recogThumbnailCount = 0
        for (let j = 0; j < screenshotFiles.length; j++) {
          const file = screenshotFiles[j]
          const hr = hashResults[j]
          const ts = Math.floor(seg.start) + j
          console.log(`[processVideo]   Uploading screenshot ${j + 1}/${screenshotFiles.length} (t=${ts}s)`)

          const mediaId = await uploadFile(payload, file, `${video.title} – ${ts}s`, 'image/jpeg')
          const thumbnailId = await uploadFile(payload, hr.thumbnailPath, `${video.title} – ${ts}s thumb`, 'image/png')

          const entry: typeof screenshotEntries[number] = {
            image: mediaId,
            thumbnail: thumbnailId,
            hash: hr.hash,
            screenshotGroup: hr.screenshotGroup,
          }
          if (hr.distance !== null) {
            entry.distance = hr.distance
          }

          // Mark cluster rep screenshots as recognition candidates
          if (repScreenshotIndices.has(j) && candidateClusters.has(hr.screenshotGroup)) {
            entry.recognitionCandidate = true
            const recogPath = recogPathByGroup.get(hr.screenshotGroup)
            if (recogPath) {
              entry.recognitionThumbnail = await uploadFile(payload, recogPath, `${video.title} – ${ts}s recog`, 'image/png')
              recogThumbnailCount++
            }
          }

          screenshotEntries.push(entry)
        }

        log.push(``)
        log.push(`Uploaded ${screenshotEntries.length} screenshots${recogThumbnailCount > 0 ? ` (${recogThumbnailCount} with recognition thumbnails)` : ''}`)
        if (referencedProductIds.length > 0) {
          log.push(`Created snippet (matchingType: visual) → products: [${referencedProductIds.map((id) => `#${id}`).join(', ')}]`)
        } else {
          log.push(`Created snippet (matchingType: visual) → no products matched`)
        }

        // Create VideoSnippet
        const firstScreenshot = screenshotEntries[0]?.image ?? null
        console.log(`[processVideo]   Creating VideoSnippet (visual): ${screenshotEntries.length} screenshots, ${referencedProductIds.length} products`)

        await payload.create({
          collection: 'video-snippets',
          data: {
            video: videoId,
            image: firstScreenshot,
            matchingType: 'visual',
            timestampStart: Math.round(seg.start),
            timestampEnd: Math.round(seg.end),
            screenshots: screenshotEntries,
            ...(referencedProductIds.length > 0 ? { referencedProducts: referencedProductIds } : {}),
          },
        })

        totalSegments++
        totalScreenshots += screenshotEntries.length

        // Emit segment event
        await emitEvent(payload, processingJobId, 'info', log.join('\n'))
      }
    }

    // Step 7: Mark video as processed
    console.log(`\n[processVideo] ── Step: Mark as Processed ──`)
    await payload.update({
      collection: 'videos',
      id: videoId,
      data: { processingStatus: 'processed' },
    })

    console.log(`[processVideo] Done: ${totalSegments} segments, ${totalScreenshots} screenshots, ${totalTokensUsed} tokens`)
    console.log(`[processVideo] ════════════════════════════════════════════════════\n`)

    return { success: true, segmentsCreated: totalSegments, screenshotsCreated: totalScreenshots, tokensUsed: totalTokensUsed }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`[processVideo] FAILED: ${msg}`)
    return { success: false, error: msg, tokensUsed: totalTokensUsed }
  } finally {
    console.log(`[processVideo] Cleaning up: ${tmpDir}`)
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) {
      console.warn(`[processVideo] Cleanup failed: ${e}`)
    }
  }
}
