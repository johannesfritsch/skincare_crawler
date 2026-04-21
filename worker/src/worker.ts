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
import { JOB_TYPE_TO_COLLECTION, type JobType } from '@/lib/work-protocol/claim'
import { submitWork } from '@/lib/work-protocol/submit'
import { failJob, retryOrFail } from '@/lib/work-protocol/job-failure'
import type { AuthenticatedWorker } from '@/lib/work-protocol/types'
import { getSourceDriverBySlug, getSourceDriver, DEFAULT_IMAGE_SOURCE_PRIORITY, DEFAULT_BRAND_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'

import { runBotCheck } from '@/lib/bot-check'
import { handleTestSuiteRun } from '@/lib/test-suite-run'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getVideoDriver } from '@/lib/video-discovery/driver'
import { getGalleryDriver } from '@/lib/gallery-discovery/driver'
import { STAGES, getEnabledStages, getNextStage, type StageName, type StageConfig, type StageContext } from '@/lib/video-processing/stages'
import {
  STAGES as AGGREGATION_STAGES,
  getNextStage as getNextAggregationStage,
  getEnabledStages as getEnabledAggregationStages,
  type StageName as AggregationStageName,
  type StageConfig as AggregationStageConfig,
  type StageContext as AggregationStageContext,
  type AggregationWorkItem,
} from '@/lib/product-aggregation/stages'
import type { ScrapedProductData, DiscoveredProduct, SourceSlug } from '@/lib/source-discovery/types'
import { executeReviewStage, type ReviewWorkItem } from '@/lib/product-crawl/stages/reviews'
import { getEnabledCrawlStages, getNextCrawlStage, type CrawlStageName } from '@/lib/product-crawl/stages'
import {
  GALLERY_STAGES,
  getEnabledGalleryStages,
  getNextGalleryStage,
  type GalleryStageName,
  type GalleryStageConfig,
  type GalleryStageContext,
} from '@/lib/gallery-processing/stages'
import { persistCrawlResult } from '@/lib/work-protocol/persist'
import { stealthFetch } from '@/lib/stealth-fetch'
import { validateCrawlResult } from '@/lib/validate-crawl-result'
import { getSourceSlugFromUrl, normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'
import {
  type VideoCrawlStageName,
  type VideoCrawlStageContext,
  type VideoCrawlWorkItem,
  getNextVideoCrawlStage,
  getEnabledVideoCrawlStages,
} from '@/lib/video-crawl/stages'
import { executeMetadata } from '@/lib/video-crawl/stages/metadata'
import { executeDownload } from '@/lib/video-crawl/stages/download'
import { executeAudio } from '@/lib/video-crawl/stages/audio'
import { crawlGallery, crawlGalleryMetadata, crawlGalleryDownload } from '@/lib/gallery-crawl/crawl-gallery'
import { fetchInstagramComments } from '@/lib/gallery-crawl/fetch-instagram-comments'
import { getCookies } from '@/lib/video-discovery/drivers/gallery-dl'


// ─── Config ───

import { getProxyConfig } from '@/lib/proxy'

console.log('[Worker] Environment check at startup:')
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `SET (${process.env.OPENAI_API_KEY.length} chars)` : 'NOT SET'}`)
console.log(`  OPENAI_BASE_URL: ${process.env.OPENAI_BASE_URL ?? '(default: api.openai.com)'}`)
console.log(`  WORKER_SERVER_URL: ${process.env.WORKER_SERVER_URL ?? '(default)'}`)
console.log(`  LOG_LEVEL: ${process.env.LOG_LEVEL ?? '(default)'}`)

// Initialize proxy config early so misconfiguration fails fast
const proxyConfig = getProxyConfig()
console.log(`  PROXY: ${proxyConfig ? `enabled (${new URL(proxyConfig.url).host})` : 'disabled'}`)

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
  if (debug) {
    jlog.event('crawl.debug_mode', { jobId })
  }
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
      const data = await driver.scrapeProduct(item.sourceUrl, {
        debug,
        logger: jlog,
        skipReviews,
        debugContext: { client, jobCollection: 'product-crawls' as const, jobId },
      })
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

/**
 * Process a single product-discovery work item (per source URL).
 * Paginates all pages for the URL and accumulates discovered product URLs.
 */
async function processProductDiscoveryItem(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const url = item.item_key
  const debug = (work.debug as boolean) ?? false
  const delay = (work.delay as number) ?? 2000
  const itemLabel = url.length > 60 ? `…${url.slice(-57)}` : url

  log.banner(`DISCOVER: product — ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'product-discoveries', stage: 'discover', item: url })

  const stageStartMs = Date.now()

  try {
    const driver = getSourceDriver(url)
    if (!driver) throw new Error(`No driver for URL: ${url}`)

    const source = getSourceSlugFromUrl(url)
    const discoveredProducts: DiscoveredProduct[] = []

    await driver.discoverProducts({
      url,
      onProduct: async (product) => { discoveredProducts.push(product) },
      onError: () => {},
      onProgress: async () => {
        await client.workItems.heartbeat([item.id]).catch(() => {})
      },
      delay,
      debug,
      logger: jlog,
      debugContext: debug ? { client, jobCollection: 'product-discoveries', jobId } : undefined,
    })

    // Deduplicate and append URLs to job's productUrls field
    const job = await client.findByID({ collection: 'product-discoveries', id: jobId }) as Record<string, unknown>
    const existingUrls = new Set<string>(((job.productUrls as string) ?? '').split('\n').filter(Boolean))
    let newCount = 0
    const newUrls: string[] = []
    for (const product of discoveredProducts) {
      const normalized = normalizeProductUrl(product.productUrl)
      if (!existingUrls.has(normalized)) {
        existingUrls.add(normalized)
        newUrls.push(normalized)
        newCount++
      }
    }
    if (newUrls.length > 0) {
      const allUrls = [...((job.productUrls as string) ?? '').split('\n').filter(Boolean), ...newUrls]
      await client.update({
        collection: 'product-discoveries',
        id: jobId,
        data: { productUrls: allUrls.join('\n') },
      })
    }

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`DISCOVER: product — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, discovered: newCount })
    jlog.event('stage.completed', { pipeline: 'product-discoveries', stage: 'discover', item: url, durationMs, tokens: 0 })
    jlog.event('discovery.batch_persisted', {
      source: source ?? 'unknown',
      discovered: newCount,
      batchSize: discoveredProducts.length,
      batchPersisted: newCount,
      batchErrors: 0,
      batchDurationMs: durationMs,
      pagesUsed: 0,
    })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      counterUpdates: { completed: newCount },
    })
    if (done) {
      const jobStartedAt = (job.startedAt as string) || (job.createdAt as string)
      const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else {
        jlog.event('discovery.completed', { source: source ?? 'unknown', discovered: (job.completed as number ?? 0) + newCount, durationMs: jobDurationMs })
        jlog.event('job.completed', { collection: 'product-discoveries', durationMs: jobDurationMs })
      }
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`DISCOVER: product — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'product-discoveries', stage: 'discover', item: url, durationMs, error })
    const { done, jobStatus } = await client.workItems.complete({ workItemId: item.id, success: false, error })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'product-discoveries', durationMs })
    }
  }
}

/**
 * Process a single video-discovery work item (per channel URL).
 * Paginates all videos for the channel via yt-dlp.
 */
async function processVideoDiscoveryItem(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const channelUrl = item.item_key
  const maxVideos = work.maxVideos as number | undefined
  const dateLimit = work.dateLimit as string | undefined
  const debugMode = work.debugMode as boolean | undefined
  const itemLabel = channelUrl.length > 60 ? `…${channelUrl.slice(-57)}` : channelUrl

  log.banner(`DISCOVER: video — ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'video-discoveries', stage: 'discover', item: channelUrl })

  const stageStartMs = Date.now()

  try {
    const driver = getVideoDriver(channelUrl)
    if (!driver) throw new Error(`No video driver for URL: ${channelUrl}`)

    const allVideos: import('@/lib/video-discovery/types').DiscoveredVideo[] = []
    let offset = 0
    const batchSize = 50

    while (true) {
      // Respect maxVideos limit
      let fetchCount = batchSize
      if (maxVideos !== undefined) {
        const remaining = maxVideos - offset
        if (remaining <= 0) break
        fetchCount = Math.min(batchSize, remaining)
      }

      const startIndex = offset + 1
      const endIndex = offset + fetchCount

      const result = await driver.discoverVideoPage(channelUrl, { startIndex, endIndex, dateLimit, debugMode, logger: jlog, payload: client })
      allVideos.push(...result.videos)
      offset += result.videos.length

      await client.workItems.heartbeat([item.id]).catch(() => {})

      if (result.reachedEnd || result.videos.length < fetchCount) break
    }

    // Deduplicate and append URLs to job's videoUrls field
    const job = await client.findByID({ collection: 'video-discoveries', id: jobId }) as Record<string, unknown>
    const existingUrls = new Set<string>(((job.videoUrls as string) ?? '').split('\n').filter(Boolean))
    let newCount = 0
    const newUrls: string[] = []
    for (const video of allVideos) {
      if (!existingUrls.has(video.externalUrl)) {
        existingUrls.add(video.externalUrl)
        newUrls.push(video.externalUrl)
        newCount++
      }
    }
    if (newUrls.length > 0) {
      const allUrls = [...((job.videoUrls as string) ?? '').split('\n').filter(Boolean), ...newUrls]
      await client.update({
        collection: 'video-discoveries',
        id: jobId,
        data: { videoUrls: allUrls.join('\n') },
      })
    }

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`DISCOVER: video — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, discovered: newCount })
    jlog.event('stage.completed', { pipeline: 'video-discoveries', stage: 'discover', item: channelUrl, durationMs, tokens: 0 })
    jlog.event('video_discovery.batch_persisted', { discovered: newCount, batchSize: allVideos.length, batchDurationMs: durationMs })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      counterUpdates: { completed: newCount },
    })
    if (done) {
      const jobStartedAt = (job.startedAt as string) || (job.createdAt as string)
      const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else {
        jlog.event('video_discovery.completed', { discovered: (job.completed as number ?? 0) + newCount, durationMs: jobDurationMs })
        jlog.event('job.completed', { collection: 'video-discoveries', durationMs: jobDurationMs })
      }
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`DISCOVER: video — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'video-discoveries', stage: 'discover', item: channelUrl, durationMs, error })
    const { done, jobStatus } = await client.workItems.complete({ workItemId: item.id, success: false, error })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'video-discoveries', durationMs })
    }
  }
}

/**
 * Process a single gallery-discovery work item (per channel URL).
 * Paginates all image/carousel posts for the channel via gallery-dl.
 */
async function processGalleryDiscoveryItem(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const channelUrl = item.item_key
  const maxGalleries = work.maxGalleries as number | undefined
  const dateLimit = work.dateLimit as string | undefined
  const itemLabel = channelUrl.length > 60 ? `…${channelUrl.slice(-57)}` : channelUrl

  log.banner(`DISCOVER: gallery — ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'gallery-discoveries', stage: 'discover', item: channelUrl })

  const stageStartMs = Date.now()

  try {
    const driver = getGalleryDriver(channelUrl)
    if (!driver) throw new Error(`No gallery driver for URL: ${channelUrl}`)

    const allGalleries: import('@/lib/gallery-discovery/types').DiscoveredGallery[] = []
    let offset = 0
    const batchSize = 50

    while (true) {
      // Respect maxGalleries limit
      let fetchCount = batchSize
      if (maxGalleries !== undefined) {
        const remaining = maxGalleries - offset
        if (remaining <= 0) break
        fetchCount = Math.min(batchSize, remaining)
      }

      const startIndex = offset + 1
      const endIndex = offset + fetchCount

      const result = await driver.discoverGalleryPage(channelUrl, { startIndex, endIndex, dateLimit, logger: jlog, payload: client })
      allGalleries.push(...result.galleries)
      offset += result.galleries.length

      await client.workItems.heartbeat([item.id]).catch(() => {})

      if (result.reachedEnd || result.galleries.length < fetchCount) break
    }

    // Deduplicate and append URLs to job's galleryUrls field
    const job = await client.findByID({ collection: 'gallery-discoveries', id: jobId }) as Record<string, unknown>
    const existingUrls = new Set<string>(((job.galleryUrls as string) ?? '').split('\n').filter(Boolean))
    let newCount = 0
    const newUrls: string[] = []
    for (const gallery of allGalleries) {
      if (!existingUrls.has(gallery.externalUrl)) {
        existingUrls.add(gallery.externalUrl)
        newUrls.push(gallery.externalUrl)
        newCount++
      }
    }
    if (newUrls.length > 0) {
      const allUrls = [...((job.galleryUrls as string) ?? '').split('\n').filter(Boolean), ...newUrls]
      await client.update({
        collection: 'gallery-discoveries',
        id: jobId,
        data: { galleryUrls: allUrls.join('\n') },
      })
    }

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`DISCOVER: gallery — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, discovered: newCount })
    jlog.event('stage.completed', { pipeline: 'gallery-discoveries', stage: 'discover', item: channelUrl, durationMs, tokens: 0 })
    jlog.event('gallery_discovery.batch_persisted', { discovered: newCount, batchSize: allGalleries.length, batchDurationMs: durationMs })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      counterUpdates: { completed: newCount },
    })
    if (done) {
      const jobStartedAt = (job.startedAt as string) || (job.createdAt as string)
      const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else {
        jlog.event('gallery_discovery.completed', { discovered: (job.completed as number ?? 0) + newCount, durationMs: jobDurationMs })
        jlog.event('job.completed', { collection: 'gallery-discoveries', durationMs: jobDurationMs })
      }
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`DISCOVER: gallery — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'gallery-discoveries', stage: 'discover', item: channelUrl, durationMs, error })
    const { done, jobStatus } = await client.workItems.complete({ workItemId: item.id, success: false, error })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'gallery-discoveries', durationMs })
    }
  }
}

const GALLERY_CRAWL_STAGE_ORDER = ['metadata', 'download', 'comments'] as const
type GalleryCrawlStage = typeof GALLERY_CRAWL_STAGE_ORDER[number]

/** Return the next enabled stage after `current`, or null if none remain. */
function getNextGalleryCrawlStage(current: string, enabledStages: Set<string>): string | null {
  const idx = GALLERY_CRAWL_STAGE_ORDER.indexOf(current as GalleryCrawlStage)
  for (let i = idx + 1; i < GALLERY_CRAWL_STAGE_ORDER.length; i++) {
    if (enabledStages.has(GALLERY_CRAWL_STAGE_ORDER[i])) return GALLERY_CRAWL_STAGE_ORDER[i]
  }
  return null
}

/**
 * Process a single gallery-crawl work item (per-URL, multi-stage).
 *
 * Stages:
 *   0. metadata  — gallery-dl metadata, channel/creator resolution, create gallery record
 *   1. download  — download images, upload to gallery-media, create gallery items
 *   2. comments  — fetch Instagram comments via API
 */
async function processGalleryCrawlItem(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const galleryUrl = item.item_key
  const stageName = item.stage_name
  const itemLabel = galleryUrl.length > 60 ? `…${galleryUrl.slice(-57)}` : galleryUrl

  log.banner(`CRAWL: gallery [${stageName}] — ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'gallery-crawls', stage: stageName, item: galleryUrl })

  const stageStartMs = Date.now()

  try {
    let success = false
    let error: string | undefined

    // Fetch job config to compute next enabled stage
    const job = await client.findByID({ collection: 'gallery-crawls', id: jobId }) as Record<string, unknown>
    const enabledStages = new Set<string>(
      GALLERY_CRAWL_STAGE_ORDER.filter(s => {
        const field = s === 'metadata' ? 'stageMetadata' : s === 'download' ? 'stageDownload' : 'stageComments'
        return job[field] !== false
      })
    )

    if (stageName === 'metadata') {
      const result = await crawlGalleryMetadata(
        galleryUrl,
        client,
        jlog,
        uploadMedia,
        () => client.workItems.heartbeat([item.id]).then(() => {}),
      )
      success = result.success
      error = result.error

      if (success) {
        // Append to crawledGalleryUrls so downstream jobs (gallery-processings) can use it
        const existingUrls = ((job.crawledGalleryUrls as string) ?? '').split('\n').filter(Boolean)
        if (!existingUrls.includes(galleryUrl)) {
          existingUrls.push(galleryUrl)
          await client.update({
            collection: 'gallery-crawls',
            id: jobId,
            data: { crawledGalleryUrls: existingUrls.join('\n') },
          }).catch(() => {})
        }
      }
    } else if (stageName === 'download') {
      const result = await crawlGalleryDownload(
        galleryUrl,
        client,
        jlog,
        uploadMedia,
        () => client.workItems.heartbeat([item.id]).then(() => {}),
      )
      success = result.success
      error = result.error

      if (success) {
        jlog.event('gallery_crawl.gallery_crawled', { galleryId: 0, caption: '', durationMs: Date.now() - stageStartMs })
      }
    } else if (stageName === 'comments') {
      // Find the gallery by externalUrl to get its externalId and commentCount
      const galleries = await client.find({
        collection: 'galleries',
        where: { externalUrl: { equals: galleryUrl } },
        limit: 1,
      })
      const gallery = galleries.docs[0] as Record<string, unknown> | undefined

      if (!gallery) {
        error = `Gallery not found for URL: ${galleryUrl}`
      } else {
        const externalId = (gallery.externalId as string) ?? ''

        if (externalId) {
          const cookies = await getCookies(client, 'instagram')
          if (cookies) {
            const comments = await fetchInstagramComments(externalId, cookies, { limit: 50, logger: jlog })
            if (comments.length > 0) {
              let created = 0
              let skipped = 0
              for (const comment of comments) {
                // Find-or-create by externalId to avoid duplicates on re-run
                if (comment.externalId) {
                  const existing = await client.find({
                    collection: 'gallery-comments',
                    where: { externalId: { equals: comment.externalId } },
                    limit: 1,
                  })
                  if (existing.docs.length > 0) {
                    skipped++
                    continue
                  }
                }
                await client.create({
                  collection: 'gallery-comments',
                  data: {
                    gallery: gallery.id as number,
                    externalId: comment.externalId,
                    username: comment.username,
                    text: comment.text,
                    ...(comment.createdAt ? { createdAt: comment.createdAt } : {}),
                    ...(comment.likeCount != null ? { likeCount: comment.likeCount } : {}),
                  },
                })
                created++
              }
              jlog.info('Stored Instagram comments', { galleryId: gallery.id as number, created, skipped })
            } else {
              jlog.debug('No comments fetched', { galleryId: gallery.id as number, externalId })
            }
          } else {
            jlog.debug('No Instagram cookies for comment fetch')
          }
        } else {
          jlog.debug('Skipping comments — no externalId on gallery', { galleryId: gallery.id as number })
        }
        success = true
      }
    } else {
      error = `Unknown gallery-crawl stage: ${stageName}`
    }

    const durationMs = Date.now() - stageStartMs

    if (!success) {
      log.bannerEnd(`CRAWL: gallery [${stageName}] — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: (error ?? '').slice(0, 80) })
      jlog.event('stage.failed', { pipeline: 'gallery-crawls', stage: stageName, item: galleryUrl, durationMs, error: error ?? 'Unknown error' })
      const { done, jobStatus } = await client.workItems.complete({ workItemId: item.id, success: false, error, counterUpdates: { errors: 1 } })
      if (done) {
        if (jobStatus === 'failed') jlog.event('job.failed', { reason: error ?? 'All work items failed' })
        else jlog.event('job.completed', { collection: 'gallery-crawls', durationMs })
      }
      return
    }

    log.bannerEnd(`CRAWL: gallery [${stageName}] — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s` })
    jlog.event('stage.completed', { pipeline: 'gallery-crawls', stage: stageName, item: galleryUrl, durationMs, tokens: 0 })

    // Compute next enabled stage (worker-side — server does not filter disabled stages)
    const nextStage = getNextGalleryCrawlStage(stageName, enabledStages)

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      nextStageName: nextStage,
      counterUpdates: { completed: 1 },
    })
    if (done) {
      const jobStartedAt = (job.startedAt as string) || (job.createdAt as string)
      const jobDurationMs = jobStartedAt ? Date.now() - new Date(jobStartedAt).getTime() : 0
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else {
        jlog.event('gallery_crawl.completed', { crawled: (job.completed as number ?? 0) + 1, errors: (job.errors as number ?? 0), durationMs: jobDurationMs })
        jlog.event('job.completed', { collection: 'gallery-crawls', durationMs: jobDurationMs })
      }
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`CRAWL: gallery [${stageName}] — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'gallery-crawls', stage: stageName, item: galleryUrl, durationMs, error })
    const { done, jobStatus } = await client.workItems.complete({ workItemId: item.id, success: false, error, counterUpdates: { errors: 1 } })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'gallery-crawls', durationMs })
    }
  }
}

/**
 * Process a single ingredients-discovery work item (per-term, parallel).
 *
 * - `init` stage: resolve driver, spawn initial term items
 * - `discover` stage: check term → split (spawn sub-terms) or fetch all pages and persist
 */
async function processIngredientsDiscoveryItem(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const sourceUrl = work.sourceUrl as string
  const stageName = item.stage_name
  const itemLabel = item.item_key.length > 50 ? `…${item.item_key.slice(-47)}` : item.item_key

  log.banner(`INGREDIENTS: ${stageName} — ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'ingredients-discoveries', stage: stageName, item: item.item_key })

  const stageStartMs = Date.now()

  try {
    const driver = getIngredientsDriver(sourceUrl)
    if (!driver) throw new Error(`No ingredients driver for URL: ${sourceUrl}`)

    if (stageName === 'init') {
      // Bootstrap: spawn initial term items
      const terms = driver.getInitialTermQueue()
      log.info('Ingredients init: spawning initial terms', { terms: terms.length })

      const { done, jobStatus } = await client.workItems.complete({
        workItemId: item.id,
        success: true,
        spawnItems: terms.map(t => ({ itemKey: t, stageName: 'discover' })),
        totalDelta: terms.length,
      })

      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`INGREDIENTS: ${stageName} — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, terms: terms.length })
      jlog.event('stage.completed', { pipeline: 'ingredients-discoveries', stage: stageName, item: item.item_key, durationMs, tokens: 0 })
      if (done) {
        if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
        else jlog.event('job.completed', { collection: 'ingredients-discoveries', durationMs })
      }
      return
    }

    // ── discover stage: check term, split or process ──
    const term = item.item_key
    const check = await driver.checkTerm(term)

    if (check.split) {
      // Term too large — split into sub-terms
      log.info('Term needs splitting', { term, subTerms: check.subTerms.length })
      const { done, jobStatus } = await client.workItems.complete({
        workItemId: item.id,
        success: true,
        spawnItems: check.subTerms.map(t => ({ itemKey: t, stageName: 'discover' })),
        totalDelta: check.subTerms.length,
      })

      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`INGREDIENTS: ${stageName} — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, split: check.subTerms.length })
      jlog.event('stage.completed', { pipeline: 'ingredients-discoveries', stage: stageName, item: term, durationMs, tokens: 0 })
      if (done) {
        if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
        else jlog.event('job.completed', { collection: 'ingredients-discoveries', durationMs })
      }
      return
    }

    if (check.totalPages === 0) {
      // Empty term — nothing to do
      const { done, jobStatus } = await client.workItems.complete({ workItemId: item.id, success: true })
      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`INGREDIENTS: ${stageName} — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, pages: 0 })
      jlog.event('stage.completed', { pipeline: 'ingredients-discoveries', stage: stageName, item: term, durationMs, tokens: 0 })
      if (done) {
        if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
        else jlog.event('job.completed', { collection: 'ingredients-discoveries', durationMs })
      }
      return
    }

    // Process all pages for this term, bulk upsert per page
    let created = 0, existing = 0, errors = 0, discovered = 0
    for (let page = 1; page <= check.totalPages; page++) {
      log.info('Fetching ingredients page', { term, page, totalPages: check.totalPages })
      const ingredients = await driver.fetchPage(term, page)
      discovered += ingredients.length

      if (ingredients.length > 0) {
        const result = await client.bulkUpsertIngredients(ingredients)
        created += result.created
        existing += result.existing
        errors += result.errors
      }

      await client.workItems.heartbeat([item.id]).catch(() => {})
    }

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      counterUpdates: { completed: discovered, created, existing, errors },
    })

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`INGREDIENTS: ${stageName} — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, discovered, created, existing, errors })
    jlog.event('stage.completed', { pipeline: 'ingredients-discoveries', stage: stageName, item: term, durationMs, tokens: 0 })
    jlog.event('ingredients_discovery.batch_persisted', { discovered, created, existing, errors, batchSize: discovered, batchDurationMs: durationMs })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else {
        jlog.event('ingredients_discovery.completed', { discovered, created, existing, errors, durationMs })
        jlog.event('job.completed', { collection: 'ingredients-discoveries', durationMs })
      }
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`INGREDIENTS: ${stageName} — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'ingredients-discoveries', stage: stageName, item: item.item_key, durationMs, error })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
    })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'ingredients-discoveries', durationMs })
    }
  }
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
      log: jlog,
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
    detectionPrompt: (work.detectionPrompt as string) ?? 'cosmetics packaging.',
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
      log: jlog,
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
      const response = await stealthFetch(url, {
        headers: {
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
            const imgRes = await stealthFetch(imageUrl)
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

  if (jobType === 'video-processing') {
    // ── Multi-stage: run one stage for one video ──
    await processVideoStage(jobId, work, item, jlog)
  } else if (jobType === 'product-crawl') {
    // ── Multi-stage: run one stage for one URL ──
    await processProductCrawlStage(jobId, work, item, jlog)
  } else if (jobType === 'video-crawl') {
    // ── Multi-stage: run one stage for one video URL ──
    await processVideoCrawlStage(jobId, work, item, jlog)
  } else if (jobType === 'product-aggregation') {
    // ── Multi-stage: run one stage for one GTIN group ──
    await processProductAggregationStage(jobId, work, item, jlog)
  } else if (jobType === 'ingredient-crawl') {
    // ── Per-ingredient: crawl one ingredient ──
    await processIngredientCrawlStage(jobId, work, item, jlog)
  } else if (jobType === 'product-search') {
    // ── Per-(query, source): search one pair ──
    await processProductSearchStage(jobId, work, item, jlog)
  } else if (jobType === 'product-discovery') {
    // ── Per-URL: discover products from one source URL ──
    await processProductDiscoveryItem(jobId, work, item, jlog)
  } else if (jobType === 'video-discovery') {
    // ── Per-channel: discover videos from one channel ──
    await processVideoDiscoveryItem(jobId, work, item, jlog)
  } else if (jobType === 'ingredients-discovery') {
    // ── Per-term: discover ingredients (init seeds terms, discover processes each in parallel) ──
    await processIngredientsDiscoveryItem(jobId, work, item, jlog)
  } else if (jobType === 'bot-check') {
    // ── Single-shot: run bot detection check ──
    await processBotCheckStage(jobId, work, item, jlog)
  } else if (jobType === 'test-suite-run') {
    // ── Single-shot: orchestrate test suite phases ──
    await processTestSuiteRunStage(jobId, work, item, jlog)
  } else if (jobType === 'gallery-discovery') {
    // ── Per-channel: discover gallery posts from one channel ──
    await processGalleryDiscoveryItem(jobId, work, item, jlog)
  } else if (jobType === 'gallery-crawl') {
    // ── Per-URL: crawl one gallery post ──
    await processGalleryCrawlItem(jobId, work, item, jlog)
  } else if (jobType === 'gallery-processing') {
    // ── Per-gallery: process one gallery processing stage ──
    await processGalleryProcessingStage(jobId, work, item, jlog)
  } else {
    log.error('Unknown job type for work item', { jobType, itemKey: item.item_key, stageName: item.stage_name })
    await client.workItems.complete({ workItemId: item.id, success: false, error: `Unknown job type: ${jobType}` })
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
    log: jlog,
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

  // If this was the last stage and it succeeded, set video status to 'processed'
  if (success && !nextStage) {
    try {
      await client.update({
        collection: 'videos',
        id: videoId,
        data: { status: 'processed' },
      })
      log.info('Video marked as processed', { videoId })
    } catch (e) {
      log.warn('Failed to mark video as processed', { videoId, error: e instanceof Error ? e.message : String(e) })
    }
  }

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


/**
 * Process a single gallery-processing stage (multi-stage pipeline).
 */
async function processGalleryProcessingStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const galleryId = parseInt(item.item_key, 10)
  const stageName = item.stage_name as GalleryStageName

  const enabledStages = getEnabledGalleryStages(work) as Set<GalleryStageName>

  const stageDef = GALLERY_STAGES.find((s) => s.name === stageName)
  if (!stageDef) {
    await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error: `Unknown gallery stage: ${stageName}`,
    })
    return
  }

  const stageConfig: GalleryStageConfig = {
    jobId,
    minBoxArea: ((work.minBoxArea as number) ?? 25) / 100,
    detectionThreshold: (work.detectionThreshold as number) ?? 0.3,
    detectionPrompt: (work.detectionPrompt as string) ?? 'cosmetics packaging.',
    searchThreshold: (work.searchThreshold as number) ?? 0.8,
    searchLimit: (work.searchLimit as number) ?? 3,
  }

  const stageCtx: GalleryStageContext = {
    payload: client,
    config: stageConfig,
    log: jlog,
    heartbeat: async () => {
      await heartbeat(jobId, 'gallery-processing')
      await client.workItems.heartbeat([item.id]).catch(() => {})
    },
  }

  const itemLabel = `gallery #${galleryId}`
  log.banner(`STAGE: ${stageName} — ${itemLabel}`, { galleryId })
  jlog.event('stage.started', { pipeline: 'gallery-processing', stage: stageName, item: String(galleryId) })

  const stageStartMs = Date.now()
  let success = false
  let error: string | undefined
  let tokens = 0
  let tokensRecognition = 0
  let tokensSentiment = 0

  try {
    const result = await stageDef.execute(stageCtx, galleryId)
    success = result.success
    error = result.error
    tokens = result.tokens?.total ?? 0
    tokensRecognition = result.tokens?.recognition ?? 0
    tokensSentiment = result.tokens?.sentiment ?? 0

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`STAGE: ${stageName} — ${itemLabel}`, success, { duration: `${(durationMs / 1000).toFixed(1)}s`, tokens })
    jlog.event('stage.completed', { pipeline: 'gallery-processing', stage: stageName, item: String(galleryId), durationMs, tokens })
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`STAGE: ${stageName} — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'gallery-processing', stage: stageName, item: String(galleryId), durationMs, error })
  }

  // Determine next stage (only on success)
  const nextStage = success ? getNextGalleryStage(stageName, enabledStages) : null

  // If this was the last stage and it succeeded, set gallery status to 'processed'
  if (success && !nextStage) {
    try {
      await client.update({
        collection: 'galleries',
        id: galleryId,
        data: { status: 'processed' },
      })
      log.info('Gallery marked as processed', { galleryId })
    } catch (e) {
      log.warn('Failed to update gallery status', { galleryId, error: e instanceof Error ? e.message : String(e) })
    }
  }

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
      tokensSentiment,
    },
  })
}


/**
 * Process a single product-crawl work item (per-URL, multi-stage pipeline).
 * Each work item represents one source URL at one stage (scrape or reviews).
 */
async function processProductCrawlStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const sourceUrl = item.item_key
  const stageName = item.stage_name as CrawlStageName
  const crawlVariants = work.crawlVariants !== false
  const debug = (work.debug as boolean) ?? false
  const enabledStages = getEnabledCrawlStages(work)
  const reviewsEnabled = enabledStages.has('reviews')

  const itemLabel = sourceUrl.length > 60 ? `…${sourceUrl.slice(-57)}` : sourceUrl
  log.banner(`CRAWL: ${stageName} — ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'product-crawl', stage: stageName, item: sourceUrl })

  const stageStartMs = Date.now()

  if (stageName === 'scrape') {
    // ─── Scrape stage: scrape one URL, persist, spawn variants ───
    // Detect source from URL — job.source may be 'all' for multi-source crawls
    const jobSource = work.source as string | undefined
    const source = (jobSource && jobSource !== 'all' ? jobSource : null)
      ?? getSourceSlugFromUrl(sourceUrl)
      ?? 'unknown'
    const driver = getSourceDriverBySlug(source)

    if (!driver) {
      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`CRAWL: ${stageName} — ${itemLabel}`, false, { error: 'no driver' })
      jlog.event('stage.failed', { pipeline: 'product-crawl', stage: stageName, item: sourceUrl, durationMs, error: `No driver for source: ${source}` })
      await client.workItems.complete({
        workItemId: item.id,
        success: false,
        error: `No driver for source: ${source}`,
        counterUpdates: { errors: 1 },
      })
      return
    }

    let data: ScrapedProductData | null = null
    let scrapeError: string | undefined
    let scrapeScreenshotUrl: string | undefined

    try {
      data = await driver.scrapeProduct(sourceUrl, {
        debug,
        logger: jlog,
        skipReviews: reviewsEnabled, // skip inline reviews when reviews stage handles them
        debugContext: { client, jobCollection: 'product-crawls' as const, jobId },
      })
      if (!data) scrapeError = 'scrapeProduct returned null'
    } catch (e) {
      scrapeError = e instanceof Error ? e.message : String(e)
      scrapeScreenshotUrl = (e as any)?.screenshotUrl as string | undefined
      log.error('Scrape error', { sourceUrl, error: scrapeError, screenshotUrl: scrapeScreenshotUrl })
    }

    if (!data || scrapeError) {
      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`CRAWL: ${stageName} — ${itemLabel}`, false, { error: (scrapeError ?? 'null').slice(0, 80) })
      jlog.event('stage.failed', { pipeline: 'product-crawl', stage: stageName, item: sourceUrl, durationMs, error: scrapeError ?? 'null result', screenshotUrl: scrapeScreenshotUrl })
      await client.workItems.complete({
        workItemId: item.id,
        success: false,
        error: scrapeError ?? 'scrapeProduct returned null',
        counterUpdates: { errors: 1 },
      })
      return
    }

    // Look up existing source-product by URL (may be null for new URLs)
    let sourceProductId: number | undefined
    const productUrl = normalizeProductUrl(sourceUrl)
    const existingProduct = await client.find({
      collection: 'source-products',
      where: { sourceUrl: { equals: productUrl } },
      limit: 1,
    })
    if (existingProduct.docs.length > 0) {
      sourceProductId = (existingProduct.docs[0] as Record<string, unknown>).id as number
    }

    // Look up existing source-variant by URL (for variant crawls)
    let sourceVariantId: number | undefined
    const variantUrl = normalizeVariantUrl(sourceUrl)
    if (variantUrl !== productUrl) {
      const existingVariant = await client.find({
        collection: 'source-variants',
        where: { sourceUrl: { equals: variantUrl } },
        limit: 1,
      })
      if (existingVariant.docs.length > 0) {
        sourceVariantId = (existingVariant.docs[0] as Record<string, unknown>).id as number
      }
    }

    // Persist
    const persistResult = await persistCrawlResult(client, {
      crawlId: jobId,
      sourceVariantId,
      sourceProductId,
      sourceUrl,
      source: source as SourceSlug,
      data,
      crawlVariants,
    })

    // Validate
    const validationIssues = validateCrawlResult(data, source)
    if (validationIssues.length > 0) {
      jlog.event('crawl.validation_failed', {
        url: sourceUrl,
        source,
        issues: validationIssues.map(i => `${i.field}: ${i.message}`).join('; '),
        issueCount: validationIssues.length,
      })
    }

    // Collect GTINs for accumulation on the job
    const gtins = new Set<string>()
    if (data.gtin) gtins.add(data.gtin)
    for (const dim of data.variants ?? []) {
      for (const opt of dim.options ?? []) {
        if (opt.gtin) gtins.add(opt.gtin)
      }
    }

    // Append GTINs to job's crawledGtins field
    if (gtins.size > 0) {
      try {
        const job = await client.findByID({ collection: 'product-crawls', id: jobId }) as Record<string, unknown>
        const existingGtins = new Set(((job.crawledGtins as string) ?? '').split('\n').filter(Boolean))
        const newGtins = [...gtins].filter(g => !existingGtins.has(g))
        if (newGtins.length > 0) {
          const updated = [...existingGtins, ...newGtins].join('\n')
          await client.update({ collection: 'product-crawls', id: jobId, data: { crawledGtins: updated } })
        }
      } catch (e) {
        log.warn('Failed to update crawledGtins', { error: e instanceof Error ? e.message : String(e) })
      }
    }

    // Determine next stage
    const nextStage = getNextCrawlStage(stageName, enabledStages)

    // Spawn variant work items if crawlVariants is enabled
    const spawnItems: Array<{ itemKey: string; stageName: string }> = []
    if (crawlVariants && data.variants) {
      for (const dim of data.variants) {
        for (const opt of dim.options ?? []) {
          if (opt.value && opt.value !== sourceUrl) {
            const varUrl = normalizeVariantUrl(opt.value)
            if (varUrl !== productUrl && varUrl !== variantUrl) {
              spawnItems.push({ itemKey: varUrl, stageName: 'scrape' })
            }
          }
        }
      }
    }

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`CRAWL: ${stageName} — ${itemLabel}`, true, {
      duration: `${(durationMs / 1000).toFixed(1)}s`,
      variants: persistResult.newVariants + persistResult.existingVariants,
      spawned: spawnItems.length,
    })
    jlog.event('stage.completed', { pipeline: 'product-crawl', stage: stageName, item: sourceUrl, durationMs, tokens: 0 })

    // Report completion
    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      nextStageName: nextStage?.name ?? null,
      spawnItems: spawnItems.length > 0 ? spawnItems : undefined,
      totalDelta: spawnItems.length > 0 ? spawnItems.length : undefined,
      counterUpdates: { completed: 1 },
      resultData: { gtins: [...gtins], sourceProductId: persistResult.productId },
    })

    // Emit job completion event if this was the last work item
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else jlog.event('job.completed', { collection: 'product-crawls', durationMs })
      jlog.event('crawl.completed', { source, crawled: 1, errors: 0, durationMs })
    }
  } else if (stageName === 'reviews') {
    // ─── Reviews stage: fetch reviews for one source-product ───
    // Look up source-product by URL
    const productUrl = normalizeProductUrl(sourceUrl)
    const existingProduct = await client.find({
      collection: 'source-products',
      where: { sourceUrl: { equals: productUrl } },
      limit: 1,
    })

    if (existingProduct.docs.length === 0) {
      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`CRAWL: ${stageName} — ${itemLabel}`, false, { error: 'source-product not found' })
      jlog.event('stage.failed', { pipeline: 'product-crawl', stage: stageName, item: sourceUrl, durationMs, error: 'Source product not found' })
      await client.workItems.complete({
        workItemId: item.id,
        success: false,
        error: `Source product not found for URL: ${productUrl}`,
        counterUpdates: { errors: 1 },
      })
      return
    }

    const sourceProduct = existingProduct.docs[0] as Record<string, unknown>
    const sourceProductId = sourceProduct.id as number
    const source = (sourceProduct.source as string) ?? (work.source as string) ?? 'unknown'

    const reviewResult = await executeReviewStage(client, {
      sourceProductId,
      source: source as SourceSlug,
    } as ReviewWorkItem, jlog)

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`CRAWL: ${stageName} — ${itemLabel}`, reviewResult.success, {
      duration: `${(durationMs / 1000).toFixed(1)}s`,
      fetched: reviewResult.reviewsFetched,
      created: reviewResult.reviewsCreated,
    })
    jlog.event('stage.completed', { pipeline: 'product-crawl', stage: stageName, item: sourceUrl, durationMs, tokens: 0 })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: reviewResult.success,
      error: reviewResult.error,
      counterUpdates: reviewResult.success ? {} : { errors: 1 },
    })

    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else jlog.event('job.completed', { collection: 'product-crawls', durationMs })
      jlog.event('crawl.completed', { source, crawled: 0, errors: 0, durationMs })
    }
  } else {
    // Unknown stage
    await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error: `Unknown crawl stage: ${stageName}`,
    })
  }
}

/**
 * Process a single video-crawl work item (per-URL, multi-stage pipeline).
 */
async function processVideoCrawlStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const externalUrl = item.item_key
  const stageName = item.stage_name as VideoCrawlStageName
  const enabledStages = getEnabledVideoCrawlStages(work)

  const stageExecutors: Record<VideoCrawlStageName, (ctx: VideoCrawlStageContext, item: VideoCrawlWorkItem) => Promise<{ success: boolean; error?: string; videoId?: number }>> = {
    metadata: executeMetadata,
    download: executeDownload,
    audio: executeAudio,
  }

  const executor = stageExecutors[stageName]
  if (!executor) {
    await client.workItems.complete({ workItemId: item.id, success: false, error: `Unknown stage: ${stageName}`, counterUpdates: { errors: 1 } })
    return
  }

  // Look up existing video record by externalUrl
  let videoId: number | undefined
  const existingVideo = await client.find({ collection: 'videos', where: { externalUrl: { equals: externalUrl } }, limit: 1 })
  if (existingVideo.docs.length > 0) {
    videoId = (existingVideo.docs[0] as Record<string, unknown>).id as number
  }

  const title = videoId
    ? ((existingVideo.docs[0] as Record<string, unknown>).title as string) ?? externalUrl
    : externalUrl
  const itemLabel = title.length > 50 ? `${title.slice(0, 47)}...` : title

  log.banner(`STAGE: ${stageName} — ${itemLabel}`, { videoId: videoId ?? 'new' })
  jlog.event('stage.started', { pipeline: 'video-crawl', stage: stageName, item: title })

  const stageCtx: VideoCrawlStageContext = {
    payload: client,
    config: { jobId },
    log: jlog,
    uploadMedia,
    heartbeat: async () => {
      await heartbeat(jobId, 'video-crawl')
      await client.workItems.heartbeat([item.id]).catch(() => {})
    },
  }

  const workItem: VideoCrawlWorkItem = { videoId, externalUrl, title }
  const stageStartMs = Date.now()

  try {
    const result = await executor(stageCtx, workItem)
    const durationMs = Date.now() - stageStartMs

    log.bannerEnd(`STAGE: ${stageName} — ${itemLabel}`, result.success, { duration: `${(durationMs / 1000).toFixed(1)}s` })
    jlog.event('stage.completed', { pipeline: 'video-crawl', stage: stageName, item: title, durationMs, tokens: 0 })

    const nextStage = result.success ? getNextVideoCrawlStage(stageName, enabledStages) : null

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: result.success,
      error: result.error,
      nextStageName: nextStage?.name ?? null,
      counterUpdates: result.success ? { completed: 1 } : { errors: 1 },
      resultData: result.videoId ? { videoId: result.videoId } : undefined,
    })

    // Accumulate crawled URL on job
    if (result.success && stageName === 'audio') {
      try {
        const job = await client.findByID({ collection: 'video-crawls', id: jobId }) as Record<string, unknown>
        const existing = ((job.crawledVideoUrls as string) ?? '').split('\n').filter(Boolean)
        if (!existing.includes(externalUrl)) {
          await client.update({ collection: 'video-crawls', id: jobId, data: { crawledVideoUrls: [...existing, externalUrl].join('\n') } })
        }
      } catch { /* non-critical */ }
    }

    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else jlog.event('job.completed', { collection: 'video-crawls', durationMs })
      jlog.event('video_crawl.completed', { crawled: 1, errors: 0, durationMs })
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`STAGE: ${stageName} — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'video-crawl', stage: stageName, item: title, durationMs, error })

    await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
      counterUpdates: { errors: 1 },
    })
  }
}

/**
 * Process a single product-aggregation work item (per-GTIN-group, multi-stage pipeline).
 */
async function processProductAggregationStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const progressKey = item.item_key // sorted comma-separated GTINs
  const gtins = progressKey.split(',')
  const stageName = item.stage_name as AggregationStageName
  const enabledStages = getEnabledAggregationStages(work) as Set<AggregationStageName>

  const stageDef = AGGREGATION_STAGES.find((s) => s.name === stageName)
  if (!stageDef) {
    await client.workItems.complete({ workItemId: item.id, success: false, error: `Unknown stage: ${stageName}`, counterUpdates: { errors: 1 } })
    return
  }

  const itemLabel = progressKey.length > 40 ? `${progressKey.slice(0, 37)}...` : progressKey
  log.banner(`STAGE: ${stageName} — GTINs: ${itemLabel}`, { jobId })
  jlog.event('stage.started', { pipeline: 'product-aggregation', stage: stageName, item: progressKey })

  // Build AggregationWorkItem from GTINs
  // Look up product ID from previous stage result if available
  let productId: number | null = null

  // For stages after resolve, we need the product ID. Try to find it from existing products.
  if (stageName !== 'resolve') {
    // Look up product-variant by first GTIN to find the product
    const pv = await client.find({ collection: 'product-variants', where: { gtin: { equals: gtins[0] } }, limit: 1 })
    if (pv.docs.length > 0) {
      const pvDoc = pv.docs[0] as Record<string, unknown>
      const productRef = pvDoc.product as number | Record<string, unknown>
      productId = typeof productRef === 'number' ? productRef : (productRef as Record<string, unknown>).id as number
    }
  }

  // Build per-GTIN sources (same as findSourcesByGtin pattern)
  const variants: Array<{ gtin: string; sources: Array<Record<string, unknown>> }> = []
  for (const gtin of gtins) {
    const svResult = await client.find({ collection: 'source-variants', where: { gtin: { equals: gtin } }, limit: 100 })
    const sources: Array<Record<string, unknown>> = []

    const variantsBySpId = new Map<number, Record<string, unknown>>()
    for (const v of svResult.docs) {
      const sv = v as Record<string, unknown>
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      const spId = typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
      variantsBySpId.set(spId, sv)
    }

    if (variantsBySpId.size > 0) {
      const spIds = [...variantsBySpId.keys()]
      const spResult = await client.find({ collection: 'source-products', where: { id: { in: spIds.join(',') } }, limit: 100, depth: 1 })

      for (const sp of spResult.docs as Record<string, unknown>[]) {
        const sv = variantsBySpId.get(sp.id as number)!
        sources.push({
          sourceProductId: sp.id,
          sourceVariantId: sv.id,
          name: (sp.name as string) ?? null,
          brandName: (sp.sourceBrand as { name?: string } | null)?.name ?? null,
          source: (sp.source as string) ?? null,
          sourceBrandId: (sp.sourceBrand as { id?: number } | null)?.id ?? null,
          sourceBrandImageUrl: (sp.sourceBrand as { imageUrl?: string } | null)?.imageUrl ?? null,
          ingredientsText: (sv.ingredientsText as string) ?? null,
          description: (sv.description as string) ?? null,
          images: sv.images
            ? (sv.images as Array<{ url?: string; alt?: string | null }>).filter((img) => !!img.url).map((img) => ({ url: img.url!, alt: img.alt ?? null }))
            : null,
          labels: sv.labels
            ? (sv.labels as Array<{ label?: string }>).filter((l) => !!l.label).map((l) => ({ label: l.label! }))
            : null,
          amount: (sv.amount as number) ?? null,
          amountUnit: (sv.amountUnit as string) ?? null,
          variantLabel: (sv.variantLabel as string) ?? null,
          variantDimension: (sv.variantDimension as string) ?? null,
        })
      }
    }

    variants.push({ gtin, sources: sources as any })
  }

  const aggregationWorkItem: AggregationWorkItem = {
    productId,
    gtins,
    variants: variants as any,
  }

  const stageConfig: AggregationStageConfig = {
    jobId,
    language: (work.language as string) ?? 'de',
    imageSourcePriority: (work.imageSourcePriority as string[]) ?? DEFAULT_IMAGE_SOURCE_PRIORITY,
    brandSourcePriority: (work.brandSourcePriority as string[]) ?? DEFAULT_BRAND_SOURCE_PRIORITY,
    detectionThreshold: (work.detectionThreshold as number) ?? 0.7,
    detectionPrompt: (work.detectionPrompt as string) ?? 'cosmetics packaging.',
    minBoxArea: ((work.minBoxArea as number) ?? 5) / 100,
    fallbackDetectionThreshold: (work.fallbackDetectionThreshold as boolean) ?? true,
  }

  const stageCtx: AggregationStageContext = {
    payload: client,
    config: stageConfig,
    log: jlog,
    uploadMedia,
    heartbeat: async () => {
      await heartbeat(jobId, 'product-aggregation')
      await client.workItems.heartbeat([item.id]).catch(() => {})
    },
  }

  const stageStartMs = Date.now()

  try {
    const result = await stageDef.execute(stageCtx, aggregationWorkItem)
    const durationMs = Date.now() - stageStartMs
    const tokens = result.tokensUsed ?? 0

    log.bannerEnd(`STAGE: ${stageName} — GTINs: ${itemLabel}`, result.success, { duration: `${(durationMs / 1000).toFixed(1)}s`, tokens })
    jlog.event('stage.completed', { pipeline: 'product-aggregation', stage: stageName, item: progressKey, durationMs, tokens })

    const nextStage = result.success ? getNextAggregationStage(stageName, enabledStages) : null

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: result.success,
      error: result.error,
      nextStageName: nextStage?.name ?? null,
      counterUpdates: {
        ...(result.success ? { completed: 1 } : { errors: 1 }),
        tokensUsed: tokens,
      },
      resultData: { productId: result.productId ?? productId },
    })

    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else jlog.event('job.completed', { collection: 'product-aggregations', durationMs })
      jlog.event('aggregation.completed', { aggregated: 1, errors: 0, durationMs, tokensUsed: tokens, failedProducts: 0 })
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`STAGE: ${stageName} — GTINs: ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'product-aggregation', stage: stageName, item: progressKey, durationMs, error })

    await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
      counterUpdates: { errors: 1 },
    })
  }
}

/**
 * Process a single ingredient-crawl work item (per-ingredient, single stage).
 */
async function processIngredientCrawlStage(
  jobId: number,
  _work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const ingredientId = parseInt(item.item_key, 10)

  // Look up ingredient name
  const ingredient = await client.findByID({ collection: 'ingredients', id: ingredientId }) as Record<string, unknown>
  const ingredientName = (ingredient.name as string) ?? ''
  const hasImage = !!(ingredient.image as unknown)

  const itemLabel = ingredientName.length > 50 ? `${ingredientName.slice(0, 47)}...` : ingredientName
  log.banner(`CRAWL: ingredient — ${itemLabel}`, { ingredientId })
  jlog.event('stage.started', { pipeline: 'ingredient-crawl', stage: 'crawl', item: ingredientName })

  const stageStartMs = Date.now()

  try {
    // Build URL from ingredient name
    const slug = ingredientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    const url = `https://incidecoder.com/ingredients/${slug}`

    // Fetch page
    const response = await stealthFetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        // Expected — most CosIng ingredients don't have an INCIDecoder page
        jlog.event('ingredient_crawl.not_found', { ingredient: ingredientName })
        await client.update({ collection: 'ingredients', id: ingredientId, data: { status: 'crawled', crawledAt: new Date().toISOString() } })
        const durationMs = Date.now() - stageStartMs
        log.bannerEnd(`CRAWL: ingredient — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, result: '404' })
        jlog.event('stage.completed', { pipeline: 'ingredient-crawl', stage: 'crawl', item: ingredientName, durationMs, tokens: 0 })
        await client.workItems.complete({ workItemId: item.id, success: true, counterUpdates: { completed: 1 } })
        return
      }
      throw new Error(`HTTP ${response.status} from ${url}`)
    }

    const html = await response.text()

    // Extract description
    const stripHtml = (raw: string): string =>
      raw
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&micro;/g, '\u00B5').replace(/&nbsp;/g, ' ')
        .replace(/\[more\]/g, '').replace(/\[less\]/g, '')
        .replace(/\r\n/g, '\n').replace(/(?:\s*\n){3,}/g, '\n\n')
        .trim()

    let longDescription = ''

    const detailsMatch = html.match(/id="(?:showmore-section-)?details"[^>]*>[\s\S]*?<div class="content">([\s\S]*?)<\/div>\s*<div class="showmore-link/i)
      || html.match(/id="details"[^>]*>([\s\S]*?)(?:<div[^>]*class="[^"]*paddingt45[^"]*bold|<\/div>\s*<\/div>\s*$)/i)
    if (detailsMatch) longDescription = stripHtml(detailsMatch[1])

    if (!longDescription) {
      const geekyMatch = html.match(/id="geeky[^"]*"[^>]*>([\s\S]*?)(?:<h2|<div[^>]*class="[^"]*showmore-section)/i)
        || html.match(/Geeky\s*Details<\/h2>([\s\S]*?)(?:<h2|<div[^>]*class="[^"]*showmore-section)/i)
      if (geekyMatch) longDescription = stripHtml(geekyMatch[1])
    }

    if (!longDescription) {
      const quickFactsMatch = html.match(/Quick\s*Facts<\/h2>([\s\S]*?)(?:<h2|<div[^>]*class="[^"]*showmore-section)/i)
      if (quickFactsMatch) longDescription = stripHtml(quickFactsMatch[1])
    }

    if (!longDescription) {
      jlog.event('ingredient_crawl.no_description', { ingredient: ingredientName })
      await client.update({ collection: 'ingredients', id: ingredientId, data: { status: 'crawled', crawledAt: new Date().toISOString() } })
      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`CRAWL: ingredient — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, result: 'no description' })
      jlog.event('stage.completed', { pipeline: 'ingredient-crawl', stage: 'crawl', item: ingredientName, durationMs, tokens: 0 })
      await client.workItems.complete({ workItemId: item.id, success: true, counterUpdates: { completed: 1 } })
      return
    }

    // Extract and upload image if missing
    let imageMediaId: number | undefined
    if (!hasImage) {
      const imgMatch = html.match(/<div class="imgcontainer[^"]*"[\s\S]*?<img\s[^>]*src="([^"]+_original\.[^"]+)"/)
        || html.match(/<div class="imgcontainer[^"]*"[\s\S]*?<img\s[^>]*src="([^"]+)"/)
      if (imgMatch) {
        try {
          const imgRes = await stealthFetch(imgMatch[1])
          if (imgRes.ok) {
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
            const buffer = Buffer.from(await imgRes.arrayBuffer())
            const filename = new URL(imgMatch[1]).pathname.split('/').pop() || `${slug}.jpg`
            const mediaDoc = await client.create({
              collection: 'ingredient-media',
              data: { alt: ingredientName },
              file: { data: buffer, mimetype: contentType, name: filename, size: buffer.length },
            })
            imageMediaId = (mediaDoc as { id: number }).id
          }
        } catch { /* non-critical */ }
      }
    }

    // Generate short description via LLM
    let shortDescription = ''
    let tokensUsed = 0
    if (process.env.OPENAI_API_KEY) {
      try {
        const { getOpenAI } = await import('@/lib/openai')
        const openai = getOpenAI()
        const llmResponse = await openai.chat.completions.create({
          model: 'gpt-4.1-mini',
          temperature: 0.7,
          messages: [
            { role: 'system', content: 'You are a skincare ingredient expert who writes short, precise but entertaining descriptions of cosmetic ingredients. Write 1-2 sentences max. Be factual and informative but make it engaging and easy to understand for consumers. No fluff, no filler words. Do not start with the ingredient name.' },
            { role: 'user', content: `Write a short description for the ingredient "${ingredientName}" based on this detailed information:\n\n${longDescription.substring(0, 3000)}` },
          ],
        })
        shortDescription = llmResponse.choices[0]?.message?.content?.trim() || ''
        tokensUsed = llmResponse.usage?.total_tokens || 0
      } catch { /* continue without short description */ }
    }

    // Persist result via submitWork pattern (update ingredient record)
    const updateData: Record<string, unknown> = { longDescription, status: 'crawled', crawledAt: new Date().toISOString() }
    if (shortDescription) updateData.shortDescription = shortDescription
    if (imageMediaId) updateData.image = imageMediaId

    // Add INCIDecoder source entry
    const existingSources = (ingredient.sources as Array<{ source?: string }>) ?? []
    const hasInciDecoder = existingSources.some((s) => s.source === 'incidecoder')
    if (!hasInciDecoder) {
      const fieldsProvided: string[] = ['longDescription']
      if (shortDescription) fieldsProvided.push('shortDescription')
      if (imageMediaId) fieldsProvided.push('image')
      updateData.sources = [...existingSources, { source: 'incidecoder', sourceUrl: url, fieldsProvided }]
    }

    await client.update({ collection: 'ingredients', id: ingredientId, data: updateData })

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`CRAWL: ingredient — ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, tokens: tokensUsed })
    jlog.event('stage.completed', { pipeline: 'ingredient-crawl', stage: 'crawl', item: ingredientName, durationMs, tokens: tokensUsed })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      counterUpdates: { completed: 1, tokensUsed },
    })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else jlog.event('job.completed', { collection: 'ingredient-crawls', durationMs })
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.bannerEnd(`CRAWL: ingredient — ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('stage.failed', { pipeline: 'ingredient-crawl', stage: 'crawl', item: ingredientName, durationMs, error })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
      counterUpdates: { errors: 1 },
    })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'ingredient-crawls', durationMs })
    }
  }
}

/**
 * Process a single product-search work item (one query + one source).
 * item_key format: "query::sourceSlug"
 */
async function processProductSearchStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const separatorIdx = item.item_key.lastIndexOf('::')
  const query = item.item_key.slice(0, separatorIdx)
  const sourceSlug = item.item_key.slice(separatorIdx + 2)

  const maxResults = (work.maxResults as number) ?? 50
  const isGtinSearch = (work.isGtinSearch as boolean) ?? true
  const debug = (work.debug as boolean) ?? false

  const itemLabel = `${query.length > 30 ? query.slice(0, 27) + '...' : query} @ ${sourceSlug}`
  log.banner(`SEARCH: ${itemLabel}`, { jobId })
  jlog.event('search.started', { query, sources: sourceSlug, maxResults })

  const stageStartMs = Date.now()

  try {
    const driver = getSourceDriverBySlug(sourceSlug)
    if (!driver) {
      const error = `No driver for source: ${sourceSlug}`
      log.error('Search driver missing', { jobId, source: sourceSlug })
      jlog.event('search.error', { query, source: sourceSlug, error })
      const durationMs = Date.now() - stageStartMs
      log.bannerEnd(`SEARCH: ${itemLabel}`, false, { error })
      await client.workItems.complete({ workItemId: item.id, success: false, error, counterUpdates: { errors: 1 } })
      return
    }

    log.info('Searching', { jobId, query, source: sourceSlug, maxResults, isGtinSearch })
    const result = await driver.searchProducts({
      query, maxResults, isGtinSearch, debug, logger: jlog,
      debugContext: { client, jobCollection: 'product-searches' as const, jobId },
    })
    const products = result.products

    jlog.event('search.source_complete', { source: sourceSlug, query, results: products.length })
    log.info('Search results', { jobId, query, source: sourceSlug, products: products.length })

    // Append discovered URLs to job's productUrls field
    if (products.length > 0) {
      try {
        const job = await client.findByID({ collection: 'product-searches', id: jobId }) as Record<string, unknown>
        const existing = new Set(((job.productUrls as string) ?? '').split('\n').filter(Boolean))
        const newUrls = products.map(p => p.productUrl).filter(u => !existing.has(u))
        if (newUrls.length > 0) {
          const updated = [...existing, ...newUrls].join('\n')
          await client.update({ collection: 'product-searches', id: jobId, data: { productUrls: updated } })
        }
      } catch (e) {
        log.warn('Failed to update productUrls', { error: e instanceof Error ? e.message : String(e) })
      }
    }

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`SEARCH: ${itemLabel}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, results: products.length })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
      counterUpdates: { completed: products.length },
    })

    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: 'All work items failed' })
      else jlog.event('job.completed', { collection: 'product-searches', durationMs })
      jlog.event('search.completed', { sources: sourceSlug, discovered: products.length, durationMs })
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    const screenshotUrl = (e as any)?.screenshotUrl as string | undefined
    log.error('Search failed', { jobId, query, source: sourceSlug, error, screenshotUrl })
    log.bannerEnd(`SEARCH: ${itemLabel}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('search.error', { query, source: sourceSlug, error, screenshotUrl })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
      counterUpdates: { errors: 1 },
    })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'product-searches', durationMs })
    }
  }
}

// ─── Bot Check ───

async function processBotCheckStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const url = (work.url as string) || 'https://bot-detector.rebrowser.net/'
  log.banner(`BOT CHECK: ${url}`, { jobId })
  jlog.event('bot_check.started', { url })

  const stageStartMs = Date.now()
  try {
    const result = await runBotCheck(url, client, jobId, jlog)

    const durationMs = Date.now() - stageStartMs
    log.bannerEnd(`BOT CHECK: ${url}`, true, { duration: `${(durationMs / 1000).toFixed(1)}s`, passed: result.resultJson.passed, failed: result.resultJson.failed })

    // Extract screenshot ID from the URL (captureDebugScreenshot returns the URL, but we need the ID for the relationship)
    // We'll pass the resultJson and screenshot info via submitWork instead
    await submitWork(client, worker, {
      type: 'bot-check',
      jobId,
      url,
      screenshotId: null, // screenshot is uploaded inside runBotCheck
      resultJson: result.resultJson,
      passed: result.resultJson.passed,
      failed: result.resultJson.failed,
      total: result.resultJson.total,
    })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
    })
    if (done && jobStatus === 'failed') {
      jlog.event('job.failed', { reason: 'Work item failed' })
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.error('Bot check failed', { jobId, url, error })
    log.bannerEnd(`BOT CHECK: ${url}`, false, { duration: `${(durationMs / 1000).toFixed(1)}s`, error: error.slice(0, 80) })
    jlog.event('bot_check.error', { url, error })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
      counterUpdates: { failed: 1 },
    })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'bot-checks', durationMs })
    }
  }
}

// ─── Test Suite Run ───

async function processTestSuiteRunStage(
  jobId: number,
  work: Record<string, unknown>,
  item: { id: number; item_key: string; stage_name: string },
  jlog: ReturnType<typeof log.forJob>,
): Promise<void> {
  const stageStartMs = Date.now()
  try {
    const hb = async () => {
      await client.workItems.heartbeat([item.id])
      await client.update({ collection: 'workers', id: worker.id, data: { lastSeenAt: new Date().toISOString() } }).catch(() => {})
    }

    await handleTestSuiteRun(client, { jobId }, hb)

    const durationMs = Date.now() - stageStartMs
    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: true,
    })
    if (done && jobStatus === 'failed') {
      jlog.event('job.failed', { reason: 'Work item failed' })
    }
  } catch (e) {
    const durationMs = Date.now() - stageStartMs
    const error = e instanceof Error ? e.message : String(e)
    log.error('Test suite run failed', { jobId, error })
    jlog.event('test_suite.error', { error })

    const { done, jobStatus } = await client.workItems.complete({
      workItemId: item.id,
      success: false,
      error,
      counterUpdates: { failed: 1 },
    })
    if (done) {
      if (jobStatus === 'failed') jlog.event('job.failed', { reason: error })
      else jlog.event('job.completed', { collection: 'test-suite-runs', durationMs })
    }
  }
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
            // Mark work item as failed — the complete endpoint handles per-item retry
            await client.workItems.complete({ workItemId: item.id, success: false, error: reason }).catch(() => {})
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
