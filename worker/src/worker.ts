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
import { STAGES, type StageName, type StageConfig, type StageContext } from '@/lib/video-processing/stages'
import {
  STAGES as AGGREGATION_STAGES,
  type StageName as AggregationStageName,
  type StageConfig as AggregationStageConfig,
  type StageContext as AggregationStageContext,
  type AggregationWorkItem,
} from '@/lib/product-aggregation/stages'
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
const EVENT_RETENTION_DAYS = parseInt(process.env.EVENT_RETENTION_DAYS ?? '30', 10)
const PURGE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

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

async function uploadMedia(filePath: string, alt: string, mimetype: string, collection: string = 'video-media'): Promise<number> {
  const buffer = fs.readFileSync(filePath)
  const sizeKB = (buffer.length / 1024).toFixed(1)
  log.debug('Uploading media', { file: path.basename(filePath), sizeKB: Number(sizeKB), mimetype, collection })

  const blob = new Blob([buffer], { type: mimetype })
  const formData = new FormData()
  formData.append('file', blob, path.basename(filePath))
  formData.append('_payload', JSON.stringify({ alt }))

  const url = `${SERVER_URL}/api/${collection}`
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
    log.error('Media upload failed', { elapsedMs: elapsed, status: res.status, collection, response: text.slice(0, 200) })
    throw new Error(`Media upload failed (${res.status}): ${text}`)
  }

  const data = (await res.json()) as { doc: { id: number } }
  log.debug('Media uploaded', { elapsedMs: elapsed, mediaId: data.doc.id, collection })
  return data.doc.id
}

// ─── Job Handlers ───

async function handleProductCrawl(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('product-crawls', jobId)
  const workItems = work.workItems as Array<{
    sourceVariantId?: number
    sourceProductId?: number
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
    sourceProductId?: number
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
  const rawQuery = work.query as string
  const sources = work.sources as string[]
  const maxResults = (work.maxResults as number) ?? 50
  const isGtinSearch = (work.isGtinSearch as boolean) ?? true
  const debug = (work.debug as boolean) ?? false

  // Split multiline query into individual queries (one per line), trim and filter empty lines
  const queries = rawQuery.split('\n').map((q) => q.trim()).filter(Boolean)

  log.info('Product search job', { jobId, queries: queries.length, sources: sources.join(', '), maxResults, isGtinSearch })
  jlog.event('search.started', { query: rawQuery, sources: sources.join(','), maxResults })

  const allProducts: Array<{ product: DiscoveredProduct; source: string; matchedQuery: string }> = []

  for (const query of queries) {
    for (const sourceSlug of sources) {
      const driver = getSourceDriverBySlug(sourceSlug)
      if (!driver) {
        log.warn('No driver for source, skipping', { jobId, source: sourceSlug })
        continue
      }

      try {
        const result = await driver.searchProducts({ query, maxResults, isGtinSearch, debug, logger: jlog })
        log.info('Search results', { jobId, query, source: driver.label, products: result.products.length })

        for (const product of result.products) {
          allProducts.push({ product, source: sourceSlug, matchedQuery: query })
        }
      } catch (e) {
        log.error('Search error', { jobId, query, source: driver.label, error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  log.info('Search totals', { jobId, totalProducts: allProducts.length, queries: queries.length, sourceCount: sources.length })

  await submitWork(client, worker, {
    type: 'product-search',
    jobId,
    products: allProducts as Array<{ product: DiscoveredProduct; source: import('@/lib/source-product-queries').SourceSlug; matchedQuery: string }>,
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

async function handleVideoCrawl(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('video-crawls', jobId)
  const workItems = work.workItems as Array<{
    videoId?: number
    externalUrl: string
    title: string
  }>

  log.info('Video crawl job', { jobId, items: workItems.length })
  jlog.event('video_crawl.started', { items: workItems.length })

  if (workItems.length === 0) {
    log.warn('No work items, releasing claim', { jobId })
    await client.update({ collection: 'video-crawls', id: jobId, data: { claimedBy: null, claimedAt: null } }).catch(() => {})
    return
  }

  const results: Array<{
    videoId: number
    externalUrl: string
    success: boolean
    error?: string
  }> = []

  for (const item of workItems) {
    log.info('Crawling video', { videoId: item.videoId ?? 'new', url: item.externalUrl })
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-video-crawl-'))

    try {
      // Step 1: Get metadata via yt-dlp --dump-json (no download)
      const { execSync } = await import('child_process')
      const metadataJson = execSync(
        `yt-dlp --dump-json --no-download ${JSON.stringify(item.externalUrl)}`,
        { timeout: 60000, maxBuffer: 50 * 1024 * 1024 },
      ).toString('utf-8')
      const metadata = JSON.parse(metadataJson) as Record<string, unknown>

      const title = (metadata.title as string) ?? item.title
      const duration = (metadata.duration as number) ?? undefined
      const viewCount = (metadata.view_count as number) ?? undefined
      const likeCount = (metadata.like_count as number) ?? undefined
      const uploadDate = metadata.upload_date as string | undefined
      const thumbnailUrl = (metadata.thumbnail as string) ?? undefined
      const channelName = (metadata.channel as string) ?? (metadata.uploader as string) ?? undefined
      const channelUrl = (metadata.channel_url as string) ?? undefined

      await heartbeat(jobId, 'video-crawl')

      // Step 2: Resolve/create channel + creator (required — channel is NOT NULL on videos)
      let channelId: number | undefined
      if (channelUrl) {
        // Find existing channel by URL
        const existingChannel = await client.find({
          collection: 'channels',
          where: {
            or: [
              { externalUrl: { equals: channelUrl } },
              { canonicalUrl: { equals: channelUrl } },
            ],
          },
          limit: 1,
        })

        if (existingChannel.docs.length > 0) {
          channelId = (existingChannel.docs[0] as Record<string, unknown>).id as number
        } else {
          // Create creator + channel
          const creatorName = channelName ?? 'Unknown'
          const existingCreator = await client.find({
            collection: 'creators',
            where: { name: { equals: creatorName } },
            limit: 1,
          })
          let creatorId: number
          if (existingCreator.docs.length > 0) {
            creatorId = (existingCreator.docs[0] as Record<string, unknown>).id as number
          } else {
            const newCreator = await client.create({
              collection: 'creators',
              data: { name: creatorName },
            }) as { id: number }
            creatorId = newCreator.id
          }

          // Download channel avatar
          let channelImageId: number | undefined
          const channelAvatarUrl = metadata.channel_thumbnail_url as string | undefined
          if (channelAvatarUrl) {
            try {
              const avatarRes = await fetch(channelAvatarUrl)
              if (avatarRes.ok) {
                const buffer = Buffer.from(await avatarRes.arrayBuffer())
                const contentType = avatarRes.headers.get('content-type') || 'image/jpeg'
                const ext = contentType.includes('png') ? 'png' : 'jpg'
                const avatarPath = path.join(tmpDir, `avatar.${ext}`)
                fs.writeFileSync(avatarPath, buffer)
                channelImageId = await uploadMedia(avatarPath, channelName ?? 'Channel avatar', contentType, 'profile-media')
              }
            } catch (e) {
              log.warn('Failed to download channel avatar', { error: String(e) })
            }
          }

          // Determine platform
          let platform: 'youtube' | 'instagram' | 'tiktok' = 'youtube'
          try {
            const host = new URL(channelUrl).hostname.toLowerCase()
            if (host.includes('instagram')) platform = 'instagram'
            else if (host.includes('tiktok')) platform = 'tiktok'
          } catch { /* default youtube */ }

          const newChannel = await client.create({
            collection: 'channels',
            data: {
              creator: creatorId,
              platform,
              externalUrl: channelUrl,
              ...(channelImageId ? { image: channelImageId } : {}),
            },
          }) as { id: number }
          channelId = newChannel.id
        }
      }

      if (!channelId) {
        throw new Error(`Could not resolve channel for video ${item.externalUrl} — yt-dlp returned no channel_url`)
      }

      await heartbeat(jobId, 'video-crawl')

      // Step 3: Download video MP4
      const videoPath = path.join(tmpDir, 'video.mp4')
      const { downloadVideo, getVideoDuration } = await import('@/lib/video-processing/process-video')
      await downloadVideo(item.externalUrl, videoPath)
      const actualDuration = await getVideoDuration(videoPath).catch(() => duration)

      await heartbeat(jobId, 'video-crawl')

      // Step 4: Upload video MP4 as media (videoFile)
      const videoMediaId = await uploadMedia(videoPath, title, 'video/mp4', 'video-media')

      // Step 5: Download and upload thumbnail
      let thumbnailMediaId: number | undefined
      if (thumbnailUrl) {
        try {
          const thumbRes = await fetch(thumbnailUrl)
          if (thumbRes.ok) {
            const buffer = Buffer.from(await thumbRes.arrayBuffer())
            const contentType = thumbRes.headers.get('content-type') || 'image/jpeg'
            const ext = contentType.includes('png') ? 'png' : 'jpg'
            const thumbPath = path.join(tmpDir, `thumbnail.${ext}`)
            fs.writeFileSync(thumbPath, buffer)
            thumbnailMediaId = await uploadMedia(thumbPath, `${title} thumbnail`, contentType, 'video-media')
          }
        } catch (e) {
          log.warn('Failed to download thumbnail', { url: thumbnailUrl, error: String(e) })
        }
      }

      // Step 6: Build publishedAt
      let publishedAt: string | undefined
      if (uploadDate && /^\d{8}$/.test(uploadDate)) {
        // yt-dlp returns YYYYMMDD format
        publishedAt = new Date(
          `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`,
        ).toISOString()
      }

      // Step 7: Create or update video record with full data + status='crawled'
      const videoData = {
        title,
        channel: channelId,
        ...(publishedAt ? { publishedAt } : {}),
        ...(actualDuration ? { duration: actualDuration } : {}),
        ...(viewCount != null ? { viewCount } : {}),
        ...(likeCount != null ? { likeCount } : {}),
        videoFile: videoMediaId,
        ...(thumbnailMediaId ? { thumbnail: thumbnailMediaId } : {}),
        status: 'crawled' as const,
      }

      let videoId: number
      if (item.videoId) {
        // Existing video record — update it
        await client.update({
          collection: 'videos',
          id: item.videoId,
          data: videoData,
        })
        videoId = item.videoId
      } else {
        // New URL with no DB record — create the video with all data including channel
        const newVideo = await client.create({
          collection: 'videos',
          data: {
            ...videoData,
            externalUrl: item.externalUrl,
          },
        }) as { id: number }
        videoId = newVideo.id
      }

      log.info('Video crawled successfully', { videoId, title })
      jlog.event('video_crawl.video_crawled', { videoId, title, durationMs: 0 })
      results.push({ videoId, externalUrl: item.externalUrl, success: true })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      log.error('Video crawl error', { videoId: item.videoId ?? 0, url: item.externalUrl, error })
      jlog.event('video_crawl.error', { url: item.externalUrl, error })
      results.push({ videoId: item.videoId ?? 0, externalUrl: item.externalUrl, success: false, error })
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch (e) {
        log.warn('Cleanup failed', { error: e instanceof Error ? e.message : String(e) })
      }
    }

    await heartbeat(jobId, 'video-crawl')
  }

  await submitWork(client, worker, { type: 'video-crawl', jobId, results } as Parameters<typeof submitWork>[2])
  log.info('Submitted video crawl results', { jobId, items: results.length })
}

async function handleVideoProcessing(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('video-processings', jobId)
  const stageItems = work.stageItems as Array<{
    videoId: number
    title: string
    stageName: string
  }>
  const enabledStagesArr = work.enabledStages as string[]
  const enabledStages = new Set(enabledStagesArr) as Set<StageName>

  const stageConfig: StageConfig = {
    jobId,
    sceneThreshold: (work.sceneThreshold as number) ?? 0.4,
    clusterThreshold: (work.clusterThreshold as number) ?? 25,
    transcriptionLanguage: (work.transcriptionLanguage as string) ?? 'de',
    transcriptionModel: (work.transcriptionModel as string) ?? 'nova-3',
    minBoxArea: ((work.minBoxArea as number) ?? 25) / 100,
  }

  log.info('Video processing job (stage-based)', { jobId, items: stageItems.length, stages: enabledStagesArr.join(',') })
  jlog.event('video_processing.started', { videos: stageItems.length, stages: enabledStagesArr.join(',') })

  const results: Array<Record<string, unknown>> = []

  for (const item of stageItems) {
    const itemLabel = item.title ? `"${item.title}"` : `video #${item.videoId}`
    log.banner(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, { videoId: item.videoId })
    jlog.event('stage.started', { pipeline: 'video-processing', stage: item.stageName, item: item.title || String(item.videoId) })

    // Find the stage definition
    const stageDef = STAGES.find((s) => s.name === item.stageName)
    if (!stageDef) {
      log.bannerEnd(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, false, { error: 'unknown stage' })
      results.push({ videoId: item.videoId, stageName: item.stageName, success: false, error: `Unknown stage: ${item.stageName}` })
      continue
    }

    const stageCtx: StageContext = {
      payload: client,
      config: stageConfig,
      log,
      uploadMedia,
      heartbeat: () => heartbeat(jobId, 'video-processing'),
    }

    const stageStartMs = Date.now()
    try {
      const stageResult = await stageDef.execute(stageCtx, item.videoId)
      const durationMs = Date.now() - stageStartMs
      const tokens = stageResult.tokens?.total ?? 0
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`

      log.bannerEnd(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, stageResult.success, { duration: durationStr, tokens })
      jlog.event('stage.completed', { pipeline: 'video-processing', stage: item.stageName, item: item.title || String(item.videoId), durationMs, tokens })

      results.push({
        videoId: item.videoId,
        stageName: item.stageName,
        success: stageResult.success,
        error: stageResult.error,
        tokensUsed: tokens,
        tokensRecognition: stageResult.tokens?.recognition ?? 0,
        tokensTranscriptCorrection: stageResult.tokens?.transcriptCorrection ?? 0,
        tokensSentiment: stageResult.tokens?.sentiment ?? 0,
      })
    } catch (error) {
      const durationMs = Date.now() - stageStartMs
      const msg = error instanceof Error ? error.message : String(error)
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`

      log.bannerEnd(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, false, { duration: durationStr, error: msg.slice(0, 80) })
      jlog.event('stage.failed', { pipeline: 'video-processing', stage: item.stageName, item: item.title || String(item.videoId), durationMs, error: msg })

      results.push({
        videoId: item.videoId,
        stageName: item.stageName,
        success: false,
        error: msg,
        tokensUsed: 0,
        tokensRecognition: 0,
        tokensTranscriptCorrection: 0,
        tokensSentiment: 0,
      })
    }
  }

  await submitWork(client, worker, { type: 'video-processing', jobId, results, enabledStages: enabledStagesArr } as Parameters<typeof submitWork>[2])
  log.info('Submitted video processing results', { jobId })
}

async function handleProductAggregation(work: Record<string, unknown>): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('product-aggregations', jobId)
  const stageItems = work.stageItems as Array<{
    productId: number | null
    stageName: string
    workItem: AggregationWorkItem
  }>
  const enabledStagesArr = work.enabledStages as string[]

  const stageConfig: AggregationStageConfig = {
    jobId,
    language: (work.language as string) ?? 'de',
    imageSourcePriority: (work.imageSourcePriority as string[]) ?? DEFAULT_IMAGE_SOURCE_PRIORITY,
    detectionThreshold: (work.detectionThreshold as number) ?? 0.3,
    minBoxArea: ((work.minBoxArea as number) ?? 5) / 100,
  }

  log.info('Product aggregation job (stage-based)', { jobId, items: stageItems.length, stages: enabledStagesArr.join(',') })
  jlog.event('aggregation.started', { items: stageItems.length, type: (work.aggregationType as string) ?? 'all', language: stageConfig.language })

  const results: Array<Record<string, unknown>> = []

  for (const item of stageItems) {
    const gtinLabels = item.workItem.gtins.join(', ')
    const itemLabel = gtinLabels.length > 40 ? `${gtinLabels.slice(0, 37)}...` : gtinLabels
    log.banner(`STAGE: ${item.stageName} \u2014 GTINs: ${itemLabel}`, { productId: item.productId })
    jlog.event('stage.started', { pipeline: 'product-aggregation', stage: item.stageName, item: gtinLabels })

    // Find the stage definition
    const stageDef = AGGREGATION_STAGES.find((s) => s.name === item.stageName)
    if (!stageDef) {
      log.bannerEnd(`STAGE: ${item.stageName} \u2014 GTINs: ${itemLabel}`, false, { error: 'unknown stage' })
      results.push({ productId: item.productId, stageName: item.stageName, success: false, error: `Unknown stage: ${item.stageName}`, tokensUsed: 0 })
      continue
    }

    const stageCtx: AggregationStageContext = {
      payload: client,
      config: stageConfig,
      log,
      uploadMedia,
      heartbeat: () => heartbeat(jobId, 'product-aggregation'),
    }

    const stageStartMs = Date.now()
    try {
      const stageResult = await stageDef.execute(stageCtx, item.workItem)
      const durationMs = Date.now() - stageStartMs
      const tokens = stageResult.tokensUsed ?? 0
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`

      log.bannerEnd(`STAGE: ${item.stageName} \u2014 GTINs: ${itemLabel}`, stageResult.success, { duration: durationStr, tokens, productId: stageResult.productId ?? item.productId })
      jlog.event('stage.completed', { pipeline: 'product-aggregation', stage: item.stageName, item: gtinLabels, durationMs, tokens })

      results.push({
        productId: stageResult.productId ?? item.productId,
        stageName: item.stageName,
        success: stageResult.success,
        error: stageResult.error,
        tokensUsed: tokens,
      })
    } catch (error) {
      const durationMs = Date.now() - stageStartMs
      const msg = error instanceof Error ? error.message : String(error)
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`

      log.bannerEnd(`STAGE: ${item.stageName} \u2014 GTINs: ${itemLabel}`, false, { duration: durationStr, error: msg.slice(0, 80) })
      jlog.event('stage.failed', { pipeline: 'product-aggregation', stage: item.stageName, item: gtinLabels, durationMs, error: msg })

      results.push({
        productId: item.productId,
        stageName: item.stageName,
        success: false,
        error: msg,
        tokensUsed: 0,
      })
    }
  }

  await submitWork(client, worker, {
    type: 'product-aggregation',
    jobId,
    results,
    enabledStages: enabledStagesArr,
    aggregationType: work.aggregationType as string,
    lastCheckedSourceId: work.lastCheckedSourceId as number,
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
                collection: 'profile-media',
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
        sourceUrl: url,
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

// ─── Event Purge ───

let lastPurgeAt = 0

async function purgeOldEvents(w: AuthenticatedWorker): Promise<void> {
  if (!w.capabilities.includes('event-purge')) return

  const now = Date.now()
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return

  lastPurgeAt = now
  const cutoff = new Date(now - EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  log.info('Purging old events', { retentionDays: EVENT_RETENTION_DAYS, cutoff })
  const start = Date.now()

  try {
    const result = await client.delete({
      collection: 'events',
      where: { createdAt: { less_than: cutoff } },
    })

    const deleted = typeof result === 'object' && result !== null && 'docs' in result
      ? (result as { docs: unknown[] }).docs.length
      : 0

    const durationMs = Date.now() - start

    if (deleted > 0) {
      log.info('Purged old events', { deleted, durationMs })
      // Emit event without job scope (no jlog needed — this is maintenance)
      const eventData = { deleted, retentionDays: EVENT_RETENTION_DAYS, durationMs }
      try {
        await client.create({
          collection: 'events',
          data: {
            type: 'info',
            name: 'worker.events_purged',
            level: 'info',
            component: 'worker',
            message: `[Worker] Purged ${deleted} events older than ${EVENT_RETENTION_DAYS} days`,
            data: eventData,
            labels: [{ label: 'maintenance' }],
          },
        })
      } catch {
        // Best-effort event emission
      }
    } else {
      log.debug('No old events to purge', { durationMs })
    }
  } catch (e) {
    log.warn('Event purge failed', { error: e instanceof Error ? e.message : String(e) })
  }
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

      // Periodic maintenance: purge old events (runs at most once per hour, requires event-purge capability)
      await purgeOldEvents(worker)

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
        case 'video-crawl':
          await handleVideoCrawl(work)
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
