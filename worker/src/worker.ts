/**
 * Standalone worker process for the crawler.
 *
 * Communicates with the server via Payload's standard REST API.
 * All business logic (claiming, persisting, matching) runs locally.
 *
 * Env vars:
 *   WORKER_SERVER_URL    — base URL of the server (e.g. http://localhost:3000)
 *   WORKER_API_KEY       — API key for the workers collection
 *   WORKER_POLL_INTERVAL — seconds between polls when idle (default: 10)
 *   LOG_LEVEL            — debug|info|warn|error (default: info)
 *   OPENAI_API_KEY       — for video processing and aggregation (optional)
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PayloadRestClient } from '@/lib/payload-client'
import { initLogger, createLogger, type JobCollection } from '@/lib/logger'
import { claimWork } from '@/lib/work-protocol/claim'
import { submitWork } from '@/lib/work-protocol/submit'
import type { AuthenticatedWorker } from '@/lib/work-protocol/types'
import { getSourceDriverBySlug } from '@/lib/source-discovery/driver'
import { getSourceDriver } from '@/lib/source-discovery/driver'
import { getCategoryDriver } from '@/lib/category-discovery/driver'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getVideoDriver } from '@/lib/video-discovery/driver'
import {
  downloadVideo,
  getVideoDuration,
  detectSceneChanges,
  extractScreenshots,
  scanBarcode,
  createThumbnailAndHash,
  createRecognitionThumbnail,
  hammingDistance,
  formatTime,
} from '@/lib/video-processing/process-video'
import { classifyScreenshots, recognizeProduct } from '@/lib/video-processing/recognize-product'
import { extractAudio, transcribeAudio, type TranscriptWord } from '@/lib/video-processing/transcribe-audio'
import { correctTranscript } from '@/lib/video-processing/correct-transcript'
import { splitTranscriptForSnippet } from '@/lib/video-processing/split-transcript'
import { analyzeSentiment, type ProductQuoteResult } from '@/lib/video-processing/analyze-sentiment'
import { aggregateFromSources } from '@/lib/aggregate-product'
import { classifyProduct } from '@/lib/classify-product'
import type { ScrapedProductData, DiscoveredProduct } from '@/lib/source-discovery/types'
import type { DiscoveredCategory } from '@/lib/category-discovery/types'

// ─── Config ───

console.log('[Worker] Environment check at startup:')
console.log(`  DEEPGRAM_API_KEY: ${process.env.DEEPGRAM_API_KEY ? `SET (${process.env.DEEPGRAM_API_KEY.length} chars)` : 'NOT SET'}`)
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `SET (${process.env.OPENAI_API_KEY.length} chars)` : 'NOT SET'}`)
console.log(`  WORKER_SERVER_URL: ${process.env.WORKER_SERVER_URL ?? '(default)'}`)
console.log(`  LOG_LEVEL: ${process.env.LOG_LEVEL ?? '(default)'}`)

const SERVER_URL = process.env.WORKER_SERVER_URL ?? 'http://localhost:3000'
const API_KEY = process.env.WORKER_API_KEY ?? ''
const DEFAULT_POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL ?? '10', 10) * 1000

if (!API_KEY) {
  console.error('[Worker] WORKER_API_KEY is required')
  process.exit(1)
}

// ─── REST Client & Worker Identity ───

const client = new PayloadRestClient(SERVER_URL, API_KEY)
initLogger(client)
const log = createLogger('Worker')
let worker: AuthenticatedWorker

// ─── Heartbeat & Collection Map ───

const COLLECTION_MAP: Record<string, string> = {
  'product-crawl': 'product-crawls',
  'product-discovery': 'product-discoveries',
  'category-discovery': 'category-discoveries',
  'ingredients-discovery': 'ingredients-discoveries',
  'video-discovery': 'video-discoveries',
  'video-processing': 'video-processings',
  'product-aggregation': 'product-aggregations',
}

async function heartbeat(jobId: number, type: string, progress?: unknown): Promise<void> {
  try {
    await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: new Date().toISOString() } })
    if (progress !== undefined) {
      const collection = COLLECTION_MAP[type]
      if (collection) {
        await client.update({ collection, id: jobId, data: { progress } as Record<string, unknown> })
      }
    }
  } catch (e) {
    log.warn(`Heartbeat failed: ${e instanceof Error ? e.message : e}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function uploadMedia(filePath: string, alt: string, mimetype: string): Promise<number> {
  const buffer = fs.readFileSync(filePath)
  const sizeKB = (buffer.length / 1024).toFixed(1)
  log.debug(`Uploading media: ${path.basename(filePath)} (${sizeKB} KB, ${mimetype})`)

  const blob = new Blob([buffer], { type: mimetype })
  const formData = new FormData()
  formData.append('file', blob, path.basename(filePath))
  formData.append('_payload', JSON.stringify({ alt }))

  const url = `${SERVER_URL}/api/media`
  const start = Date.now()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `workers API-Key ${API_KEY}`,
    },
    body: formData,
  })

  const elapsed = Date.now() - start

  if (!res.ok) {
    const text = await res.text()
    log.error(`Media upload failed (${elapsed}ms) → ${res.status}: ${text.slice(0, 200)}`)
    throw new Error(`Media upload failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { doc: { id: number } }
  log.debug(`Media uploaded (${elapsed}ms) → media #${data.doc.id}`)
  return data.doc.id
}

// ─── Job Handlers ───

async function handleProductCrawl(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('product-crawls' as JobCollection, jobId)
  const workItems = work.workItems as Array<{
    sourceProductId: number
    sourceUrl: string
    source: string
  }>
  const debug = work.debug as boolean

  log.info(`Product crawl job #${jobId}: ${workItems.length} items`)

  if (workItems.length === 0) {
    log.warn(`No work items for job #${jobId}, skipping submit`)
    return
  }

  const results: Array<{
    sourceProductId: number
    sourceUrl: string
    source: string
    data: ScrapedProductData | null
    error?: string
  }> = []

  for (const item of workItems) {
    const driver = getSourceDriverBySlug(item.source)
    if (!driver) {
      jlog.error(`No driver for source: ${item.source}`, { event: true, labels: ['scraping'] })
      results.push({
        ...item,
        data: null,
        error: `No driver for source: ${item.source}`,
      })
      continue
    }

    log.info(`  Scraping ${item.sourceUrl}`)
    try {
      const data = await driver.scrapeProduct(item.sourceUrl, { debug })
      results.push({ ...item, data })
      if (!data) {
        results[results.length - 1].error = 'scrapeProduct returned null'
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error(`  Error: ${error}`)
      results.push({ ...item, data: null, error })
    }
  }

  await submitWork(client, worker, { type: 'product-crawl', jobId, results } as Parameters<typeof submitWork>[2])
  log.info(`Submitted crawl results for job #${jobId}`)
}

async function handleProductDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const sourceUrls = work.sourceUrls as string[]
  let currentUrlIndex = work.currentUrlIndex as number
  let driverProgress = work.driverProgress as unknown
  const maxPages = work.maxPages as number | undefined
  const delay = work.delay as number
  const debug = work.debug as boolean

  log.info(
    `Product discovery job #${jobId}: ${sourceUrls.length} URLs, starting at ${currentUrlIndex}`,
  )

  const discoveredProducts: DiscoveredProduct[] = []
  let totalPagesUsed = 0

  let pagesRemaining = maxPages

  while (currentUrlIndex < sourceUrls.length) {
    if (pagesRemaining !== undefined && pagesRemaining <= 0) break

    const url = sourceUrls[currentUrlIndex]
    const driver = getSourceDriver(url)
    if (!driver) {
      log.warn(`No driver for URL: ${url}`)
      currentUrlIndex++
      driverProgress = null
      continue
    }

    log.info(`Discovering from ${url}`)

    const result = await driver.discoverProducts({
      url,
      onProduct: async (product) => {
        discoveredProducts.push(product)
      },
      onError: () => {},
      onProgress: async (dp) => {
        driverProgress = dp
        // Heartbeat during long-running discovery
        await heartbeat(jobId, 'product-discovery', { currentUrlIndex, driverProgress: dp })
      },
      progress: driverProgress ?? undefined,
      maxPages: pagesRemaining,
      delay,
      debug,
    })

    totalPagesUsed += result.pagesUsed

    if (result.done) {
      currentUrlIndex++
      driverProgress = null
      if (pagesRemaining !== undefined) {
        pagesRemaining -= result.pagesUsed
      }
    } else {
      break
    }
  }

  const done = currentUrlIndex >= sourceUrls.length

  await submitWork(client, worker, {
    type: 'product-discovery',
    jobId,
    products: discoveredProducts,
    currentUrlIndex,
    driverProgress,
    done,
    pagesUsed: totalPagesUsed,
  } as Parameters<typeof submitWork>[2])

  log.info(
    `Submitted discovery results: ${discoveredProducts.length} products, done=${done}`,
  )
}

async function handleCategoryDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const storeUrls = work.storeUrls as string[]
  let currentUrlIndex = work.currentUrlIndex as number
  let driverProgress = work.driverProgress as unknown
  const maxPages = work.maxPages as number | undefined
  const pathToId = work.pathToId as Record<string, number>

  log.info(
    `Category discovery job #${jobId}: ${storeUrls.length} URLs, starting at ${currentUrlIndex}`,
  )

  const discoveredCategories: DiscoveredCategory[] = []

  while (currentUrlIndex < storeUrls.length) {
    const url = storeUrls[currentUrlIndex]
    const driver = getCategoryDriver(url)
    if (!driver) {
      log.warn(`No category driver for URL: ${url}`)
      currentUrlIndex++
      driverProgress = null
      continue
    }

    log.info(`Discovering categories from ${url}`)

    const result = await driver.discoverCategories({
      url,
      onCategory: async (cat) => {
        discoveredCategories.push(cat)
      },
      onError: () => {},
      onProgress: async (dp) => {
        driverProgress = dp
        await heartbeat(jobId, 'category-discovery')
      },
      progress: driverProgress as
        | import('@/lib/category-discovery/types').DriverProgress
        | undefined,
      maxPages,
    })

    // discoverCategories returns the final progress state
    if (result) {
      // Check if done: queue is empty
      const isDone = result.queue.length === 0
      if (isDone) {
        currentUrlIndex++
        driverProgress = null
      } else {
        driverProgress = result
        break
      }
    }
  }

  const done = currentUrlIndex >= storeUrls.length

  await submitWork(client, worker, {
    type: 'category-discovery',
    jobId,
    categories: discoveredCategories,
    currentUrlIndex,
    driverProgress,
    pathToId,
    done,
  } as Parameters<typeof submitWork>[2])

  log.info(
    `Submitted category discovery: ${discoveredCategories.length} categories, done=${done}`,
  )
}

async function handleIngredientsDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const sourceUrl = work.sourceUrl as string
  let currentTerm = work.currentTerm as string | null
  let currentPage = work.currentPage as number
  let totalPagesForTerm = work.totalPagesForTerm as number
  let termQueue = work.termQueue as string[]
  const pagesPerTick = work.pagesPerTick as number | undefined

  log.info(`Ingredients discovery job #${jobId}`)

  const driver = getIngredientsDriver(sourceUrl)
  if (!driver) {
    log.error(`No ingredients driver for URL: ${sourceUrl}`)
    return
  }

  const allIngredients: import('@/lib/ingredients-discovery/types').ScrapedIngredientData[] = []
  let pagesProcessed = 0

  while (true) {
    if (pagesPerTick && pagesProcessed >= pagesPerTick) break

    // Get next term if needed
    if (!currentTerm) {
      if (termQueue.length === 0) break
      currentTerm = termQueue.shift()!
      currentPage = 1
      totalPagesForTerm = 0

      // Check term
      const check = await driver.checkTerm(currentTerm)
      if (check.split) {
        termQueue = [...check.subTerms, ...termQueue]
        currentTerm = null
        continue
      }
      totalPagesForTerm = check.totalPages
      if (totalPagesForTerm === 0) {
        currentTerm = null
        continue
      }
    }

    // Fetch page
    log.info(`Fetching "${currentTerm}" page ${currentPage}/${totalPagesForTerm}`)
    const ingredients = await driver.fetchPage(currentTerm, currentPage)
    allIngredients.push(...ingredients)
    pagesProcessed++

    currentPage++
    if (currentPage > totalPagesForTerm) {
      currentTerm = null
      currentPage = 1
      totalPagesForTerm = 0
    }

    // Heartbeat
    await heartbeat(jobId, 'ingredients-discovery')
  }

  const done = !currentTerm && termQueue.length === 0

  await submitWork(client, worker, {
    type: 'ingredients-discovery',
    jobId,
    ingredients: allIngredients,
    currentTerm,
    currentPage,
    totalPagesForTerm,
    termQueue,
    done,
  } as Parameters<typeof submitWork>[2])

  log.info(`Submitted ingredients: ${allIngredients.length} items, done=${done}`)
}

async function handleVideoDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const channelUrl = work.channelUrl as string
  const itemsPerTick = work.itemsPerTick as number
  const previousCreated = work.created as number
  const previousExisting = work.existing as number

  log.info(`Video discovery job #${jobId}: ${channelUrl}`)

  const driver = getVideoDriver(channelUrl)
  if (!driver) {
    log.error(`No video driver for URL: ${channelUrl}`)
    return
  }

  const videos = await driver.discoverVideos(channelUrl)
  const offset = previousCreated + previousExisting
  const batchSize = itemsPerTick

  log.info(`Found ${videos.length} videos, submitting batch from offset ${offset}`)

  await submitWork(client, worker, {
    type: 'video-discovery',
    jobId,
    channelUrl,
    videos,
    totalVideos: videos.length,
    offset,
    batchSize,
  } as Parameters<typeof submitWork>[2])

  log.info(`Submitted video discovery results`)
}

async function handleVideoProcessing(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('video-processings' as JobCollection, jobId)
  const videos = work.videos as Array<{
    videoId: number
    externalUrl: string
    title: string
  }>
  const sceneThreshold = (work.sceneThreshold as number) ?? 0.4
  const clusterThreshold = (work.clusterThreshold as number) ?? 25
  const transcriptionEnabled = (work.transcriptionEnabled as boolean) ?? true
  const transcriptionLanguage = (work.transcriptionLanguage as string) ?? 'de'
  const transcriptionModel = (work.transcriptionModel as string) ?? 'nova-3'

  log.info(`Video processing job #${jobId}: ${videos.length} videos, transcription=${transcriptionEnabled ? `${transcriptionLanguage}/${transcriptionModel}` : 'disabled'}`)

  const results: Array<Record<string, unknown>> = []

  for (const video of videos) {
    log.info(`════════════════════════════════════════════════════`)
    log.info(`Processing: "${video.title}" (id=${video.videoId})`)
    log.info(`URL: ${video.externalUrl}`)

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-'))
    const videoPath = path.join(tmpDir, 'video.mp4')
    const screenshotsDir = path.join(tmpDir, 'screenshots')
    fs.mkdirSync(screenshotsDir)

    let totalTokensUsed = 0

    try {
      // Step 1: Download video
      await downloadVideo(video.externalUrl, videoPath)
      const fileSizeMB = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(1)
      jlog.info(`Video "${video.title}": downloaded (${fileSizeMB} MB)`, { event: true, labels: ['video-processing'] })
      await heartbeat(jobId, 'video-processing')

      // Step 2: Upload video mp4 as media
      log.info(`── Upload video to media ──`)
      const videoMediaId = await uploadMedia(videoPath, video.title || `Video ${video.videoId}`, 'video/mp4')
      log.info(`Uploaded video as media #${videoMediaId}`)
      await heartbeat(jobId, 'video-processing')

      // Step 3: Get duration + scene detection
      const duration = await getVideoDuration(videoPath)
      const sceneChanges = await detectSceneChanges(videoPath, sceneThreshold)
      await heartbeat(jobId, 'video-processing')

      // Step 4: Build segments
      const timestamps = [0, ...sceneChanges.map((s) => s.time), duration]
      const segments: { start: number; end: number }[] = []
      for (let i = 0; i < timestamps.length - 1; i++) {
        const start = timestamps[i]
        const end = timestamps[i + 1]
        if (end - start >= 0.5) {
          segments.push({ start, end })
        }
      }

      log.info(`${segments.length} segments from ${sceneChanges.length} scene changes`)
      jlog.info(`Video "${video.title}": ${sceneChanges.length} scene changes, ${segments.length} segments`, { event: true, labels: ['video-processing', 'scene-detection'] })

      // Step 5: Process each segment
      const segmentResults: Array<Record<string, unknown>> = []

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const segDuration = seg.end - seg.start
        const segLabel = `Segment ${i + 1}/${segments.length}`
        const segTime = `[${formatTime(seg.start)} – ${formatTime(seg.end)}]`

        const eventLog: string[] = []
        eventLog.push(`── ${segLabel} ${segTime} (${segDuration.toFixed(1)}s) ──`)

        log.info(`── ${segLabel}: ${seg.start.toFixed(1)}s – ${seg.end.toFixed(1)}s ──`)

        // Extract screenshots
        const prefix = `seg${String(i).padStart(3, '0')}`
        const screenshotFiles = await extractScreenshots(videoPath, screenshotsDir, prefix, seg.start, segDuration)

        eventLog.push(`Screenshots: ${screenshotFiles.length} extracted (1fps)`)

        // First pass: scan for barcodes (stop at first hit)
        log.info(`Scanning ${screenshotFiles.length} screenshots for barcodes...`)
        let foundBarcode: string | null = null
        let barcodeScreenshotIndex: number | null = null

        for (let j = 0; j < screenshotFiles.length; j++) {
          const barcode = await scanBarcode(screenshotFiles[j])
          if (barcode) {
            foundBarcode = barcode
            barcodeScreenshotIndex = j
            log.info(`Barcode found in screenshot ${j + 1}, skipping remaining`)
            break
          }
        }

        if (foundBarcode) {
          // ── Barcode path ──
          log.info(`Barcode path: ${foundBarcode}`)
          jlog.info(`Video "${video.title}" seg ${i + 1}: barcode ${foundBarcode}`, { event: true, labels: ['video-processing', 'barcode'] })
          eventLog.push(``)
          eventLog.push(`Path: BARCODE`)
          eventLog.push(`Barcode scan: found ${foundBarcode} in screenshot ${barcodeScreenshotIndex! + 1}/${screenshotFiles.length}`)

          const screenshots: Array<Record<string, unknown>> = []
          for (let j = 0; j < screenshotFiles.length; j++) {
            const ts = Math.floor(seg.start) + j
            log.info(`Uploading screenshot ${j + 1}/${screenshotFiles.length} (t=${ts}s)`)
            const imageMediaId = await uploadMedia(screenshotFiles[j], `${video.title} – ${ts}s`, 'image/jpeg')

            const entry: Record<string, unknown> = { imageMediaId }
            if (j === barcodeScreenshotIndex) {
              entry.barcode = foundBarcode
            }
            screenshots.push(entry)
          }

          eventLog.push(``)
          eventLog.push(`Uploaded ${screenshots.length} screenshots`)

          segmentResults.push({
            timestampStart: Math.round(seg.start),
            timestampEnd: Math.round(seg.end),
            matchingType: 'barcode',
            barcode: foundBarcode,
            screenshots,
            eventLog: eventLog.join('\n'),
          })
        } else {
          // ── Visual path ──
          log.info(`No barcode found, using visual recognition path`)
          eventLog.push(`Barcode scan: no barcode found (scanned ${screenshotFiles.length} screenshots)`)
          eventLog.push(``)
          eventLog.push(`Path: VISUAL`)

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
            if (bestDistance !== null && bestDistance <= clusterThreshold) {
              assignedGroup = bestGroup
            } else {
              assignedGroup = clusterRepresentatives.length
              clusterRepresentatives.push({ hash, group: assignedGroup, screenshotIndex: j })
            }

            hashResults.push({ thumbnailPath, hash, distance: bestDistance, screenshotGroup: assignedGroup })
          }

          log.info(`${clusterRepresentatives.length} clusters formed`)
          jlog.info(`Video "${video.title}" seg ${i + 1}: no barcode, ${clusterRepresentatives.length} clusters`, { event: true, labels: ['video-processing'] })

          eventLog.push(``)
          eventLog.push(`Clustering: ${clusterRepresentatives.length} clusters from ${screenshotFiles.length} screenshots`)
          for (const rep of clusterRepresentatives) {
            const memberCount = hashResults.filter((h) => h.screenshotGroup === rep.group).length
            eventLog.push(`  Group ${rep.group}: ${memberCount} screenshot${memberCount !== 1 ? 's' : ''} (rep: screenshot ${rep.screenshotIndex + 1})`)
          }

          // Phase 1: Classify cluster reps
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
          log.info(`Phase 1: ${candidateClusters.size} product clusters out of ${clusterRepresentatives.length}`)
          jlog.info(`Video "${video.title}" seg ${i + 1}: ${candidateClusters.size} product candidates`, { event: true, labels: ['video-processing', 'recognition'] })
          await heartbeat(jobId, 'video-processing')

          eventLog.push(``)
          if (candidateClusters.size > 0) {
            eventLog.push(`Phase 1 — Classification: ${candidateClusters.size} product cluster${candidateClusters.size !== 1 ? 's' : ''} [${classifyResult.candidates.join(', ')}] out of ${clusterRepresentatives.length} (${classifyResult.tokensUsed.totalTokens} tokens)`)
          } else {
            eventLog.push(`Phase 1 — Classification: no product clusters detected out of ${clusterRepresentatives.length} (${classifyResult.tokensUsed.totalTokens} tokens)`)
          }

          // Phase 2: Recognize products in candidate clusters
          const recognitionResults: Array<{ clusterGroup: number; brand: string | null; productName: string | null; searchTerms: string[] }> = []

          if (candidateClusters.size > 0) {
            eventLog.push(``)
            eventLog.push(`Phase 2 — Recognition:`)
          }

          for (const clusterGroup of candidateClusters) {
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

            log.info(`Phase 2: Recognizing product from cluster ${clusterGroup} (${selected.length} screenshots)`)
            const recognition = await recognizeProduct(selected)
            if (recognition) {
              totalTokensUsed += recognition.tokensUsed.totalTokens
              jlog.info(`Video "${video.title}" seg ${i + 1}: "${recognition.brand ?? 'unknown'}" / "${recognition.productName ?? 'unknown'}"`, { event: true, labels: ['video-processing', 'recognition'] })
              recognitionResults.push({
                clusterGroup,
                brand: recognition.brand,
                productName: recognition.productName,
                searchTerms: recognition.searchTerms,
              })
              const brandStr = recognition.brand ? `"${recognition.brand}"` : 'unknown'
              const productStr = recognition.productName ? `"${recognition.productName}"` : 'unknown'
              const termsStr = recognition.searchTerms.length > 0 ? recognition.searchTerms.map((t: string) => `"${t}"`).join(', ') : 'none'
              eventLog.push(`  Cluster ${clusterGroup}: brand=${brandStr}, product=${productStr}, terms=[${termsStr}] (${recognition.tokensUsed.totalTokens} tokens)`)
            } else {
              eventLog.push(`  Cluster ${clusterGroup}: recognition failed (${selected.length} screenshots sent)`)
            }
            await heartbeat(jobId, 'video-processing')
          }

          // Upload screenshots with metadata
          const repScreenshotIndices = new Set(clusterRepresentatives.map((r) => r.screenshotIndex))
          const recogPathByGroup = new Map<number, string>()
          for (const rt of recogThumbnails) {
            if (candidateClusters.has(rt.clusterGroup)) {
              recogPathByGroup.set(rt.clusterGroup, rt.recogPath)
            }
          }

          const screenshots: Array<Record<string, unknown>> = []
          let recogThumbnailCount = 0

          for (let j = 0; j < screenshotFiles.length; j++) {
            const file = screenshotFiles[j]
            const hr = hashResults[j]
            const ts = Math.floor(seg.start) + j
            log.info(`Uploading screenshot ${j + 1}/${screenshotFiles.length} (t=${ts}s)`)

            const imageMediaId = await uploadMedia(file, `${video.title} – ${ts}s`, 'image/jpeg')
            const thumbnailMediaId = await uploadMedia(hr.thumbnailPath, `${video.title} – ${ts}s thumb`, 'image/png')

            const entry: Record<string, unknown> = {
              imageMediaId,
              thumbnailMediaId,
              hash: hr.hash,
              screenshotGroup: hr.screenshotGroup,
            }
            if (hr.distance !== null) {
              entry.distance = hr.distance
            }

            if (repScreenshotIndices.has(j) && candidateClusters.has(hr.screenshotGroup)) {
              entry.recognitionCandidate = true
              const recogPath = recogPathByGroup.get(hr.screenshotGroup)
              if (recogPath) {
                entry.recognitionThumbnailMediaId = await uploadMedia(recogPath, `${video.title} – ${ts}s recog`, 'image/png')
                recogThumbnailCount++
              }
            }

            screenshots.push(entry)
          }

          eventLog.push(``)
          eventLog.push(`Uploaded ${screenshots.length} screenshots${recogThumbnailCount > 0 ? ` (${recogThumbnailCount} with recognition thumbnails)` : ''}`)

          segmentResults.push({
            timestampStart: Math.round(seg.start),
            timestampEnd: Math.round(seg.end),
            matchingType: 'visual',
            screenshots,
            recognitionResults,
            eventLog: eventLog.join('\n'),
          })
        }

        await heartbeat(jobId, 'video-processing')
      }

      // ── Transcription & Sentiment Pipeline ──
      let transcriptData: { transcript: string; transcriptWords: TranscriptWord[] } | undefined
      let snippetTranscripts: Array<{ preTranscript: string; transcript: string; postTranscript: string }> | undefined
      let snippetVideoQuotes: ProductQuoteResult[][] | undefined
      let tokensTranscriptCorrection = 0
      let tokensSentiment = 0

      if (transcriptionEnabled) {
        try {
          // Step T1: Extract audio
          const audioPath = path.join(tmpDir, 'audio.wav')
          await extractAudio(videoPath, audioPath)
          await heartbeat(jobId, 'video-processing')

          // Collect all referenced product names + brands from segment results for keywords
          const productKeywords: string[] = []
          const referencedProductIds = new Set<number>()
          for (const seg of segmentResults) {
            const recogResults = seg.recognitionResults as Array<{ brand: string | null; productName: string | null }> | undefined
            if (recogResults) {
              for (const r of recogResults) {
                if (r.brand) productKeywords.push(r.brand)
                if (r.productName) productKeywords.push(r.productName)
              }
            }
            // Also check barcode matches — we'll resolve product names later for sentiment
          }
          const uniqueKeywords = [...new Set(productKeywords)]

          // Step T2: Transcribe with Deepgram
          log.debug(`DEEPGRAM_API_KEY present: ${!!process.env.DEEPGRAM_API_KEY} (${process.env.DEEPGRAM_API_KEY?.length ?? 0} chars)`)
          const rawTranscription = await transcribeAudio(audioPath, {
            language: transcriptionLanguage,
            model: transcriptionModel,
            keywords: uniqueKeywords,
          })
          jlog.info(`Video "${video.title}": transcribed ${rawTranscription.words.length} words`, { event: true, labels: ['video-processing', 'transcription'] })
          await heartbeat(jobId, 'video-processing')

          // Step T3: Fetch all brand names from DB for LLM correction context
          const brandsResult = await client.find({ collection: 'brands', limit: 500 })
          const allBrandNames = brandsResult.docs.map((b) => (b as { name: string }).name).filter(Boolean)

          // Collect product names from recognition results for correction context
          const recognizedProductNames = uniqueKeywords

          // Step T4: Correct transcript via LLM
          const correction = await correctTranscript(
            rawTranscription.transcript,
            rawTranscription.words,
            allBrandNames,
            recognizedProductNames,
          )
          tokensTranscriptCorrection = correction.tokensUsed.totalTokens
          jlog.info(`Video "${video.title}": transcript corrected (${correction.corrections.length} fixes, ${tokensTranscriptCorrection} tokens)`, { event: true, labels: ['video-processing', 'transcription'] })
          await heartbeat(jobId, 'video-processing')

          // Use corrected transcript text but keep original word timestamps
          // (word-level corrections are tracked but timestamps come from Deepgram)
          transcriptData = {
            transcript: correction.correctedTranscript,
            transcriptWords: rawTranscription.words,
          }

          // Step T5: Split transcript for each snippet
          snippetTranscripts = segmentResults.map((seg) => {
            return splitTranscriptForSnippet(
              rawTranscription.words,
              seg.timestampStart as number,
              seg.timestampEnd as number,
              5, // preSeconds
              3, // postSeconds
            )
          })

          // Step T6: Sentiment analysis per snippet
          // First, resolve all product IDs to names for sentiment context
          // Gather all unique product IDs from segment recognition results
          for (const seg of segmentResults) {
            if (seg.matchingType === 'barcode' && seg.barcode) {
              const products = await client.find({
                collection: 'products',
                where: { gtin: { equals: seg.barcode as string } },
                limit: 1,
              })
              if (products.docs.length > 0) {
                referencedProductIds.add((products.docs[0] as { id: number }).id)
              }
            } else if (seg.recognitionResults) {
              // Visual product IDs will be resolved in persist, but for sentiment
              // we need to find them now
              for (const recog of seg.recognitionResults as Array<{ brand: string | null; productName: string | null; searchTerms: string[] }>) {
                if (recog.brand || recog.productName) {
                  const searchTerms = recog.searchTerms ?? []
                  // Quick search to find matching product
                  for (const term of [recog.productName, ...searchTerms].filter(Boolean)) {
                    const found = await client.find({
                      collection: 'products',
                      where: { name: { contains: term as string } },
                      limit: 1,
                    })
                    if (found.docs.length > 0) {
                      referencedProductIds.add((found.docs[0] as { id: number }).id)
                      break
                    }
                  }
                }
              }
            }
          }

          // Build product info map for sentiment analysis
          const productInfoMap = new Map<number, { brandName: string; productName: string }>()
          for (const productId of referencedProductIds) {
            try {
              const product = await client.findByID({ collection: 'products', id: productId }) as Record<string, unknown>
              const brandRel = product.brand as Record<string, unknown> | number | null
              let brandName = ''
              if (brandRel && typeof brandRel === 'object' && 'name' in brandRel) {
                brandName = brandRel.name as string
              }
              productInfoMap.set(productId, {
                brandName,
                productName: (product.name as string) ?? '',
              })
            } catch {
              // Product not found, skip
            }
          }

          // Run sentiment analysis for each snippet that has transcript and products
          snippetVideoQuotes = []
          for (let segIdx = 0; segIdx < segmentResults.length; segIdx++) {
            const tx = snippetTranscripts[segIdx]

            // Determine which products are referenced in this specific segment
            const seg = segmentResults[segIdx]
            const segProductIds: number[] = []

            if (seg.matchingType === 'barcode' && seg.barcode) {
              const products = await client.find({
                collection: 'products',
                where: { gtin: { equals: seg.barcode as string } },
                limit: 1,
              })
              if (products.docs.length > 0) {
                segProductIds.push((products.docs[0] as { id: number }).id)
              }
            } else if (seg.recognitionResults) {
              for (const recog of seg.recognitionResults as Array<{ brand: string | null; productName: string | null; searchTerms: string[] }>) {
                if (recog.brand || recog.productName) {
                  for (const term of [recog.productName, ...(recog.searchTerms ?? [])].filter(Boolean)) {
                    const found = await client.find({
                      collection: 'products',
                      where: { name: { contains: term as string } },
                      limit: 1,
                    })
                    if (found.docs.length > 0) {
                      segProductIds.push((found.docs[0] as { id: number }).id)
                      break
                    }
                  }
                }
              }
            }

            const uniqueSegProductIds = [...new Set(segProductIds)]
            const segProducts = uniqueSegProductIds
              .filter((id) => productInfoMap.has(id))
              .map((id) => ({
                productId: id,
                brandName: productInfoMap.get(id)!.brandName,
                productName: productInfoMap.get(id)!.productName,
              }))

            if (tx.transcript.trim() && segProducts.length > 0) {
              const sentimentResult = await analyzeSentiment(
                tx.preTranscript,
                tx.transcript,
                tx.postTranscript,
                segProducts,
                transcriptData?.transcript,
              )
              tokensSentiment += sentimentResult.tokensUsed.totalTokens
              snippetVideoQuotes.push(sentimentResult.products)
            } else {
              snippetVideoQuotes.push([])
            }

            await heartbeat(jobId, 'video-processing')
          }

          jlog.info(`Video "${video.title}": sentiment analysis complete (${tokensSentiment} tokens)`, { event: true, labels: ['video-processing', 'sentiment'] })
        } catch (transcriptionError) {
          const msg = transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError)
          log.error(`Transcription pipeline failed for video #${video.videoId}: ${msg}`)
          jlog.error(`Video "${video.title}": transcription failed — ${msg}`, { event: true, labels: ['video-processing', 'transcription'] })
          // Continue without transcription data — segments are still saved
        }
      }

      const totalTokensAll = totalTokensUsed + tokensTranscriptCorrection + tokensSentiment
      log.info(`Done processing video #${video.videoId}: ${segmentResults.length} segments, ${totalTokensAll} tokens (recognition=${totalTokensUsed}, correction=${tokensTranscriptCorrection}, sentiment=${tokensSentiment})`)
      jlog.info(`Video "${video.title}": ${segmentResults.length} segments, ${totalTokensAll} tokens`, { event: true, labels: ['video-processing'] })

      results.push({
        videoId: video.videoId,
        success: true,
        tokensUsed: totalTokensAll,
        tokensRecognition: totalTokensUsed,
        tokensTranscriptCorrection,
        tokensSentiment,
        videoMediaId,
        segments: segmentResults,
        transcriptData,
        snippetTranscripts,
        snippetVideoQuotes,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log.error(`FAILED processing video #${video.videoId}: ${msg}`)
      jlog.error(`Video "${video.title}": failed — ${msg}`, { event: true, labels: ['video-processing'] })
      results.push({
        videoId: video.videoId,
        success: false,
        error: msg,
        tokensUsed: totalTokensUsed,
        tokensRecognition: totalTokensUsed,
        tokensTranscriptCorrection: 0,
        tokensSentiment: 0,
      })
    } finally {
      log.info(`Cleaning up: ${tmpDir}`)
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch (e) {
        log.warn(`Cleanup failed: ${e}`)
      }
    }
  }

  await submitWork(client, worker, { type: 'video-processing', jobId, results } as Parameters<typeof submitWork>[2])
  log.info(`Submitted video processing results for job #${jobId}`)
}

async function handleProductAggregation(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const language = work.language as string
  const aggregationType = work.aggregationType as string
  const lastCheckedSourceId = work.lastCheckedSourceId as number
  const workItems = work.workItems as Array<{
    gtin: string
    categoryBreadcrumb: string | null
    sourceProducts: Array<{
      id: number
      gtin: string | null
      name: string | null
      brandName: string | null
      sourceCategoryId: number | null
      source: string | null
      ingredients: Array<{ name: string | null }> | null
      description: string | null
    }>
  }>

  log.info(`Product aggregation job #${jobId}: ${workItems.length} items (type=${aggregationType})`)

  if (workItems.length === 0) {
    log.warn(`No work items for aggregation job #${jobId}, skipping submit`)
    return
  }

  const results: Array<Record<string, unknown>> = []

  for (const item of workItems) {
    log.info(`Aggregating GTIN ${item.gtin} (${item.sourceProducts.length} sources)`)

    try {
      // Step 1: Aggregate from sources (pure)
      const aggregated = aggregateFromSources(
        item.sourceProducts.map((sp) => ({
          id: sp.id,
          gtin: sp.gtin ?? undefined,
          name: sp.name ?? undefined,
          brandName: sp.brandName ?? undefined,
          sourceCategory: sp.sourceCategoryId ?? undefined,
          source: sp.source ?? undefined,
          ingredients: sp.ingredients
            ? sp.ingredients.map((i) => ({ name: i.name ?? undefined }))
            : undefined,
        })),
      )

      // Step 2: Build classify inputs
      const classifySources: { id: number; description?: string; ingredientNames?: string[] }[] = []
      for (const sp of item.sourceProducts) {
        const ingredientNames = (sp.ingredients ?? [])
          .map((i) => i.name)
          .filter((n): n is string => !!n)
        if (sp.description || ingredientNames.length > 0) {
          classifySources.push({
            id: sp.id,
            description: sp.description || undefined,
            ingredientNames: ingredientNames.length > 0 ? ingredientNames : undefined,
          })
        }
      }

      // Step 3: Classify product (OpenAI)
      let classification: Record<string, unknown> | undefined
      let classifySourceProductIds: number[] | undefined
      let tokensUsed = 0

      if (classifySources.length > 0) {
        try {
          const classifyResult = await classifyProduct(
            classifySources.map((s) => ({ description: s.description, ingredientNames: s.ingredientNames })),
            language,
          )
          tokensUsed = classifyResult.tokensUsed.totalTokens

          classification = {
            description: classifyResult.description,
            productType: classifyResult.productType,
            productAttributes: classifyResult.productAttributes,
            productClaims: classifyResult.productClaims,
            tokensUsed: classifyResult.tokensUsed,
          }

          // Map sourceIndex → sourceProduct.id for evidence
          classifySourceProductIds = classifySources.map((s) => s.id)
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          log.error(`Classification error for GTIN ${item.gtin}: ${error}`)
          // Continue without classification
        }
      }

      results.push({
        gtin: item.gtin,
        sourceProductIds: item.sourceProducts.map((sp) => sp.id),
        aggregated,
        classification,
        classifySourceProductIds,
        tokensUsed,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error(`Error aggregating GTIN ${item.gtin}: ${error}`)
      results.push({
        gtin: item.gtin,
        sourceProductIds: item.sourceProducts.map((sp) => sp.id),
        aggregated: null,
        tokensUsed: 0,
        error,
      })
    }

    await heartbeat(jobId, 'product-aggregation')
  }

  await submitWork(client, worker, {
    type: 'product-aggregation',
    jobId,
    lastCheckedSourceId,
    aggregationType,
    results,
  } as Parameters<typeof submitWork>[2])
  log.info(`Submitted aggregation results for job #${jobId}: ${results.length} items`)
}

// ─── Main Loop ───

async function main(): Promise<void> {
  log.info(`Starting worker`)
  log.info(`Server: ${SERVER_URL}`)
  log.info(`Default poll interval: ${DEFAULT_POLL_INTERVAL / 1000}s`)

  // Authenticate via REST API
  const meResult = await client.me()
  if (!meResult.user) {
    console.error('[Worker] Authentication failed: no user returned from /workers/me')
    process.exit(1)
  }

  const me = meResult.user as { id: number; name: string; capabilities: string[]; status: string; collection?: string }
  if (me.status !== 'active') {
    console.error(`[Worker] Worker "${me.name}" (#${me.id}) is not active (status="${me.status}")`)
    process.exit(1)
  }

  worker = {
    id: me.id,
    name: me.name,
    capabilities: me.capabilities ?? [],
    status: me.status,
  }

  log.info(`Authenticated as "${worker.name}" (#${worker.id}), capabilities=[${worker.capabilities.join(', ')}]`)

  // Update lastSeenAt on startup
  await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: new Date().toISOString() } })

  while (true) {
    let currentJobType: string | undefined
    let currentJobId: unknown | undefined
    try {
      // Update worker lastSeenAt each loop iteration
      await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: new Date().toISOString() } }).catch(() => {})

      const work = await claimWork(client, worker)

      if (work.type === 'none') {
        log.debug(`No work, sleeping ${DEFAULT_POLL_INTERVAL / 1000}s`)
        await sleep(DEFAULT_POLL_INTERVAL)
        continue
      }

      currentJobType = work.type as string
      currentJobId = work.jobId
      log.info(`Dispatching ${work.type} job #${work.jobId}`)

      switch (work.type) {
        case 'product-crawl':
          await handleProductCrawl(work)
          break
        case 'product-discovery':
          await handleProductDiscovery(work)
          break
        case 'category-discovery':
          await handleCategoryDiscovery(work)
          break
        case 'ingredients-discovery':
          await handleIngredientsDiscovery(work)
          break
        case 'video-discovery':
          await handleVideoDiscovery(work)
          break
        case 'video-processing':
          await handleVideoProcessing(work)
          break
        case 'product-aggregation':
          await handleProductAggregation(work)
          break
        default:
          log.warn(`Unknown job type: ${work.type}`)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const jobCtx = currentJobType ? ` (${currentJobType} #${currentJobId})` : ''
      log.error(`Error in main loop${jobCtx}: ${msg}`)
      // Wait before retrying after errors
      await sleep(DEFAULT_POLL_INTERVAL)
    }
  }
}

main().catch((e) => {
  console.error('[Worker] Fatal error:', e)
  process.exit(1)
})
