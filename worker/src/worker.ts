/**
 * Standalone worker process for the crawler.
 *
 * Communicates with the server via Payload's standard REST API.
 * All business logic (claiming, persisting, matching) runs locally.
 *
 * Env vars:
 *   WORKER_SERVER_URL         — base URL of the server (e.g. http://localhost:3000)
 *   WORKER_API_KEY            — API key for the workers collection
 *   WORKER_POLL_INTERVAL      — seconds between polls when idle (default: 10)
 *   WORKER_JOB_TIMEOUT_MINUTES — minutes before a claimed job is considered abandoned (default: 30)
 *   LOG_LEVEL                 — debug|info|warn|error (default: info)
 *   OPENAI_API_KEY            — for video processing and aggregation (optional)
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { PayloadRestClient } from '@/lib/payload-client'
import { initLogger, createLogger } from '@/lib/logger'
import { claimWork, JOB_TYPE_TO_COLLECTION, type JobType } from '@/lib/work-protocol/claim'
import { submitWork } from '@/lib/work-protocol/submit'
import { failJob, retryOrFail } from '@/lib/work-protocol/job-failure'
import type { AuthenticatedWorker } from '@/lib/work-protocol/types'
import { getSourceDriverBySlug, getSourceDriver, DEFAULT_IMAGE_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'

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
import { aggregateFromSources, deduplicateDescriptions, deduplicateIngredients } from '@/lib/aggregate-product'
import { classifyProduct } from '@/lib/classify-product'
import type { ScrapedProductData, DiscoveredProduct } from '@/lib/source-discovery/types'


// ─── Config ───

console.log('[Worker] Environment check at startup:')
console.log(`  DEEPGRAM_API_KEY: ${process.env.DEEPGRAM_API_KEY ? `SET (${process.env.DEEPGRAM_API_KEY.length} chars)` : 'NOT SET'}`)
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `SET (${process.env.OPENAI_API_KEY.length} chars)` : 'NOT SET'}`)
console.log(`  WORKER_SERVER_URL: ${process.env.WORKER_SERVER_URL ?? '(default)'}`)
console.log(`  LOG_LEVEL: ${process.env.LOG_LEVEL ?? '(default)'}`)

const SERVER_URL = process.env.WORKER_SERVER_URL ?? 'http://localhost:3000'
const API_KEY = process.env.WORKER_API_KEY ?? ''
const DEFAULT_POLL_INTERVAL = parseInt(process.env.WORKER_POLL_INTERVAL ?? '10', 10) * 1000
const JOB_TIMEOUT_MINUTES = parseInt(process.env.WORKER_JOB_TIMEOUT_MINUTES ?? '30', 10)

if (!API_KEY) {
  console.error('[Worker] WORKER_API_KEY is required')
  process.exit(1)
}

// ─── REST Client & Worker Identity ───

const client = new PayloadRestClient(SERVER_URL, API_KEY)
initLogger(client)
const log = createLogger('Worker')
let worker: AuthenticatedWorker

// ─── Heartbeat & Helpers ───

async function heartbeat(jobId: number, type: string, progress?: unknown): Promise<void> {
  try {
    const now = new Date().toISOString()
    await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: now } })
    const collection = JOB_TYPE_TO_COLLECTION[type as JobType]
    if (collection) {
      const jobData: Record<string, unknown> = { claimedAt: now }
      if (progress !== undefined) jobData.progress = progress
      await client.update({ collection, id: jobId, data: jobData })
    }
  } catch (e) {
    log.warn('Heartbeat failed', { error: e instanceof Error ? e.message : String(e) })
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function uploadMedia(filePath: string, alt: string, mimetype: string): Promise<number> {
  const buffer = fs.readFileSync(filePath)
  const sizeKB = (buffer.length / 1024).toFixed(1)
  log.debug('Uploading media', { file: path.basename(filePath), sizeKB: Number(sizeKB), mimetype })

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
    log.error('Media upload failed', { elapsedMs: elapsed, status: res.status, response: text.slice(0, 200) })
    throw new Error(`Media upload failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { doc: { id: number } }
  log.debug('Media uploaded', { elapsedMs: elapsed, mediaId: data.doc.id })
  return data.doc.id
}

// ─── Job Handlers ───

async function handleProductCrawl(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('product-crawls', jobId)
  const workItems = work.workItems as Array<{
    sourceVariantId?: number
    sourceProductId: number
    sourceUrl: string
    source: string
  }>
  const debug = work.debug as boolean
  const crawlVariants = work.crawlVariants as boolean

  log.info('Product crawl job', { jobId, items: workItems.length })

  // Determine source slug from first work item
  const crawlSource = workItems.length > 0 ? workItems[0].source : 'unknown'
  jlog.event('crawl.started', { source: crawlSource, items: workItems.length, crawlVariants })

  if (workItems.length === 0) {
    log.warn('No work items, releasing claim', { jobId })
    await client.update({ collection: 'product-crawls', id: jobId, data: { claimedBy: null, claimedAt: null } }).catch(() => {})
    return
  }

  const results: Array<{
    sourceVariantId?: number
    sourceProductId: number
    sourceUrl: string
    source: string
    data: ScrapedProductData | null
    error?: string
  }> = []

  for (const item of workItems) {
    const driver = getSourceDriverBySlug(item.source)
    if (!driver) {
      jlog.event('crawl.driver_missing', { source: item.source })
      results.push({
        ...item,
        data: null,
        error: `No driver for source: ${item.source}`,
      })
      continue
    }

    log.info('Scraping source URL', { sourceUrl: item.sourceUrl })
    try {
      const data = await driver.scrapeProduct(item.sourceUrl, { debug, logger: jlog })
      results.push({ ...item, data })
      if (!data) {
        results[results.length - 1].error = 'scrapeProduct returned null'
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error('Scrape error', { sourceUrl: item.sourceUrl, error })
      results.push({ ...item, data: null, error })
    }
  }

  await submitWork(client, worker, { type: 'product-crawl', jobId, results, crawlVariants } as Parameters<typeof submitWork>[2])
  log.info('Submitted crawl results', { jobId })
}

async function handleProductDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('product-discoveries', jobId)
  const sourceUrls = work.sourceUrls as string[]
  let currentUrlIndex = work.currentUrlIndex as number
  let driverProgress = work.driverProgress as unknown
  const maxPages = work.maxPages as number | undefined
  const delay = work.delay as number
  const debug = work.debug as boolean

  log.info('Product discovery job', { jobId, urlCount: sourceUrls.length, currentUrlIndex })
  jlog.event('discovery.started', { urlCount: sourceUrls.length, currentUrlIndex, maxPages: maxPages ?? 0 })

  const discoveredProducts: DiscoveredProduct[] = []
  let totalPagesUsed = 0

  let pagesRemaining = maxPages

  while (currentUrlIndex < sourceUrls.length) {
    if (pagesRemaining !== undefined && pagesRemaining <= 0) break

    const url = sourceUrls[currentUrlIndex]
    const driver = getSourceDriver(url)
    if (!driver) {
      log.warn('No driver for URL', { url })
      currentUrlIndex++
      driverProgress = null
      continue
    }

    log.info('Discovering from URL', { url })

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
      logger: jlog,
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

  log.info('Submitted discovery results', { products: discoveredProducts.length, done })
}

async function handleProductSearch(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('product-searches', jobId)
  const query = work.query as string
  const sources = work.sources as string[]
  const maxResults = (work.maxResults as number) ?? 50
  const debug = (work.debug as boolean) ?? false

  log.info('Product search job', { jobId, query, sources: sources.join(', '), maxResults })
  jlog.event('search.started', { query, sources: sources.join(','), maxResults })

  const allProducts: Array<{ product: DiscoveredProduct; source: string }> = []

  for (const sourceSlug of sources) {
    const driver = getSourceDriverBySlug(sourceSlug)
    if (!driver) {
      log.warn('No driver for source, skipping', { jobId, source: sourceSlug })
      continue
    }

    try {
      const result = await driver.searchProducts({ query, maxResults, debug, logger: jlog })
      log.info('Search results from source', { jobId, source: driver.label, products: result.products.length })

      for (const product of result.products) {
        allProducts.push({ product, source: sourceSlug })
      }
    } catch (e) {
      log.error('Search error', { jobId, source: driver.label, error: e instanceof Error ? e.message : String(e) })
    }
  }

  log.info('Search totals', { jobId, totalProducts: allProducts.length, sourceCount: sources.length })

  await submitWork(client, worker, {
    type: 'product-search',
    jobId,
    products: allProducts as Array<{ product: DiscoveredProduct; source: import('@/lib/source-product-queries').SourceSlug }>,
  } as Parameters<typeof submitWork>[2])

  log.info('Submitted search results', { products: allProducts.length })
}

async function handleIngredientsDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const sourceUrl = work.sourceUrl as string
  let currentTerm = work.currentTerm as string | null
  let currentPage = work.currentPage as number
  let totalPagesForTerm = work.totalPagesForTerm as number
  let termQueue = work.termQueue as string[]
  const pagesPerTick = work.pagesPerTick as number | undefined

  log.info('Ingredients discovery job', { jobId })
  const jlog = log.forJob('ingredients-discoveries', jobId)
  jlog.event('ingredients_discovery.started', { currentTerm: currentTerm ?? 'none', queueLength: termQueue.length })

  const driver = getIngredientsDriver(sourceUrl)
  if (!driver) {
    await failJob(client, 'ingredients-discoveries', jobId, `No ingredients driver for URL: ${sourceUrl}`)
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
    log.info('Fetching ingredients page', { term: currentTerm, page: currentPage, totalPages: totalPagesForTerm })
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

  log.info('Submitted ingredients', { items: allIngredients.length, done })
}

async function handleVideoDiscovery(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const channelUrl = work.channelUrl as string
  const currentOffset = work.currentOffset as number
  const batchSize = work.batchSize as number
  const maxVideos = work.maxVideos as number | undefined

  log.info('Video discovery job', { jobId, channelUrl, currentOffset, batchSize, maxVideos: maxVideos ?? 'unlimited' })
  const jlog = log.forJob('video-discoveries', jobId)
  jlog.event('video_discovery.started', { currentOffset, batchSize, maxVideos: maxVideos ?? 0 })

  const driver = getVideoDriver(channelUrl)
  if (!driver) {
    await failJob(client, 'video-discoveries', jobId, `No video driver for URL: ${channelUrl}`)
    return
  }

  // Compute how many videos to fetch this batch (respect maxVideos limit)
  let fetchCount = batchSize
  if (maxVideos !== undefined) {
    const remaining = maxVideos - currentOffset
    if (remaining <= 0) {
      log.info('Already at maxVideos limit, nothing to fetch', { maxVideos })
      await submitWork(client, worker, {
        type: 'video-discovery',
        jobId,
        channelUrl,
        videos: [],
        reachedEnd: true,
        nextOffset: currentOffset,
        maxVideos,
      } as Parameters<typeof submitWork>[2])
      return
    }
    fetchCount = Math.min(batchSize, remaining)
  }

  // yt-dlp uses 1-based indices
  const startIndex = currentOffset + 1
  const endIndex = currentOffset + fetchCount

  const result = await driver.discoverVideoPage(channelUrl, { startIndex, endIndex })
  const nextOffset = currentOffset + result.videos.length

  log.info('Fetched videos', { count: result.videos.length, startIndex, endIndex, reachedEnd: result.reachedEnd })

  await submitWork(client, worker, {
    type: 'video-discovery',
    jobId,
    channelUrl,
    videos: result.videos,
    reachedEnd: result.reachedEnd,
    nextOffset,
    maxVideos,
  } as Parameters<typeof submitWork>[2])

  log.info('Submitted video discovery results')
}

async function handleVideoProcessing(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('video-processings', jobId)
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

  log.info('Video processing job', { jobId, videos: videos.length, transcription: transcriptionEnabled ? `${transcriptionLanguage}/${transcriptionModel}` : 'disabled' })
  jlog.event('video_processing.started', { videos: videos.length, transcriptionEnabled, transcriptionLanguage, transcriptionModel })

  const results: Array<Record<string, unknown>> = []

  for (const video of videos) {
    log.info('════════════════════════════════════════════════════')
    log.info('Processing video', { title: video.title, videoId: video.videoId })
    log.info('Video URL', { url: video.externalUrl })

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-'))
    const videoPath = path.join(tmpDir, 'video.mp4')
    const screenshotsDir = path.join(tmpDir, 'screenshots')
    fs.mkdirSync(screenshotsDir)

    let totalTokensUsed = 0

    try {
      // Step 1: Download video
      await downloadVideo(video.externalUrl, videoPath)
      const fileSizeMB = (fs.statSync(videoPath).size / (1024 * 1024)).toFixed(1)
      jlog.event('video_processing.downloaded', { title: video.title, sizeMB: Number(fileSizeMB) })
      await heartbeat(jobId, 'video-processing')

      // Step 2: Upload video mp4 as media
      log.info('Uploading video to media')
      const videoMediaId = await uploadMedia(videoPath, video.title || `Video ${video.videoId}`, 'video/mp4')
      log.info('Uploaded video as media', { mediaId: videoMediaId })
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

      log.info('Segments built', { segments: segments.length, sceneChanges: sceneChanges.length })
      jlog.event('video_processing.scene_detected', { title: video.title, sceneChanges: sceneChanges.length, segments: segments.length })

      // Step 5: Process each segment
      const segmentResults: Array<Record<string, unknown>> = []

      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const segDuration = seg.end - seg.start
        const segLabel = `Segment ${i + 1}/${segments.length}`
        const segTime = `[${formatTime(seg.start)} – ${formatTime(seg.end)}]`

        const eventLog: string[] = []
        eventLog.push(`── ${segLabel} ${segTime} (${segDuration.toFixed(1)}s) ──`)

        log.info('Processing segment', { segment: segLabel, startS: Number(seg.start.toFixed(1)), endS: Number(seg.end.toFixed(1)) })

        // Extract screenshots
        const prefix = `seg${String(i).padStart(3, '0')}`
        const screenshotFiles = await extractScreenshots(videoPath, screenshotsDir, prefix, seg.start, segDuration)

        eventLog.push(`Screenshots: ${screenshotFiles.length} extracted (1fps)`)

        // First pass: scan for barcodes (stop at first hit)
        log.info('Scanning screenshots for barcodes', { count: screenshotFiles.length })
        let foundBarcode: string | null = null
        let barcodeScreenshotIndex: number | null = null

        for (let j = 0; j < screenshotFiles.length; j++) {
          const barcode = await scanBarcode(screenshotFiles[j])
          if (barcode) {
            foundBarcode = barcode
            barcodeScreenshotIndex = j
            log.info('Barcode found, skipping remaining', { screenshot: j + 1, barcode })
            break
          }
        }

        if (foundBarcode) {
          // ── Barcode path ──
          log.info('Barcode path matched', { barcode: foundBarcode })
          jlog.event('video_processing.barcode_found', { title: video.title, segment: i + 1, barcode: foundBarcode })
          eventLog.push(``)
          eventLog.push(`Path: BARCODE`)
          eventLog.push(`Barcode scan: found ${foundBarcode} in screenshot ${barcodeScreenshotIndex! + 1}/${screenshotFiles.length}`)

          const screenshots: Array<Record<string, unknown>> = []
          for (let j = 0; j < screenshotFiles.length; j++) {
            const ts = Math.floor(seg.start) + j
            log.info('Uploading screenshot', { index: j + 1, total: screenshotFiles.length, timestampS: ts })
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
          log.info('No barcode found, using visual recognition path')
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

          log.info('Clusters formed', { clusters: clusterRepresentatives.length })
          jlog.event('video_processing.clustered', { title: video.title, segment: i + 1, clusters: clusterRepresentatives.length })

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
          log.info('Phase 1 classification complete', { productClusters: candidateClusters.size, totalClusters: clusterRepresentatives.length })
          jlog.event('video_processing.candidates_identified', { title: video.title, segment: i + 1, candidates: candidateClusters.size })
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

            log.info('Phase 2: recognizing product', { clusterGroup, screenshots: selected.length })
            const recognition = await recognizeProduct(selected)
            if (recognition) {
              totalTokensUsed += recognition.tokensUsed.totalTokens
              jlog.event('video_processing.product_recognized', { title: video.title, segment: i + 1, brand: recognition.brand ?? 'unknown', product: recognition.productName ?? 'unknown' })
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
            log.info('Uploading screenshot', { index: j + 1, total: screenshotFiles.length, timestampS: ts })

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
          log.debug('DEEPGRAM_API_KEY check', { present: !!process.env.DEEPGRAM_API_KEY, length: process.env.DEEPGRAM_API_KEY?.length ?? 0 })
          const rawTranscription = await transcribeAudio(audioPath, {
            language: transcriptionLanguage,
            model: transcriptionModel,
            keywords: uniqueKeywords,
          })
          jlog.event('video_processing.transcribed', { title: video.title, words: rawTranscription.words.length })
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
          jlog.event('video_processing.transcript_corrected', { title: video.title, fixes: correction.corrections.length, tokens: tokensTranscriptCorrection })
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
              const variants = await client.find({
                collection: 'product-variants',
                where: { gtin: { equals: seg.barcode as string } },
                limit: 1,
              })
              if (variants.docs.length > 0) {
                const variant = variants.docs[0] as Record<string, unknown>
                const productRef = variant.product as number | Record<string, unknown>
                const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
                referencedProductIds.add(pid)
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
              const variants = await client.find({
                collection: 'product-variants',
                where: { gtin: { equals: seg.barcode as string } },
                limit: 1,
              })
              if (variants.docs.length > 0) {
                const variant = variants.docs[0] as Record<string, unknown>
                const productRef = variant.product as number | Record<string, unknown>
                const pid = typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
                segProductIds.push(pid)
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

          jlog.event('video_processing.sentiment_analyzed', { title: video.title, tokens: tokensSentiment })
        } catch (transcriptionError) {
          const msg = transcriptionError instanceof Error ? transcriptionError.message : String(transcriptionError)
          log.error('Transcription pipeline failed', { videoId: video.videoId, error: msg })
          jlog.event('video_processing.transcription_failed', { title: video.title, error: msg })
          // Continue without transcription data — segments are still saved
        }
      }

      const totalTokensAll = totalTokensUsed + tokensTranscriptCorrection + tokensSentiment
      log.info('Done processing video', { videoId: video.videoId, segments: segmentResults.length, totalTokens: totalTokensAll, recognitionTokens: totalTokensUsed, correctionTokens: tokensTranscriptCorrection, sentimentTokens: tokensSentiment })
      jlog.event('video_processing.complete', { title: video.title, segments: segmentResults.length, tokens: totalTokensAll })

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
      log.error('Video processing failed', { videoId: video.videoId, error: msg })
      jlog.event('video_processing.failed', { title: video.title, error: msg })
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
      log.info('Cleaning up temp dir', { tmpDir })
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch (e) {
        log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  await submitWork(client, worker, { type: 'video-processing', jobId, results } as Parameters<typeof submitWork>[2])
  log.info('Submitted video processing results', { jobId })
}

async function handleProductAggregation(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const language = work.language as string
  const aggregationType = work.aggregationType as string
  const scope = (work.scope as string) || 'full'
  const lastCheckedSourceId = work.lastCheckedSourceId as number
  const imageSourcePriority = (work.imageSourcePriority as string[] | undefined) ?? DEFAULT_IMAGE_SOURCE_PRIORITY
  const workItems = work.workItems as Array<{
    gtin: string
    sources: Array<{
      sourceProductId: number
      sourceVariantId: number
      name: string | null
      brandName: string | null
      source: string | null
      ingredientsText: string | null
      description: string | null
      images: Array<{ url: string; alt: string | null }> | null
    }>
  }>

  log.info('Product aggregation job', { jobId, items: workItems.length, type: aggregationType, scope })
  const jlog = log.forJob('product-aggregations', jobId)
  jlog.event('aggregation.started', { items: workItems.length, type: aggregationType, scope, language })

  if (workItems.length === 0) {
    log.warn('No work items for aggregation job, releasing claim', { jobId })
    await client.update({ collection: 'product-aggregations', id: jobId, data: { claimedBy: null, claimedAt: null } }).catch(() => {})
    return
  }

  const results: Array<Record<string, unknown>> = []

  for (const item of workItems) {
    log.info('Aggregating GTIN', { gtin: item.gtin, sources: item.sources.length })

    try {
      // Step 1: Aggregate from sources (pure)
      const aggregated = aggregateFromSources(
        item.sources.map((s) => ({
          sourceProductId: s.sourceProductId,
          sourceVariantId: s.sourceVariantId,
          name: s.name ?? undefined,
          brandName: s.brandName ?? undefined,
          source: s.source ?? undefined,
          ingredientsText: s.ingredientsText ?? undefined,
          description: s.description ?? undefined,
          images: s.images ?? undefined,
        })),
        { imageSourcePriority },
      )

      // Steps 2 & 3: Classify product (OpenAI) — only for full scope
      let classification: Record<string, unknown> | undefined
      let classifySourceProductIds: number[] | undefined
      let tokensUsed = 0

      if (scope === 'full') {
        // Deduplicate descriptions and ingredients across sources to avoid
        // sending identical content to LLMs multiple times
        const uniqueDescs = deduplicateDescriptions(item.sources.map((s) => ({
          sourceProductId: s.sourceProductId,
          sourceVariantId: s.sourceVariantId,
          description: s.description,
        })))
        const uniqueIngr = deduplicateIngredients(item.sources.map((s) => ({
          sourceProductId: s.sourceProductId,
          sourceVariantId: s.sourceVariantId,
          ingredientsText: s.ingredientsText,
        })))

        // Build classify sources from unique descriptions + ingredients
        const classifyMap = new Map<number, { id: number; description?: string; ingredientsText?: string }>()
        for (const d of uniqueDescs) {
          if (!classifyMap.has(d.sourceProductId)) classifyMap.set(d.sourceProductId, { id: d.sourceProductId })
          classifyMap.get(d.sourceProductId)!.description = d.description
        }
        for (const i of uniqueIngr) {
          if (!classifyMap.has(i.sourceProductId)) classifyMap.set(i.sourceProductId, { id: i.sourceProductId })
          classifyMap.get(i.sourceProductId)!.ingredientsText = i.ingredientsText
        }
        const classifySources = [...classifyMap.values()]

        if (classifySources.length > 0) {
          try {
            const classifyResult = await classifyProduct(
              classifySources.map((s) => ({ description: s.description, ingredientsText: s.ingredientsText })),
              language,
            )
            tokensUsed = classifyResult.tokensUsed.totalTokens

            classification = {
              description: classifyResult.description,
              productType: classifyResult.productType,
              warnings: classifyResult.warnings,
              skinApplicability: classifyResult.skinApplicability,
              phMin: classifyResult.phMin,
              phMax: classifyResult.phMax,
              usageInstructions: classifyResult.usageInstructions,
              usageSchedule: classifyResult.usageSchedule,
              productAttributes: classifyResult.productAttributes,
              productClaims: classifyResult.productClaims,
              tokensUsed: classifyResult.tokensUsed,
            }

            // Map sourceIndex → sourceProduct.id for evidence
            classifySourceProductIds = classifySources.map((s) => s.id)
          } catch (e) {
            const error = e instanceof Error ? e.message : String(e)
            log.error('Classification error', { gtin: item.gtin, error })
            // Continue without classification
          }
        }
      } else {
        log.info('Skipping classification (partial scope)', { gtin: item.gtin })
      }

      results.push({
        gtin: item.gtin,
        sourceProductIds: item.sources.map((s) => s.sourceProductId),
        aggregated,
        classification,
        classifySourceProductIds,
        tokensUsed,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error('Error aggregating GTIN', { gtin: item.gtin, error })
      results.push({
        gtin: item.gtin,
        sourceProductIds: item.sources.map((s) => s.sourceProductId),
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
    scope,
    results,
  } as Parameters<typeof submitWork>[2])
  log.info('Submitted aggregation results', { jobId, items: results.length })
}

// ─── Ingredient Crawl ───

async function handleIngredientCrawl(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const crawlType = work.crawlType as string
  const lastCheckedIngredientId = work.lastCheckedIngredientId as number
  const workItems = work.workItems as Array<{
    ingredientId: number
    ingredientName: string
    hasImage: boolean
  }>

  log.info('Ingredient crawl job', { jobId, items: workItems.length, type: crawlType })
  const jlog = log.forJob('ingredient-crawls', jobId)
  jlog.event('ingredient_crawl.started', { items: workItems.length, type: crawlType })

  if (workItems.length === 0) {
    log.warn('No work items for ingredient crawl, releasing claim', { jobId })
    await client.update({ collection: 'ingredient-crawls', id: jobId, data: { claimedBy: null, claimedAt: null } }).catch(() => {})
    return
  }

  const results: Array<Record<string, unknown>> = []

  for (const item of workItems) {
    log.info('Crawling ingredient', { name: item.ingredientName, ingredientId: item.ingredientId })

    try {
      // Step 1: Build URL from ingredient name
      const slug = item.ingredientName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      const url = `https://incidecoder.com/ingredients/${slug}`
      log.info('Fetching ingredient page', { url })

      // Step 2: Fetch page
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!response.ok) {
        // 404 is expected — most CosIng ingredients don't have an INCIDecoder page.
        // Treat as a successful crawl with no data so the ingredient is marked as crawled.
        if (response.status === 404) {
          jlog.event('ingredient_crawl.not_found', { ingredient: item.ingredientName })
          results.push({
            ingredientId: item.ingredientId,
            ingredientName: item.ingredientName,
            tokensUsed: 0,
          })
          continue
        }
        log.warn('HTTP error fetching ingredient', { status: response.status, name: item.ingredientName, url })
        results.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          tokensUsed: 0,
          error: `HTTP ${response.status} from ${url}`,
        })
        continue
      }

      const html = await response.text()

      // Step 3: Extract the description content
      // INCIDecoder pages have a "Details" section with id="details" containing
      // a .showmore-section > .content div with <p> tags.
      // Some pages use "Geeky Details" as the section title instead.
      let longDescription = ''

      const stripHtml = (raw: string): string =>
        raw
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&micro;/g, '\u00B5')
          .replace(/&nbsp;/g, ' ')
          .replace(/\[more\]/g, '')
          .replace(/\[less\]/g, '')
          .replace(/\r\n/g, '\n')
          .replace(/(?:\s*\n){3,}/g, '\n\n')
          .trim()

      // Primary: extract from #details or #showmore-section-details .content
      const detailsMatch = html.match(/id="(?:showmore-section-)?details"[^>]*>[\s\S]*?<div class="content">([\s\S]*?)<\/div>\s*<div class="showmore-link/i)
        || html.match(/id="details"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*paddingt45[^"]*bold|<\/div>\s*<\/div>\s*$)/i)

      if (detailsMatch) {
        longDescription = stripHtml(detailsMatch[1])
      }

      // Fallback: try "Geeky Details" section (older page format)
      if (!longDescription) {
        const geekyMatch = html.match(/id="geeky[^"]*"[^>]*>([\s\S]*?)(?:<h2|<div[^>]*class="[^"]*showmore-section)/i)
          || html.match(/Geeky\s*Details<\/h2>([\s\S]*?)(?:<h2|<div[^>]*class="[^"]*showmore-section)/i)
        if (geekyMatch) {
          longDescription = stripHtml(geekyMatch[1])
        }
      }

      // Fallback: try "Quick Facts" section
      if (!longDescription) {
        const quickFactsMatch = html.match(/Quick\s*Facts<\/h2>([\s\S]*?)(?:<h2|<div[^>]*class="[^"]*showmore-section)/i)
        if (quickFactsMatch) {
          longDescription = stripHtml(quickFactsMatch[1])
        }
      }

      if (!longDescription) {
        // Page exists but no extractable description — still mark as crawled
        jlog.event('ingredient_crawl.no_description', { ingredient: item.ingredientName })
        results.push({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          tokensUsed: 0,
        })
        continue
      }

      log.info('Extracted long description', { name: item.ingredientName, chars: longDescription.length })

      // Step 4: Extract and upload ingredient image (skip if already has one)
      let imageMediaId: number | undefined
      if (!item.hasImage) {
        // Look for the original image inside .imgcontainer
        const imgMatch = html.match(/<div class="imgcontainer[^"]*"[\s\S]*?<img\s[^>]*src="([^"]+_original\.[^"]+)"/)
          || html.match(/<div class="imgcontainer[^"]*"[\s\S]*?<img\s[^>]*src="([^"]+)"/)
        if (imgMatch) {
          const imageUrl = imgMatch[1]
           log.info('Downloading ingredient image', { name: item.ingredientName, imageUrl })
          try {
            const imgRes = await fetch(imageUrl, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              },
            })
            if (imgRes.ok) {
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
              const buffer = Buffer.from(await imgRes.arrayBuffer())
              const urlPath = new URL(imageUrl).pathname
              const filename = urlPath.split('/').pop() || `${slug}.jpg`

              const mediaDoc = await client.create({
                collection: 'media',
                data: { alt: item.ingredientName },
                file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
              })
              imageMediaId = (mediaDoc as { id: number }).id
               log.info('Uploaded ingredient image', { name: item.ingredientName, mediaId: imageMediaId })
            } else {
              log.warn('Image download failed', { status: imgRes.status, name: item.ingredientName })
            }
          } catch (e) {
            log.warn('Image download/upload error', { name: item.ingredientName, error: e instanceof Error ? e.message : String(e) })
          }
        } else {
          log.debug('No image found on page', { name: item.ingredientName })
        }
      } else {
        log.debug('Ingredient already has image, skipping', { name: item.ingredientName })
      }

      // Step 5: Generate short description via LLM
      let shortDescription = ''
      let tokensUsed = 0

      const apiKey = process.env.OPENAI_API_KEY
      if (apiKey) {
        try {
          const OpenAI = (await import('openai')).default
          const openai = new OpenAI({ apiKey })

          const llmResponse = await openai.chat.completions.create({
            model: 'gpt-4.1-mini',
            temperature: 0.7,
            messages: [
              {
                role: 'system',
                content: `You are a skincare ingredient expert who writes short, precise but entertaining descriptions of cosmetic ingredients. Write 1-2 sentences max. Be factual and informative but make it engaging and easy to understand for consumers. No fluff, no filler words. Do not start with the ingredient name.`,
              },
              {
                role: 'user',
                content: `Write a short description for the ingredient "${item.ingredientName}" based on this detailed information:\n\n${longDescription.substring(0, 3000)}`,
              },
            ],
          })

          shortDescription = llmResponse.choices[0]?.message?.content?.trim() || ''
          tokensUsed = llmResponse.usage?.total_tokens || 0
          log.info('Generated short description', { name: item.ingredientName, chars: shortDescription.length, tokens: tokensUsed })
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e)
          log.error('LLM error generating short description', { name: item.ingredientName, error })
          // Continue with longDescription only
        }
      } else {
        log.warn('OPENAI_API_KEY not set, skipping short description generation')
      }

      results.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        longDescription,
        shortDescription: shortDescription || undefined,
        imageMediaId,
        tokensUsed,
      })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error('Error crawling ingredient', { name: item.ingredientName, error })
      results.push({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        tokensUsed: 0,
        error,
      })
    }

    await heartbeat(jobId, 'ingredient-crawl')
  }

  await submitWork(client, worker, {
    type: 'ingredient-crawl',
    jobId,
    lastCheckedIngredientId,
    crawlType,
    results,
  } as Parameters<typeof submitWork>[2])
  log.info('Submitted ingredient crawl results', { jobId, items: results.length })
}

// ─── Main Loop ───

async function main(): Promise<void> {
  log.info('Starting worker')
  log.info('Worker config', { server: SERVER_URL, pollIntervalS: DEFAULT_POLL_INTERVAL / 1000, jobTimeoutM: JOB_TIMEOUT_MINUTES })

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

  log.info('Authenticated', { name: worker.name, workerId: worker.id, capabilities: worker.capabilities.join(', ') })

  // Update lastSeenAt on startup
  await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: new Date().toISOString() } })

  while (true) {
    let currentJobType: string | undefined
    let currentJobId: unknown | undefined
    try {
      // Update worker lastSeenAt each loop iteration
      await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: new Date().toISOString() } }).catch(() => {})

      const work = await claimWork(client, worker, JOB_TIMEOUT_MINUTES)

      if (work.type === 'none') {
        log.debug('No work, sleeping', { sleepS: DEFAULT_POLL_INTERVAL / 1000 })
        await sleep(DEFAULT_POLL_INTERVAL)
        continue
      }

      currentJobType = work.type as string
      currentJobId = work.jobId
      log.info('Dispatching job', { jobType: work.type as string, jobId: work.jobId as number })

      switch (work.type) {
        case 'product-crawl':
          await handleProductCrawl(work)
          break
        case 'product-discovery':
          await handleProductDiscovery(work)
          break
        case 'product-search':
          await handleProductSearch(work)
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
        case 'ingredient-crawl':
          await handleIngredientCrawl(work)
          break
        default:
          log.warn('Unknown job type', { jobType: work.type as string })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('Error in main loop', { jobType: currentJobType ?? null, jobId: (currentJobId as number) ?? null, error: msg })

      // If we know which job failed, increment its retry count (or fail it)
      if (currentJobType && currentJobId) {
        const collection = JOB_TYPE_TO_COLLECTION[currentJobType as JobType]
        if (collection) {
          await retryOrFail(client, collection, currentJobId as number, msg)
        }
      }

      await sleep(DEFAULT_POLL_INTERVAL)
    }
  }
}

main().catch((e) => {
  console.error('[Worker] Fatal error:', e)
  process.exit(1)
})
