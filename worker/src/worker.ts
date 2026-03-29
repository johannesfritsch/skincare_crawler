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
import { rebuildJobWork, JOB_TYPE_TO_COLLECTION, type JobType } from '@/lib/work-protocol/claim'
import { submitWork } from '@/lib/work-protocol/submit'
import { failJob, retryOrFail } from '@/lib/work-protocol/job-failure'
import type { AuthenticatedWorker } from '@/lib/work-protocol/types'
import { getSourceDriverBySlug, getSourceDriver, DEFAULT_IMAGE_SOURCE_PRIORITY, DEFAULT_BRAND_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'

import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getVideoDriver } from '@/lib/video-discovery/driver'
import { STAGES, getEnabledStages, getNextStage, type StageName, type StageConfig, type StageContext } from '@/lib/video-processing/stages'
import {
  STAGES as AGGREGATION_STAGES,
  type StageConfig as AggregationStageConfig,
  type StageContext as AggregationStageContext,
  type AggregationWorkItem,
} from '@/lib/product-aggregation/stages'
import type { ScrapedProductData, DiscoveredProduct } from '@/lib/source-discovery/types'
import { executeReviewStage, type ReviewWorkItem } from '@/lib/product-crawl/stages/reviews'
import {
  type VideoCrawlStageName,
  type VideoCrawlStageContext,
  type VideoCrawlWorkItem,
} from '@/lib/video-crawl/stages'
import { executeMetadata } from '@/lib/video-crawl/stages/metadata'
import { executeDownload } from '@/lib/video-crawl/stages/download'
import { executeAudio } from '@/lib/video-crawl/stages/audio'


// ─── Config ───

console.log('[Worker] Environment check at startup:')
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `SET (${process.env.OPENAI_API_KEY.length} chars)` : 'NOT SET'}`)
console.log(`  OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL ?? '(default: api.openai.com)'}`)
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
  const stage = (work.stage as string) ?? 'scrape'
  const enabledStagesArr = (work.enabledStages as string[]) ?? ['scrape', 'reviews']
  const crawlVariants = (work.crawlVariants as boolean) ?? true

  if (stage === 'reviews') {
    // ─── Reviews stage ───
    const reviewWorkItems = work.reviewWorkItems as Array<{ sourceProductId: number; source: string }>

    log.info('Product crawl job (reviews stage)', { jobId, items: reviewWorkItems.length })
    jlog.event('crawl.started', { source: 'reviews', items: reviewWorkItems.length, crawlVariants: false })

    if (reviewWorkItems.length === 0) {
      log.warn('No review work items, releasing claim', { jobId })
      await client.update({ collection: 'product-crawls', id: jobId, data: { claimedBy: null, claimedAt: null } }).catch(() => {})
      return
    }

    const reviewResults: Array<{
      sourceProductId: number
      success: boolean
      reviewsFetched: number
      reviewsCreated: number
      reviewsLinked: number
      reviewsBackfilled: number
      error?: string
    }> = []

    for (const item of reviewWorkItems) {
      log.info('Fetching reviews', { sourceProductId: item.sourceProductId, source: item.source })
      const result = await executeReviewStage(client, item as ReviewWorkItem, jlog)
      reviewResults.push(result)
      await heartbeat(jobId, 'product-crawl')
    }

    await submitWork(client, worker, {
      type: 'product-crawl',
      jobId,
      stage: 'reviews',
      results: [],
      reviewResults,
      crawlVariants,
      enabledStages: enabledStagesArr,
    } as Parameters<typeof submitWork>[2])
    log.info('Submitted review results', { jobId })
    return
  }

  // ─── Scrape stage ───
  const workItems = work.workItems as Array<{
    sourceVariantId?: number
    sourceProductId?: number
    sourceUrl: string
    source: string
  }>
  const debug = (work.debug as boolean) ?? false
  const skipReviews = (work.skipReviews as boolean) ?? false

  log.info('Product crawl job (scrape stage)', { jobId, items: workItems.length, skipReviews })

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
      const data = await driver.scrapeProduct(item.sourceUrl, { debug, logger: jlog, skipReviews })
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

  await submitWork(client, worker, {
    type: 'product-crawl',
    jobId,
    stage: 'scrape',
    results,
    crawlVariants,
    enabledStages: enabledStagesArr,
  } as Parameters<typeof submitWork>[2])
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
  const stageItems = work.stageItems as Array<{
    videoId?: number
    externalUrl: string
    title: string
    stageName: VideoCrawlStageName
  }>
  const enabledStagesArr = work.enabledStages as string[]

  log.info('Video crawl job (stage-based)', { jobId, items: stageItems.length, stages: enabledStagesArr?.join(',') })

  if (stageItems.length === 0) {
    log.warn('No stage items, releasing claim', { jobId })
    await client.update({ collection: 'video-crawls', id: jobId, data: { claimedBy: null, claimedAt: null } }).catch(() => {})
    return
  }

  const stageExecutors: Record<VideoCrawlStageName, (ctx: VideoCrawlStageContext, item: VideoCrawlWorkItem) => Promise<{ success: boolean; error?: string; videoId?: number }>> = {
    metadata: executeMetadata,
    download: executeDownload,
    audio: executeAudio,
  }

  const results: Array<{
    videoId: number
    externalUrl: string
    stageName: string
    success: boolean
    error?: string
    createdVideoId?: number
  }> = []

  for (const item of stageItems) {
    const itemLabel = item.title ? `"${item.title}"` : (item.videoId ? `video #${item.videoId}` : item.externalUrl)
    log.banner(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, { videoId: item.videoId ?? 'new' })
    jlog.event('stage.started', { pipeline: 'video-crawl', stage: item.stageName, item: item.title || item.externalUrl })

    const executor = stageExecutors[item.stageName]
    if (!executor) {
      log.bannerEnd(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, false, { error: 'unknown stage' })
      results.push({ videoId: item.videoId ?? 0, externalUrl: item.externalUrl, stageName: item.stageName, success: false, error: `Unknown stage: ${item.stageName}` })
      continue
    }

    const stageCtx: VideoCrawlStageContext = {
      payload: client,
      config: { jobId },
      log,
      uploadMedia,
      heartbeat: () => heartbeat(jobId, 'video-crawl'),
    }

    const stageStartMs = Date.now()
    try {
      const stageResult = await executor(stageCtx, item)
      const durationMs = Date.now() - stageStartMs
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`

      log.bannerEnd(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, stageResult.success, { duration: durationStr })
      jlog.event('stage.completed', { pipeline: 'video-crawl', stage: item.stageName, item: item.title || item.externalUrl, durationMs, tokens: 0 })

      results.push({
        videoId: item.videoId ?? 0,
        externalUrl: item.externalUrl,
        stageName: item.stageName,
        success: stageResult.success,
        error: stageResult.error,
        // Pass back the newly created videoId for URL-keyed items
        createdVideoId: !item.videoId && stageResult.videoId ? stageResult.videoId : undefined,
      })
    } catch (error) {
      const durationMs = Date.now() - stageStartMs
      const msg = error instanceof Error ? error.message : String(error)
      const durationStr = `${(durationMs / 1000).toFixed(1)}s`

      log.bannerEnd(`STAGE: ${item.stageName} \u2014 ${itemLabel}`, false, { duration: durationStr, error: msg.slice(0, 80) })
      jlog.event('stage.failed', { pipeline: 'video-crawl', stage: item.stageName, item: item.title || item.externalUrl, durationMs, error: msg })

      results.push({
        videoId: item.videoId ?? 0,
        externalUrl: item.externalUrl,
        stageName: item.stageName,
        success: false,
        error: msg,
      })
    }

    await heartbeat(jobId, 'video-crawl')
  }

  await submitWork(client, worker, { type: 'video-crawl', jobId, results, enabledStages: enabledStagesArr } as Parameters<typeof submitWork>[2])
  log.info('Submitted video crawl results', { jobId, items: results.length })
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
    brandSourcePriority: (work.brandSourcePriority as string[]) ?? DEFAULT_BRAND_SOURCE_PRIORITY,
    detectionThreshold: (work.detectionThreshold as number) ?? 0.7,
    minBoxArea: ((work.minBoxArea as number) ?? 5) / 100,
    fallbackDetectionThreshold: (work.fallbackDetectionThreshold as boolean) ?? true,
  }

  log.info('Product aggregation job (stage-based)', { jobId, items: stageItems.length, stages: enabledStagesArr.join(',') })

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
                collection: 'ingredient-media',
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
          const { getOpenAI } = await import('@/lib/openai')
          const openai = getOpenAI()

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



/**
 * Process a single claimed work item — dispatch to the right stage executor.
 */
async function processWorkItem(
  jobType: JobType,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string; retry_count: number },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const jobId = work.id as number

  if (jobType === 'video-processing' && item.stage_name !== 'execute') {
    // ── Multi-stage: run one stage for one video ──
    await processVideoStage(jobId, work, item, jlog)
  } else {
    // ── "Execute" stage: run the entire job using the existing batch loop ──
    // The old build→handle→submit cycle runs inside this work item.
    // submitWork() updates progress; buildXxxWork() finds more batches.
    // When no more work → loop exits → work item completed.
    let batchWork = await rebuildJobWork(client, jobType, jobId)
    while (batchWork.type !== 'none') {
      switch (jobType) {
        case 'product-crawl': await handleProductCrawl(batchWork); break
        case 'product-discovery': await handleProductDiscovery(batchWork); break
        case 'product-search': await handleProductSearch(batchWork); break
        case 'ingredients-discovery': await handleIngredientsDiscovery(batchWork); break
        case 'video-discovery': await handleVideoDiscovery(batchWork); break
        case 'video-crawl': await handleVideoCrawl(batchWork); break
        case 'product-aggregation': await handleProductAggregation(batchWork); break
        case 'ingredient-crawl': await handleIngredientCrawl(batchWork); break
        default: batchWork = { type: 'none' }; continue
      }
      await heartbeat(jobId, jobType)
      await client.workItems.heartbeat([item.id]).catch(() => {})
      batchWork = await rebuildJobWork(client, jobType, jobId)
    }

    // Job is done — mark work item complete
    await client.workItems.complete({ workItemId: item.id, success: true })
  }
}

/**
 * Process a single video-processing stage (multi-stage pipeline).
 */
async function processVideoStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const videoId = parseInt(item.item_key, 10)
  const stageName = item.stage_name as StageName

  const enabledStages = getEnabledStages(work) as Set<StageName>

  const stageDef = STAGES.find((s) => s.name === stageName)
  if (!stageDef) {
    await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error: `Unknown stage: ${stageName}`,
    })
    return
  }

  const stageConfig: StageConfig = {
    jobId,
    sceneThreshold: (work.sceneThreshold as number) ?? 0.4,
    clusterThreshold: (work.clusterThreshold as number) ?? 25,
    transcriptionLanguage: (work.transcriptionLanguage as string) ?? 'de',
    transcriptionModel: (work.transcriptionModel as string) ?? 'nova-3',
    minBoxArea: ((work.minBoxArea as number) ?? 25) / 100,
    detectionThreshold: (work.detectionThreshold as number) ?? 0.3,
    detectionPrompt: (work.detectionPrompt as string) ?? 'cosmetics packaging.',
    searchThreshold: (work.searchThreshold as number) ?? 0.3,
    searchLimit: (work.searchLimit as number) ?? 1,
  }

  const stageCtx: StageContext = {
    payload: client,
    config: stageConfig,
    log,
    uploadMedia,
    heartbeat: async () => {
      await heartbeat(jobId, 'video-processing')
      await client.workItems.heartbeat([item.id]).catch(() => {})
    },
  }

  const itemLabel = `video #${videoId}`
  log.banner(`STAGE: ${stageName} — ${itemLabel}`, { videoId })
  jlog.event('stage.started', { pipeline: 'video-processing', stage: stageName, item: String(videoId) })

  const stageStartMs = Date.now()
  let success = false
  let error: string | undefined
  let tokens = 0
  let tokensRecognition = 0
  let tokensTranscriptCorrection = 0
  let tokensSentiment = 0

  try {
    const result = await stageDef.execute(stageCtx, videoId)
    success = result.success
    error = result.error
    tokens = result.tokens?.total ?? 0
    tokensRecognition = result.tokens?.recognition ?? 0
    tokensTranscriptCorrection = result.tokens?.transcriptCorrection ?? 0
    tokensSentiment = result.tokens?.sentiment ?? 0

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`STAGE: ${stageName} — ${itemLabel}`, success, { duration: `${(durationMs / 1000).toFixed(1)}s`, tokens })
    jlog.event('stage.completed', { pipeline: 'video-processing', stage: stageName, item: String(videoId), durationMs, tokens })
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`STAGE: ${stageName} — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'video-processing', stage: stageName, item: String(videoId), durationMs, error })
  }

  // Determine next stage (only on success)
  const nextStage = success ? getNextStage(stageName, enabledStages) : null

  // Report completion — server handles retry logic, stage advancement, and job completion
  await client.workItems.complete({
    workItemId: item.id,
    success,
    error,
    resultData: { tokensUsed: tokens },
    nextStageName: nextStage?.name ?? null,
    counterUpdates: {
      ...(success ? { completed: 1 } : { errors: 1 }),
      tokensUsed: tokens,
      tokensRecognition,
      tokensTranscriptCorrection,
      tokensSentiment,
    },
  })
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

  // Pre-compute which collections this worker handles (avoids re-computing every loop)
  const workerAllowedCollections = worker.capabilities
    .filter((cap) => cap in JOB_TYPE_TO_COLLECTION)
    .map((cap) => JOB_TYPE_TO_COLLECTION[cap as JobType])

  // Cache job configs so we don't re-fetch on every work item
  const jobConfigCache = new Map<string, { config: Record<string, unknown>; fetchedAt: number }>()
  const JOB_CONFIG_TTL = 60_000 // 1 minute

  async function getJobConfig(collection: string, jobId: number): Promise<Record<string, unknown>> {
    const key = `${collection}:${jobId}`
    const cached = jobConfigCache.get(key)
    if (cached && Date.now() - cached.fetchedAt < JOB_CONFIG_TTL) return cached.config
    const config = await client.findByID({ collection, id: jobId }) as Record<string, unknown>
    jobConfigCache.set(key, { config, fetchedAt: Date.now() })
    return config
  }

  while (true) {
    try {
      // Periodic maintenance (lastSeenAt is updated server-side in the /claim endpoint)
      await purgeOldEvents(worker)

      // ── Step 1: Try to claim a work item ──
      // The server auto-seeds pending jobs transparently during the claim call.
      // allowedCollections filters to only job types this worker can handle.
      const claimed = await client.workItems.claim({
        workerId: worker.id,
        allowedCollections: workerAllowedCollections,
        limit: 1,
        timeoutMinutes: JOB_TIMEOUT_MINUTES,
      })

      if (claimed.items.length > 0) {
        const item = claimed.items[0]
        const jobCollection = item.job_collection
        const jobId = item.job_id

        // Fetch job config (cached)
        const jobConfig = await getJobConfig(jobCollection, jobId)
        const jlog = log.forJob(jobCollection as import('@anyskin/shared').JobCollection, jobId)

        // Determine job type from collection slug
        const jobType = Object.entries(JOB_TYPE_TO_COLLECTION).find(([, col]) => col === jobCollection)?.[0] as JobType | undefined

        if (jobType) {
          try {
            await processWorkItem(jobType, jobConfig, item, jlog)
          } catch (handlerError) {
            const reason = handlerError instanceof Error ? handlerError.message : String(handlerError)
            log.error('Handler threw unrecoverable error', { jobType, jobId, error: reason })
            // Mark work item as failed
            await client.workItems.complete({ workItemId: item.id, success: false, error: reason }).catch(() => {})
            // Trigger retryOrFail which emits critical events (job.failed / job.failed_max_retries)
            await retryOrFail(client, jobCollection as import('@anyskin/shared').JobCollection, jobId, reason).catch(() => {})
          }
        } else {
          log.warn('Unknown job collection for work item', { jobCollection, jobId })
          await client.workItems.complete({ workItemId: item.id, success: false, error: `Unknown job collection: ${jobCollection}` })
        }

        continue // immediately try to claim more work
      }

      // ── Step 2: Nothing to do — sleep ──
      log.debug('No work, sleeping', { sleepS: DEFAULT_POLL_INTERVAL / 1000 })
      await sleep(DEFAULT_POLL_INTERVAL)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.error('Error in main loop', { error: msg })
      await sleep(DEFAULT_POLL_INTERVAL)
    }
  }
}

main().catch((e) => {
  console.error('[Worker] Fatal error:', e)
  process.exit(1)
})
