import type { PayloadRestClient } from '@/lib/payload-client'
import type { AuthenticatedWorker } from './types'
import { findUncrawledProducts, findUncrawledVariants, countUncrawled, resetProducts, normalizeProductUrl, getSourceSlugFromUrl } from '@/lib/source-product-queries'
import type { SourceSlug } from '@/lib/source-product-queries'
import { ALL_SOURCE_SLUGS, DEFAULT_IMAGE_SOURCE_PRIORITY, DEFAULT_BRAND_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { createLogger } from '@/lib/logger'
import type { AggregationSource } from '@/lib/aggregate-product'
import {
  getNextStage,
  getEnabledStages,
  getVideoProgress,
  videoNeedsWork,
  type StageName,
} from '@/lib/video-processing/stages'
import {
  getNextStage as getNextAggregationStage,
  getEnabledStages as getEnabledAggregationStages,
  getAggregationProgress,
  productNeedsWork,
  type StageName as AggregationStageName,
  type AggregationWorkItem,
} from '@/lib/product-aggregation/stages'
import {
  getEnabledCrawlStages,
  getCrawlProgress,
  type CrawlStageName,
} from '@/lib/product-crawl/stages'
import {
  getNextVideoCrawlStage,
  getEnabledVideoCrawlStages,
  getVideoCrawlProgress,
  videoNeedsCrawlWork,
  getVideoCrawlProgressKey,
  type VideoCrawlStageName,
} from '@/lib/video-crawl/stages'

export type JobType = 'product-crawl' | 'product-discovery' | 'product-search' | 'ingredients-discovery' | 'video-discovery' | 'video-crawl' | 'video-processing' | 'product-aggregation' | 'ingredient-crawl' | 'bot-check' | 'test-suite-run'

interface ActiveJob {
  type: JobType
  id: number
  status: string
  crawlType?: string
  aggregationType?: string
}

export const JOB_TYPE_TO_COLLECTION = {
  'product-crawl': 'product-crawls',
  'product-discovery': 'product-discoveries',
  'product-search': 'product-searches',
  'ingredients-discovery': 'ingredients-discoveries',
  'video-discovery': 'video-discoveries',
  'video-crawl': 'video-crawls',
  'video-processing': 'video-processings',
  'product-aggregation': 'product-aggregations',
  'ingredient-crawl': 'ingredient-crawls',
  'bot-check': 'bot-checks',
  'test-suite-run': 'test-suite-runs',
} as const

const JOB_TYPE_TO_CAPABILITY = {
  'product-crawl': 'product-crawl',
  'product-discovery': 'product-discovery',
  'product-search': 'product-search',
  'ingredients-discovery': 'ingredients-discovery',
  'video-discovery': 'video-discovery',
  'video-crawl': 'video-crawl',
  'video-processing': 'video-processing',
  'product-aggregation': 'product-aggregation',
  'ingredient-crawl': 'ingredient-crawl',
  'bot-check': 'bot-check',
  'test-suite-run': 'test-suite-run',
} as const

const log = createLogger('Claim')

/**
 * Re-build work for an already-claimed job. Used by the main loop to
 * continue processing the same job without releasing and re-claiming.
 * Returns { type: 'none' } when the job has no more work (already completed).
 */
export async function rebuildJobWork(
  payload: PayloadRestClient,
  jobType: JobType,
  jobId: number,
): Promise<Record<string, unknown>> {
  const collection = JOB_TYPE_TO_COLLECTION[jobType]
  const job = await payload.findByID({ collection, id: jobId }) as Record<string, unknown>
  if (job.status === 'completed' || job.status === 'failed') {
    return { type: 'none' }
  }

  switch (jobType) {
    case 'product-crawl': return buildProductCrawlWork(payload, jobId)
    case 'product-discovery': return buildProductDiscoveryWork(payload, jobId)
    case 'product-search': return buildProductSearchWork(payload, jobId)
    case 'ingredients-discovery': return { type: 'none' } // handled by work-items system
    case 'video-discovery': return buildVideoDiscoveryWork(payload, jobId)
    case 'video-crawl': return buildVideoCrawlWork(payload, jobId)
    case 'video-processing': return buildVideoProcessingWork(payload, jobId)
    case 'product-aggregation': return buildProductAggregationWork(payload, jobId)
    case 'ingredient-crawl': return buildIngredientCrawlWork(payload, jobId)
    case 'bot-check': return buildBotCheckWork(payload, jobId)
    case 'test-suite-run': return buildTestSuiteRunWork(payload, jobId)
    default: return { type: 'none' }
  }
}

export async function claimWork(
  payload: PayloadRestClient,
  worker: AuthenticatedWorker,
  jobTimeoutMinutes = 30,
  excludeTypes?: Set<string>,
): Promise<Record<string, unknown>> {
  log.debug('Claim: searching for work', { worker: worker.name, capabilities: worker.capabilities.join(', '), timeoutMinutes: jobTimeoutMinutes })

  const staleThreshold = new Date(Date.now() - jobTimeoutMinutes * 60 * 1000).toISOString()

  // Find claimable jobs: pending, or in_progress with stale/missing claimedAt
  const activeJobs: ActiveJob[] = []

  const queries: Promise<void>[] = []

  for (const [jobType, collection] of Object.entries(JOB_TYPE_TO_COLLECTION)) {
    if (excludeTypes?.has(jobType)) continue
    const capability = JOB_TYPE_TO_CAPABILITY[jobType as JobType]
    if (!worker.capabilities.includes(capability)) continue

    queries.push(
      (async () => {
        const [unclaimedInProgress, staleInProgress, pending] = await Promise.all([
          // In-progress jobs released between batches (claimedBy is null)
          payload.find({
            collection,
            where: {
              and: [
                { status: { equals: 'in_progress' } },
                { claimedBy: { exists: false } },
              ],
            },
            limit: 10,
          }),
          // In-progress jobs with stale claimedAt (abandoned by crashed workers)
          payload.find({
            collection,
            where: {
              and: [
                { status: { equals: 'in_progress' } },
                { claimedBy: { exists: true } },
                { claimedAt: { less_than: staleThreshold } },
              ],
            },
            limit: 10,
          }),
          payload.find({ collection, where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
        ])

        if (unclaimedInProgress.totalDocs > 0 || staleInProgress.totalDocs > 0 || pending.totalDocs > 0) {
          log.debug('Claim: found claimable jobs', { jobType, unclaimed: unclaimedInProgress.totalDocs, stale: staleInProgress.totalDocs, pending: pending.totalDocs })
        }

        const seen = new Set<number>()
        for (const doc of [...unclaimedInProgress.docs, ...staleInProgress.docs, ...pending.docs]) {
          const d = doc as Record<string, unknown>
          const id = d.id as number
          if (seen.has(id)) continue
          seen.add(id)
          const docType = d.type as string | undefined
          activeJobs.push({
            type: jobType as JobType,
            id,
            status: d.status as string,
            crawlType: docType,
            aggregationType: jobType === 'product-aggregation' ? docType : undefined,
          })
        }
      })(),
    )
  }

  await Promise.all(queries)

  if (activeJobs.length === 0) {
    log.debug('No claimable jobs found')
    return { type: 'none' }
  }

  // Prioritize: selected crawls/aggregations first, otherwise random
  const selectedTargetJobs = activeJobs.filter(
    (j) => (j.type === 'product-crawl' &&
           (j.crawlType === 'selected_urls' || j.crawlType === 'from_discovery' || j.crawlType === 'from_search')) ||
           (j.type === 'product-aggregation' && j.aggregationType === 'selected_gtins'),
  )

  // Build a priority-ordered list: selected targets first, then rest shuffled
  const candidates = selectedTargetJobs.length > 0
    ? [...selectedTargetJobs, ...activeJobs.filter((j) => !selectedTargetJobs.includes(j))]
    : activeJobs.sort(() => Math.random() - 0.5)

  // Try to claim jobs in order until one succeeds
  const claimHeaders = { 'X-Job-Timeout-Minutes': String(jobTimeoutMinutes) }

  for (const candidate of candidates) {
    const collection = JOB_TYPE_TO_COLLECTION[candidate.type]
    try {
      await payload.update({
        collection,
        id: candidate.id,
        data: {
          claimedBy: worker.id,
          claimedAt: new Date().toISOString(),
        },
        headers: claimHeaders,
      })

      log.info('Claimed job', { jobType: candidate.type, jobId: candidate.id, status: candidate.status })

      // Build work unit based on job type
      switch (candidate.type) {
        case 'product-crawl':
          return buildProductCrawlWork(payload, candidate.id)
        case 'product-discovery':
          return buildProductDiscoveryWork(payload, candidate.id)
        case 'product-search':
          return buildProductSearchWork(payload, candidate.id)
        case 'ingredients-discovery':
          return { type: 'none' } // handled by work-items system
        case 'video-discovery':
          return buildVideoDiscoveryWork(payload, candidate.id)
        case 'video-crawl':
          return buildVideoCrawlWork(payload, candidate.id)
        case 'video-processing':
          return buildVideoProcessingWork(payload, candidate.id)
        case 'product-aggregation':
          return buildProductAggregationWork(payload, candidate.id)
        case 'ingredient-crawl':
          return buildIngredientCrawlWork(payload, candidate.id)
        case 'bot-check':
          return buildBotCheckWork(payload, candidate.id)
        case 'test-suite-run':
          return buildTestSuiteRunWork(payload, candidate.id)
        default:
          return { type: 'none' }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      log.debug('Claim: failed to claim job', { jobType: candidate.type, jobId: candidate.id, error: msg })
      // Try next candidate
    }
  }

  log.debug('All candidates already claimed by other workers')
  return { type: 'none' }
}

async function buildProductCrawlWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-crawls', jobId)
  jlog.info('Building product crawl work', { jobId })
  const job = await payload.findByID({ collection: 'product-crawls', id: jobId }) as Record<string, unknown>
  jlog.info('Product crawl job loaded', { jobId, type: job.type as string, source: job.source as string, status: job.status as string })

  // Determine source drivers
  const sources: string[] = job.source === 'all' ? [...ALL_SOURCE_SLUGS] : [job.source as string]

  // Build URL list based on type — these are product-level URLs
  let sourceUrls: string[] | undefined
  if (job.type === 'selected_urls') {
    sourceUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => normalizeProductUrl(u.trim())).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId }) as Record<string, unknown>
    sourceUrls = ((discovery.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeProductUrl)
  } else if (job.type === 'from_search' && job.search) {
    const searchId = typeof job.search === 'number' ? job.search : (job.search as Record<string, number>).id
    const search = await payload.findByID({ collection: 'product-searches', id: searchId }) as Record<string, unknown>
    sourceUrls = ((search.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeProductUrl)
  }

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const crawlVariants = (job.crawlVariants as boolean) ?? true

  // When crawlVariants=true and we have scoped URLs, resolve to source-product IDs.
  // This ensures sibling variants (with different URLs) are also found and crawled.
  let sourceProductIds: number[] | undefined
  if (crawlVariants && sourceUrls && sourceUrls.length > 0) {
    const spResult = await payload.find({
      collection: 'source-products',
      where: { sourceUrl: { in: sourceUrls.join(',') } },
      limit: 100000,
    })
    sourceProductIds = spResult.docs.map((doc) => (doc as Record<string, unknown>).id as number)
    jlog.info('Resolved URLs to source-product IDs for variant crawl', { jobId, urlCount: sourceUrls.length, sourceProductCount: sourceProductIds.length })
  }

  // Initialize job if pending: create stubs, reset products, count total
  if (job.status === 'pending') {
    jlog.info('Initializing product crawl job', { jobId })

    // Reset matching products so they're eligible for crawling.
    // For 'selected_urls' and 'from_discovery': always reset (these target specific URLs explicitly).
    // For 'all' and 'selected_gtins': only reset when scope='recrawl'.
    const shouldReset = job.type === 'selected_urls' || job.type === 'from_discovery' || job.type === 'from_search' || job.scope === 'recrawl'
    if (shouldReset) {
      let crawledBefore: Date | undefined
      if (job.scope === 'recrawl' && job.minCrawlAge && job.minCrawlAgeUnit) {
        const now = Date.now()
        const ms = (job.minCrawlAge as number) * ((job.minCrawlAgeUnit as string) === 'hours' ? 3600000 : (job.minCrawlAgeUnit as string) === 'days' ? 86400000 : 1)
        crawledBefore = new Date(now - ms)
      }

      jlog.info('Resetting products for recrawl', { jobId, type: job.type as string, scope: job.scope as string, crawledBefore: crawledBefore?.toISOString() ?? 'any' })
      for (const source of sources) {
        await resetProducts(payload, source as SourceSlug, sourceUrls, crawledBefore)
      }
    }

    // Count total: existing uncrawled source-products + new URLs without source-products
    let total = 0
    for (const source of sources) {
      total += await countUncrawled(payload, source as SourceSlug, sourceUrls ? { sourceUrls } : undefined)
    }

    // For URL-scoped jobs, also count URLs that don't have source-products yet
    if (sourceUrls && sourceUrls.length > 0) {
      const existingUrls = new Set<string>()
      if (sourceProductIds && sourceProductIds.length > 0) {
        const spResult = await payload.find({
          collection: 'source-products',
          where: { id: { in: sourceProductIds.join(',') } },
          limit: 100000,
        })
        for (const doc of spResult.docs) {
          existingUrls.add((doc as Record<string, unknown>).sourceUrl as string)
        }
      }
      const newUrlCount = sourceUrls.filter((u) => !existingUrls.has(u)).length
      total += newUrlCount
      if (newUrlCount > 0) {
        jlog.info('Found URLs without source-products (will create during crawl)', { jobId, newUrlCount })
      }
    }

    jlog.info('Counted uncrawled products', { jobId, total })

    await payload.update({
      collection: 'product-crawls',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        total,
        crawled: 0,
        errors: 0,
        crawledGtins: '',
      },
    })

    jlog.event('job.claimed', { collection: 'product-crawls', jobId, total })
  }

  // Build query options for finding work
  const queryOpts = sourceProductIds
    ? { sourceProductIds }
    : sourceUrls ? { sourceUrls } : undefined

  // Find work items: new URLs without source-products, then uncrawled products, then uncrawled variants
  const workItems: Array<{ sourceVariantId?: number; sourceProductId?: number; sourceUrl: string; source: string }> = []

  // Phase 0: For URL-scoped jobs, create work items from URLs that have no source-product yet.
  // These will have sourceProductId=undefined — persistCrawlResult will create the source-product.
  if (sourceUrls && sourceUrls.length > 0) {
    // Collect all existing source-product URLs for this job's scope
    const existingUrlSet = new Set<string>()
    const allSps = await payload.find({
      collection: 'source-products',
      where: { sourceUrl: { in: sourceUrls.join(',') } },
      limit: 100000,
    })
    for (const doc of allSps.docs) {
      existingUrlSet.add((doc as Record<string, unknown>).sourceUrl as string)
    }

    for (const url of sourceUrls) {
      if (workItems.length >= itemsPerTick) break
      if (existingUrlSet.has(url)) continue // has a source-product, will be found in Phase 1/2
      const source = getSourceSlugFromUrl(url)
      if (!source) {
        jlog.warn('Cannot determine source for URL, skipping', { url })
        continue
      }
      if (job.source !== 'all' && source !== job.source) continue // wrong source for this job
      workItems.push({ sourceUrl: url, source })
    }

    if (workItems.length > 0) {
      jlog.info('Created work items from new URLs (no source-product)', { jobId, count: workItems.length })
    }
  }

  for (const source of sources) {
    const remaining = itemsPerTick - workItems.length
    if (remaining <= 0) break

    // Phase 1: Find uncrawled source-products with no variants (first crawl)
    const products = await findUncrawledProducts(payload, source as SourceSlug, {
      ...(queryOpts ?? {}),
      limit: remaining,
    })

    for (const p of products) {
      workItems.push({ sourceProductId: p.sourceProductId, sourceUrl: p.sourceUrl, source })
    }

    // Phase 2: Find uncrawled variants (subsequent crawls, when crawlVariants=true)
    if (crawlVariants && workItems.length < itemsPerTick) {
      const variantRemaining = itemsPerTick - workItems.length
      const variants = await findUncrawledVariants(payload, source as SourceSlug, {
        ...(queryOpts?.sourceProductIds ? { sourceProductIds: queryOpts.sourceProductIds } : {}),
        limit: variantRemaining,
      })

      for (const v of variants) {
        workItems.push({ sourceVariantId: v.sourceVariantId, sourceProductId: v.sourceProductId, sourceUrl: v.sourceUrl, source })
      }
    }

    jlog.info('Found work items', { jobId, source, products: products.length, variants: workItems.length - products.length })
  }

  jlog.info('Prepared work items', { jobId, count: workItems.length })

  const enabledStages = getEnabledCrawlStages(job)
  const scrapeEnabled = enabledStages.has('scrape')
  const reviewsEnabled = enabledStages.has('reviews')

  // If scrape stage has work, return scrape work items
  if (workItems.length > 0 && scrapeEnabled) {
    return {
      type: 'product-crawl',
      jobId,
      stage: 'scrape' as CrawlStageName,
      workItems,
      itemsPerTick: (job.itemsPerTick as number) ?? 10,
      debug: (job.debug as boolean) ?? false,
      crawlVariants: (job.crawlVariants as boolean) ?? true,
      skipReviews: true, // always skip inline reviews — reviews are handled by the standalone reviews stage when enabled
      source: job.source,
      enabledStages: [...enabledStages],
    }
  }

  // Scrape stage exhausted (or disabled). Check if reviews stage has work.
  if (reviewsEnabled) {
    const crawlProgress = getCrawlProgress(job)

    // Find source-products at stage 'scrape' (scraped, not yet reviewed)
    const reviewWorkItems: Array<{ sourceProductId: number; source: string }> = []
    for (const [key, stage] of Object.entries(crawlProgress)) {
      if (key.startsWith('err:') || key.startsWith('pid:')) continue
      if (stage !== 'scrape') continue // only products that completed scrape but not reviews
      const spId = parseInt(key, 10)
      if (isNaN(spId)) continue
      if (reviewWorkItems.length >= itemsPerTick) break

      // Look up source slug from source-product
      const sp = await payload.findByID({ collection: 'source-products', id: spId }) as Record<string, unknown>
      const spSource = sp.source as string
      reviewWorkItems.push({ sourceProductId: spId, source: spSource })
    }

    if (reviewWorkItems.length > 0) {
      jlog.info('Prepared review work items', { jobId, count: reviewWorkItems.length })
      return {
        type: 'product-crawl',
        jobId,
        stage: 'reviews' as CrawlStageName,
        reviewWorkItems,
        itemsPerTick,
        source: job.source,
        enabledStages: [...enabledStages],
      }
    }
  }

  // No work remaining for any stage — mark complete
  jlog.info('No remaining work, completing job', { jobId })
  await payload.update({
    collection: 'product-crawls',
    id: jobId,
    data: {
      status: 'completed',
      completedAt: new Date().toISOString(),
    },
  })
  jlog.event('job.completed_empty', { collection: 'product-crawls', reason: 'No remaining uncrawled products in scope' })
  return { type: 'none' }
}

async function buildProductDiscoveryWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-discoveries', jobId)
  jlog.info('Building product discovery work', { jobId })
  const job = await payload.findByID({ collection: 'product-discoveries', id: jobId }) as Record<string, unknown>

  const sourceUrls = ((job.sourceUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)

  interface ProductDiscoveryJobProgress {
    currentUrlIndex: number
    driverProgress: unknown | null
  }

  const progress = job.progress as ProductDiscoveryJobProgress | null
  const maxPages = (job.itemsPerTick as number) ?? undefined
  const delay = (job.delay as number) ?? 2000

  jlog.info('Product discovery job loaded', { jobId, urlCount: sourceUrls.length, urlIndex: progress?.currentUrlIndex ?? 0, maxPages: maxPages ?? 'unlimited', delay })

  // Initialize job if pending: set in_progress and reset counters
  if (job.status === 'pending') {
    jlog.info('Initializing product discovery job', { jobId })
    await payload.update({
      collection: 'product-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        discovered: 0,
        progress: null,
      },
    })
    jlog.event('job.claimed', { collection: 'product-discoveries', jobId, total: sourceUrls.length })
  }

  return {
    type: 'product-discovery',
    jobId,
    sourceUrls,
    currentUrlIndex: progress?.currentUrlIndex ?? 0,
    driverProgress: progress?.driverProgress ?? null,
    maxPages,
    delay,
    debug: (job.debug as boolean) ?? false,
  }
}

async function buildProductSearchWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-searches', jobId)
  jlog.info('Building product search work', { jobId })
  const job = await payload.findByID({ collection: 'product-searches', id: jobId }) as Record<string, unknown>

  const query = (job.query as string) ?? ''
  const sources = (job.sources as string[]) ?? [...ALL_SOURCE_SLUGS]
  const maxResults = (job.maxResults as number) ?? 50
  const isGtinSearch = (job.isGtinSearch as boolean) ?? true
  const debug = (job.debug as boolean) ?? false

  jlog.info('Product search job loaded', { jobId, query, sources: sources.join(', '), maxResults, isGtinSearch })

  // Initialize job if pending
  if (job.status === 'pending') {
    jlog.info('Initializing product search job', { jobId })

    await payload.update({
      collection: 'product-searches',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        discovered: 0,
        productUrls: '',
      },
    })
    jlog.event('job.claimed', { collection: 'product-searches', jobId })
  }

  return {
    type: 'product-search',
    jobId,
    query,
    sources,
    maxResults,
    isGtinSearch,
    debug,
  }
}

async function buildIngredientsDiscoveryWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('ingredients-discoveries', jobId)
  jlog.info('Building ingredients discovery work', { jobId })
  const job = await payload.findByID({ collection: 'ingredients-discoveries', id: jobId }) as Record<string, unknown>

  // Initialize termQueue: if empty/missing, seed from the driver (handles both fresh pending
  // and jobs auto-seeded by work-items endpoint which sets status to in_progress before we get here)
  let termQueue: string[] = (job.termQueue as string[]) ?? []
  if (termQueue.length === 0 && !(job.currentTerm as string)) {
    const driver = getIngredientsDriver(job.sourceUrl as string)
    termQueue = driver?.getInitialTermQueue() ?? ['*']
    jlog.info('Initializing ingredients discovery job', { jobId, initialTerms: termQueue.length })
    await payload.update({
      collection: 'ingredients-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        discovered: 0,
        created: 0,
        existing: 0,
        errors: 0,
        termQueue,
      },
    })
    jlog.event('job.claimed', { collection: 'ingredients-discoveries', jobId })
  }

  jlog.info('Ingredients discovery job loaded', { jobId, sourceUrl: job.sourceUrl as string, currentTerm: (job.currentTerm as string) ?? 'none', termQueueSize: termQueue.length })

  return {
    type: 'ingredients-discovery',
    jobId,
    sourceUrl: job.sourceUrl,
    currentTerm: (job.currentTerm as string) ?? null,
    currentPage: (job.currentPage as number) ?? 1,
    totalPagesForTerm: (job.totalPagesForTerm as number) ?? 0,
    termQueue,
    pagesPerTick: (job.pagesPerTick as number) ?? 10,
  }
}

async function buildVideoDiscoveryWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('video-discoveries', jobId)
  jlog.info('Building video discovery work', { jobId })
  const job = await payload.findByID({ collection: 'video-discoveries', id: jobId }) as Record<string, unknown>

  const channelUrl = job.channelUrl as string

  interface VideoDiscoveryJobProgress {
    currentOffset: number
  }

  const progress = job.progress as VideoDiscoveryJobProgress | null
  const currentOffset = progress?.currentOffset ?? 0
  const batchSize = (job.itemsPerTick as number) || 50
  const maxVideos = (job.maxVideos as number) ?? undefined
  const dateLimit = (job.dateLimit as string) ?? undefined
  const debugMode = (job.debugMode as boolean) ?? false

  jlog.info('Video discovery job loaded', { jobId, channelUrl, offset: currentOffset, batchSize, maxVideos: maxVideos ?? 'unlimited' })

  // Initialize job if pending: set in_progress and reset counters
  if (job.status === 'pending') {
    jlog.info('Initializing video discovery job', { jobId })
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        discovered: 0,
        videoUrls: '',
        progress: null,
      },
    })
    jlog.event('job.claimed', { collection: 'video-discoveries', jobId })
  }

  return {
    type: 'video-discovery',
    jobId,
    channelUrl,
    currentOffset,
    batchSize,
    maxVideos,
    dateLimit,
    debugMode,
  }
}

async function buildVideoCrawlWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('video-crawls', jobId)
  jlog.info('Building video crawl work', { jobId })
  const job = await payload.findByID({ collection: 'video-crawls', id: jobId }) as Record<string, unknown>

  const itemsPerTick = (job.itemsPerTick as number) ?? 5

  // Build URL list based on type
  let videoUrls: string[] = []
  if (job.type === 'selected_urls') {
    videoUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'video-discoveries', id: discoveryId }) as Record<string, unknown>
    videoUrls = ((discovery.videoUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
  }

  // Initialize job if pending
  if (job.status === 'pending') {
    jlog.info('Initializing video crawl job', { jobId, type: job.type as string })

    let total: number
    if (job.type === 'all') {
      // Count videos with status='discovered' (or all if scope=recrawl)
      const scope = (job.scope as string) ?? 'uncrawled_only'
      const where = scope === 'recrawl'
        ? { externalUrl: { exists: true } }
        : { status: { equals: 'discovered' } }
      const count = await payload.count({ collection: 'videos', where })
      total = count.totalDocs
    } else {
      total = videoUrls.length
    }

    await payload.update({
      collection: 'video-crawls',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        total,
        crawled: 0,
        errors: 0,
        crawledVideoUrls: '',
      },
    })
    jlog.event('job.claimed', { collection: 'video-crawls', jobId, total })
    jlog.event('video_crawl.started', { items: total })
  }

  // Read progress map and enabled stages
  const progress = getVideoCrawlProgress(job)
  const enabledStages = getEnabledVideoCrawlStages(job)

  // Build stage work items
  const stageItems: Array<{
    videoId?: number
    externalUrl: string
    title: string
    stageName: VideoCrawlStageName
  }> = []

  const addStageItem = (videoId: number | undefined, externalUrl: string, title: string) => {
    if (stageItems.length >= itemsPerTick) return
    const progressKey = getVideoCrawlProgressKey(videoId, externalUrl)
    // For URL-keyed items that already got a videoId from a prior metadata run, recover the ID
    let resolvedVideoId = videoId
    if (!resolvedVideoId) {
      const storedId = progress[`vid:${progressKey}`]
      if (storedId && typeof storedId === 'string') {
        resolvedVideoId = parseInt(storedId, 10) || undefined
      }
    }
    const lastCompleted = progress[progressKey] ?? null
    if (!videoNeedsCrawlWork(lastCompleted, enabledStages)) return
    const nextStage = getNextVideoCrawlStage(lastCompleted, enabledStages)
    if (!nextStage) return
    stageItems.push({
      videoId: resolvedVideoId,
      externalUrl,
      title,
      stageName: nextStage.name,
    })
  }

  if (job.type === 'all') {
    // Crawl all discovered videos (or all if recrawl)
    const scope = (job.scope as string) ?? 'uncrawled_only'
    const where = scope === 'recrawl'
      ? { externalUrl: { exists: true } }
      : { status: { equals: 'discovered' } }
    const result = await payload.find({
      collection: 'videos',
      where,
      limit: itemsPerTick * 3, // fetch more to account for already-done items
      sort: 'createdAt',
    })
    for (const doc of result.docs) {
      const v = doc as Record<string, unknown>
      addStageItem(v.id as number, v.externalUrl as string, (v.title as string) ?? '')
    }
  } else {
    // selected_urls or from_discovery — look up videos by URL
    for (const url of videoUrls) {
      if (stageItems.length >= itemsPerTick) break
      const existing = await payload.find({
        collection: 'videos',
        where: { externalUrl: { equals: url } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        const v = existing.docs[0] as Record<string, unknown>
        addStageItem(v.id as number, v.externalUrl as string, (v.title as string) ?? '')
      } else {
        // Video doesn't exist in DB yet — metadata stage will create it
        addStageItem(undefined, url, url)
      }
    }
  }

  // No work items — complete the job
  if (stageItems.length === 0) {
    jlog.info('No remaining work, completing job', { jobId })
    await payload.update({
      collection: 'video-crawls',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    jlog.event('job.completed_empty', { collection: 'video-crawls', reason: 'No remaining videos to crawl' })
    return { type: 'none' }
  }

  jlog.info('Prepared video crawl stage items', { jobId, count: stageItems.length })

  return {
    type: 'video-crawl',
    jobId,
    stageItems,
    enabledStages: [...enabledStages],
    itemsPerTick,
  }
}

async function buildVideoProcessingWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('video-processings', jobId)
  jlog.info('Building video processing work', { jobId })
  const job = await payload.findByID({ collection: 'video-processings', id: jobId }) as Record<string, unknown>

  // Determine which stages are enabled and read progress map
  const enabledStages = getEnabledStages(job)
  const enabledStagesArr = [...enabledStages]
  const progress = getVideoProgress(job)

  // Initialize job if pending: set in_progress
  if (job.status === 'pending') {
    jlog.info('Initializing video processing job', { jobId, stages: enabledStagesArr.join(',') })

    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        completed: 0,
        errors: 0,
        tokensUsed: 0,
        tokensRecognition: 0,
        tokensTranscriptCorrection: 0,
        tokensSentiment: 0,
        videoProgress: {},
      },
    })
    jlog.event('job.claimed', { collection: 'video-processings', jobId })
  }

  // Find videos that need their next stage
  const stageItems: Array<{ videoId: number; title: string; stageName: string }> = []
  const itemsPerTick = (job.itemsPerTick as number) ?? 1

  if (job.type === 'single_video' && job.video) {
    const videoId = typeof job.video === 'number' ? job.video : (job.video as { id: number }).id
    const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
    const lastCompleted = progress[String(videoId)] ?? null
    const nextStage = getNextStage(lastCompleted, enabledStages)
    if (nextStage) {
      stageItems.push({ videoId: video.id as number, title: (video.title as string) ?? '', stageName: nextStage.name })
    }
  } else if (job.type === 'selected_urls') {
    const urls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    for (const url of urls) {
      if (stageItems.length >= itemsPerTick) break
      const existing = await payload.find({
        collection: 'videos',
        where: { externalUrl: { equals: url } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        const v = existing.docs[0] as Record<string, unknown>
        const vid = v.id as number
        const lastCompleted = progress[String(vid)] ?? null
        const nextStage = getNextStage(lastCompleted, enabledStages)
        if (nextStage) {
          stageItems.push({ videoId: vid, title: (v.title as string) ?? '', stageName: nextStage.name })
        }
      }
    }
  } else if (job.type === 'from_crawl' && job.crawl) {
    // from_crawl — process videos from a specific video-crawl job's crawledVideoUrls
    const crawlId = typeof job.crawl === 'number' ? job.crawl : (job.crawl as Record<string, number>).id
    const crawlJob = await payload.findByID({ collection: 'video-crawls', id: crawlId }) as Record<string, unknown>
    const crawlUrls = ((crawlJob.crawledVideoUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    for (const url of crawlUrls) {
      if (stageItems.length >= itemsPerTick) break
      const existing = await payload.find({
        collection: 'videos',
        where: { externalUrl: { equals: url } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        const v = existing.docs[0] as Record<string, unknown>
        const vid = v.id as number
        const lastCompleted = progress[String(vid)] ?? null
        const nextStage = getNextStage(lastCompleted, enabledStages)
        if (nextStage) {
          stageItems.push({ videoId: vid, title: (v.title as string) ?? '', stageName: nextStage.name })
        }
      }
    }
  } else {
    // all_unprocessed — fetch videos with status='crawled', filter by job progress map.
    // Progress is stored on the job, not the video, so we fetch a batch of videos
    // and check the progress map to find ones that still need work.
    const result = await payload.find({
      collection: 'videos',
      where: {
        status: { equals: 'crawled' },
      },
      limit: itemsPerTick * 5, // fetch extra to account for already-completed videos
      sort: 'createdAt',
    })
    for (const doc of result.docs) {
      if (stageItems.length >= itemsPerTick) break
      const v = doc as Record<string, unknown>
      const vid = v.id as number
      const lastCompleted = progress[String(vid)] ?? null
      const nextStage = getNextStage(lastCompleted, enabledStages)
      if (nextStage) {
        stageItems.push({ videoId: vid, title: (v.title as string) ?? '', stageName: nextStage.name })
      }
    }
  }

  // If no work items found, the job is done
  if (stageItems.length === 0) {
    jlog.info('No remaining work, completing job', { jobId })
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    jlog.event('job.completed_empty', { collection: 'video-processings', reason: 'No remaining videos needing stages' })
    return { type: 'none' as const }
  }

  jlog.info('Selected stage items for processing', { jobId, count: stageItems.length, stages: stageItems.map((s) => s.stageName).join(',') })

  return {
    type: 'video-processing',
    jobId,
    stageItems,
    enabledStages: enabledStagesArr,
    sceneThreshold: (job.sceneThreshold as number) ?? 0.4,
    clusterThreshold: (job.clusterThreshold as number) ?? 25,
    transcriptionLanguage: (job.transcriptionLanguage as string) ?? 'de',
    transcriptionModel: (job.transcriptionModel as string) ?? 'nova-3',
    minBoxArea: (job.minBoxArea as number) ?? 25,
    detectionThreshold: (job.detectionThreshold as number) ?? 0.3,
    detectionPrompt: (job.detectionPrompt as string) ?? 'cosmetics packaging.',
    searchThreshold: (job.searchThreshold as number) ?? 0.3,
    searchLimit: (job.searchLimit as number) ?? 1,
  }
}

async function buildProductAggregationWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-aggregations', jobId)
  jlog.info('Building product aggregation work', { jobId })
  const job = await payload.findByID({ collection: 'product-aggregations', id: jobId }) as Record<string, unknown>

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const language = (job.language as string) || 'de'
  const aggregationType = ((job.type as string) || 'all') as 'all' | 'selected_gtins'
  const imageSourcePriority = (job.imageSourcePriority as string[] | null) ?? DEFAULT_IMAGE_SOURCE_PRIORITY
  const brandSourcePriority = (job.brandSourcePriority as string[] | null) ?? DEFAULT_BRAND_SOURCE_PRIORITY
  const includeSisterVariants = (job.includeSisterVariants as boolean) ?? true

  // Determine which stages are enabled and read progress map
  const enabledStages = getEnabledAggregationStages(job)
  const enabledStagesArr = [...enabledStages]
  const progress = getAggregationProgress(job)

  jlog.info('Product aggregation job loaded', { jobId, type: aggregationType, status: job.status as string, itemsPerTick, includeSisterVariants, stages: enabledStagesArr.join(',') })

  // Initialize if pending
  if (job.status === 'pending') {
    jlog.info('Initializing product aggregation job', { jobId })
    let total: number | undefined
    if (aggregationType === 'all') {
      const totalCount = await payload.count({
        collection: 'source-products',
      })
      total = totalCount.totalDocs
    } else {
      const gtinList = ((job.gtins as string) || '').split('\n').map((g: string) => g.trim()).filter(Boolean)
      total = gtinList.length
    }

    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        aggregated: 0,
        errors: 0,
        tokensUsed: 0,
        lastCheckedSourceId: 0,
        aggregationProgress: {},
        total,
      },
    })

    jlog.event('job.claimed', { collection: 'product-aggregations', jobId, total })
    jlog.event('aggregation.started', { items: total ?? 0, type: aggregationType, language })
  }

  // AggregationSource is imported from aggregate-product.ts (single source of truth)

  /** A single GTIN with its cross-store sources */
  interface GtinItem {
    gtin: string
    sources: AggregationSource[]
  }

  /** A product group: sibling GTINs that should become variants of the same product */
  interface WorkItem {
    variants: GtinItem[]
  }

  const workItems: WorkItem[] = []

  // Helper: find all crawled source-products + their matching source-variants for a GTIN
  async function findSourcesByGtin(gtin: string): Promise<AggregationSource[]> {
    // Find source-variants with this GTIN
    const variants = await payload.find({
      collection: 'source-variants',
      where: { gtin: { equals: gtin } },
      limit: 100,
    })
    if (variants.docs.length === 0) return []

    // Group variants by parent source-product ID
    const variantsBySpId = new Map<number, Record<string, unknown>>()
    for (const v of variants.docs) {
      const sv = v as Record<string, unknown>
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      const spId = typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
      variantsBySpId.set(spId, sv) // One variant per source-product for this GTIN
    }

    // Fetch source-products that have variants (i.e. have been crawled)
    const spIds = [...variantsBySpId.keys()]
    const result = await payload.find({
      collection: 'source-products',
      where: { id: { in: spIds.join(',') } },
      limit: 100,
      depth: 1,
    })

    return (result.docs as Record<string, unknown>[]).map((sp): AggregationSource => {
      const sv = variantsBySpId.get(sp.id as number)!
      return {
        sourceProductId: sp.id as number,
        sourceVariantId: sv.id as number,
        // Product-level
        name: (sp.name as string) ?? null,
        brandName: (sp.sourceBrand as { name?: string } | null)?.name ?? null,
        source: (sp.source as string) ?? null,
        sourceBrandId: (sp.sourceBrand as { id?: number } | null)?.id ?? null,
        sourceBrandImageUrl: (sp.sourceBrand as { imageUrl?: string } | null)?.imageUrl ?? null,
        // Variant-level
        ingredientsText: (sv.ingredientsText as string) ?? null,
        description: (sv.description as string) ?? null,
        images: sv.images
          ? (sv.images as Array<{ url?: string; alt?: string | null }>)
              .filter((img) => !!img.url)
              .map((img) => ({ url: img.url!, alt: img.alt ?? null }))
          : null,
        labels: sv.labels
          ? (sv.labels as Array<{ label?: string }>)
              .filter((l) => !!l.label)
              .map((l) => ({ label: l.label! }))
          : null,
        amount: (sv.amount as number) ?? null,
        amountUnit: (sv.amountUnit as string) ?? null,
        variantLabel: (sv.variantLabel as string) ?? null,
        variantDimension: (sv.variantDimension as string) ?? null,
      }
    })
  }

  // Helper: given a set of GTINs, expand to include all sibling GTINs
  // (GTINs whose source-variants share a source-product with any of the input GTINs)
  async function expandSisterGtins(gtins: string[]): Promise<Set<string>> {
    const allGtins = new Set<string>(gtins)
    // Find all source-variants for these GTINs
    const variants = await payload.find({
      collection: 'source-variants',
      where: { gtin: { in: gtins.join(',') } },
      limit: 1000,
    })
    if (variants.docs.length === 0) return allGtins

    // Collect unique source-product IDs
    const spIds = new Set<number>()
    for (const v of variants.docs) {
      const sv = v as Record<string, unknown>
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      const spId = typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
      spIds.add(spId)
    }

    // Find ALL source-variants of those source-products to get sister GTINs
    const siblingVariants = await payload.find({
      collection: 'source-variants',
      where: {
        and: [
          { sourceProduct: { in: [...spIds].join(',') } },
          { gtin: { exists: true } },
        ],
      },
      limit: 1000,
    })

    for (const v of siblingVariants.docs) {
      const gtin = (v as Record<string, unknown>).gtin as string
      if (gtin) allGtins.add(gtin)
    }

    return allGtins
  }

  // Helper: group a set of GTINs into product groups (by shared source-products)
  // GTINs that share any source-product end up in the same group via union-find
  async function groupGtinsIntoProducts(gtins: string[]): Promise<string[][]> {
    if (gtins.length <= 1) return [gtins]

    // Fetch all source-variants for these GTINs to find their source-product parents
    const variants = await payload.find({
      collection: 'source-variants',
      where: {
        and: [
          { gtin: { in: gtins.join(',') } },
          { gtin: { exists: true } },
        ],
      },
      limit: 1000,
    })

    // Build: sourceProductId → set of GTINs
    const spToGtins = new Map<number, Set<string>>()
    for (const v of variants.docs) {
      const sv = v as Record<string, unknown>
      const gtin = sv.gtin as string
      if (!gtin) continue
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      const spId = typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
      if (!spToGtins.has(spId)) spToGtins.set(spId, new Set())
      spToGtins.get(spId)!.add(gtin)
    }

    // Union-find: GTINs that share any source-product get merged into the same group
    const parent = new Map<string, string>()
    function find(x: string): string {
      if (!parent.has(x)) parent.set(x, x)
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!))
      return parent.get(x)!
    }
    function union(a: string, b: string) {
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }

    // For each source-product, union all its GTINs together
    for (const gtinSet of spToGtins.values()) {
      const arr = [...gtinSet]
      for (let i = 1; i < arr.length; i++) {
        union(arr[0], arr[i])
      }
    }

    // Collect groups
    const groups = new Map<string, string[]>()
    for (const gtin of gtins) {
      const root = find(gtin)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push(gtin)
    }

    return [...groups.values()]
  }

  // Helper: look up the product ID for a set of GTINs by querying product-variants.
  // Returns the product ID if all GTINs in the group have product-variants pointing to the same product,
  // or null if no product-variants exist yet (resolve hasn't run).
  async function findProductIdForGtins(gtins: string[]): Promise<number | null> {
    for (const gtin of gtins) {
      const pvResult = await payload.find({
        collection: 'product-variants',
        where: { gtin: { equals: gtin } },
        limit: 1,
      })
      if (pvResult.docs.length > 0) {
        const pv = pvResult.docs[0] as Record<string, unknown>
        const productRef = pv.product as number | Record<string, unknown>
        return typeof productRef === 'number' ? productRef : (productRef as { id: number }).id
      }
    }
    return null
  }

  // ── Build work items (product groups) — same logic as before ──

  let lastId: number | undefined

  if (aggregationType === 'selected_gtins') {
    let gtinList = ((job.gtins as string) || '').split('\n').map((g: string) => g.trim()).filter(Boolean)

    if (gtinList.length === 0) {
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
      jlog.event('job.completed_empty', { collection: 'product-aggregations', reason: 'No GTINs specified' })
      return { type: 'none' as const }
    }

    // Expand to include sister GTINs if enabled
    if (includeSisterVariants) {
      const expanded = await expandSisterGtins(gtinList)
      const addedCount = expanded.size - gtinList.length
      if (addedCount > 0) {
        jlog.info('Expanded sister GTINs', { original: gtinList.length, expanded: expanded.size, added: addedCount })
      }
      gtinList = [...expanded]
    }

    // Group GTINs into product groups (sibling GTINs become one work item)
    const groups = includeSisterVariants
      ? await groupGtinsIntoProducts(gtinList)
      : gtinList.map((g) => [g]) // no grouping: each GTIN is its own group

    for (const group of groups) {
      const variants: GtinItem[] = []
      for (const gtin of group) {
        const sources = await findSourcesByGtin(gtin)
        if (sources.length === 0) continue
        variants.push({ gtin, sources })
      }
      if (variants.length > 0) {
        workItems.push({ variants })
      }
    }
  } else {
    // 'all' type — cursor-based: iterate crawled source-products, look up GTINs from their variants
    const lastCheckedSourceId = (job.lastCheckedSourceId as number) || 0

    const sourceProducts = await payload.find({
      collection: 'source-products',
      where: { id: { greater_than: lastCheckedSourceId } },
      sort: 'id',
      limit: itemsPerTick * 5,
    })

    if (sourceProducts.docs.length === 0) {
      jlog.info('No more source products, completing aggregation', { jobId, lastCursor: lastCheckedSourceId })
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
      jlog.event('job.completed_empty', { collection: 'product-aggregations', reason: 'No more source products to aggregate' })
      return { type: 'none' as const }
    }

    // For each source-product, look up GTINs from its variants and collect unique GTINs
    const seenGtins = new Set<string>()
    lastId = lastCheckedSourceId

    for (const doc of sourceProducts.docs) {
      const sp = doc as Record<string, unknown>
      lastId = sp.id as number
      if (seenGtins.size >= itemsPerTick) break

      // Look up GTINs from this source-product's variants
      const variants = await payload.find({
        collection: 'source-variants',
        where: {
          and: [
            { sourceProduct: { equals: sp.id as number } },
            { gtin: { exists: true } },
          ],
        },
        limit: 100,
      })

      for (const v of variants.docs) {
        const gtin = (v as Record<string, unknown>).gtin as string
        if (gtin && !seenGtins.has(gtin)) {
          seenGtins.add(gtin)
        }
      }
    }

    // Expand to include sister GTINs if enabled
    let allGtins = [...seenGtins]
    if (includeSisterVariants) {
      const expanded = await expandSisterGtins(allGtins)
      const addedCount = expanded.size - allGtins.length
      if (addedCount > 0) {
        jlog.info('Expanded sister GTINs', { original: allGtins.length, expanded: expanded.size, added: addedCount })
      }
      allGtins = [...expanded]
    }

    // Group GTINs into product groups
    const groups = includeSisterVariants
      ? await groupGtinsIntoProducts(allGtins)
      : allGtins.map((g) => [g])

    for (const group of groups) {
      const variants: GtinItem[] = []
      for (const gtin of group) {
        const sources = await findSourcesByGtin(gtin)
        if (sources.length === 0) continue
        variants.push({ gtin, sources })
      }
      if (variants.length > 0) {
        workItems.push({ variants })
      }
    }
  }

  // ── Stage-based dispatch: determine next stage for each product group ──

  const stageItems: Array<{
    productId: number | null
    stageName: string
    workItem: AggregationWorkItem
  }> = []

  for (const item of workItems) {
    if (stageItems.length >= itemsPerTick) break

    const gtins = item.variants.map((v) => v.gtin)

    // Build a progress key: use the canonical GTIN (first, sorted) as the key
    // Once resolve runs, the progress map will also have the product ID
    const progressKey = gtins.slice().sort().join(',')

    // Check if we have a product ID in the progress map (resolve already ran)
    // The progress map stores: progressKey → lastCompletedStageName
    // and also: `pid:${progressKey}` → productId (set by submit after resolve)
    const lastCompleted = (progress[progressKey] ?? null) as AggregationStageName | null
    const nextStage = getNextAggregationStage(lastCompleted, enabledStages)

    if (!nextStage) continue // all enabled stages done for this product group

    // For post-resolve stages, look up the product ID
    let productId: number | null = null
    if (nextStage.name !== 'resolve') {
      const pidKey = `pid:${progressKey}`
      const storedPid = progress[pidKey]
      if (storedPid != null) {
        productId = Number(storedPid)
      } else {
        // Fallback: look up from product-variants in DB
        productId = await findProductIdForGtins(gtins)
      }
      if (productId == null) {
        jlog.warn('Cannot find product ID for post-resolve stage, skipping', { gtins: gtins.join(','), stage: nextStage.name })
        continue
      }
    }

    const workItemForStage: AggregationWorkItem = {
      productId,
      gtins,
      variants: item.variants.map((v) => ({
        gtin: v.gtin,
        sources: v.sources,
      })),
    }

    stageItems.push({
      productId,
      stageName: nextStage.name,
      workItem: workItemForStage,
    })
  }

  // If no work items found, the job is done
  if (stageItems.length === 0) {
    jlog.info('No remaining work, completing job', { jobId })
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    jlog.event('job.completed_empty', { collection: 'product-aggregations', reason: 'No remaining product groups needing stages' })
    return { type: 'none' as const }
  }

  jlog.info('Selected stage items for processing', { jobId, count: stageItems.length, stages: stageItems.map((s) => s.stageName).join(',') })

  return {
    type: 'product-aggregation',
    jobId,
    language,
    aggregationType,
    imageSourcePriority,
    brandSourcePriority,
    includeSisterVariants,
    lastCheckedSourceId: lastId ?? ((job.lastCheckedSourceId as number) || 0),
    stageItems,
    enabledStages: enabledStagesArr,
    minBoxArea: (job.minBoxArea as number) ?? 5,
    detectionThreshold: (job.detectionThreshold as number) ?? 0.7,
    fallbackDetectionThreshold: (job.fallbackDetectionThreshold as boolean) ?? true,
  }
}

// ─── Ingredient Crawl ───

async function buildIngredientCrawlWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('ingredient-crawls', jobId)
  jlog.info('Building ingredient crawl work', { jobId })
  const job = await payload.findByID({ collection: 'ingredient-crawls', id: jobId }) as Record<string, unknown>

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const crawlType = ((job.type as string) || 'all_uncrawled') as 'all_uncrawled' | 'selected'
  jlog.info('Ingredient crawl job loaded', { jobId, type: crawlType, status: job.status as string, itemsPerTick })

  // Initialize if pending
  if (job.status === 'pending') {
    jlog.info('Initializing ingredient crawl job', { jobId })
    let total: number | undefined
    if (crawlType === 'all_uncrawled') {
      const count = await payload.count({
        collection: 'ingredients',
        where: {
          or: [
            { longDescription: { exists: false } },
            { longDescription: { equals: '' } },
          ],
        },
      })
      total = count.totalDocs
    } else {
      const ids = (job.ingredientIds ?? []) as unknown[]
      total = ids.length
    }

    await payload.update({
      collection: 'ingredient-crawls',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        crawled: 0,
        errors: 0,
        tokensUsed: 0,
        lastCheckedIngredientId: 0,
        total,
      },
    })

    jlog.event('job.claimed', { collection: 'ingredient-crawls', jobId, total })
  }

  interface WorkItem {
    ingredientId: number
    ingredientName: string
    hasImage: boolean
  }

  const workItems: WorkItem[] = []

  if (crawlType === 'selected') {
    const ids = ((job.ingredientIds ?? []) as unknown[]).map((id: unknown) =>
      typeof id === 'object' && id !== null && 'id' in id ? (id as { id: number }).id : id as number,
    )

    if (ids.length === 0) {
      await payload.update({
        collection: 'ingredient-crawls',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
      jlog.event('job.completed_empty', { collection: 'ingredient-crawls', reason: 'No ingredients specified' })
      return { type: 'none' }
    }

    for (const id of ids) {
      const ingredient = await payload.findByID({ collection: 'ingredients', id }) as Record<string, unknown>
      workItems.push({ ingredientId: id, ingredientName: ingredient.name as string, hasImage: !!ingredient.image })
    }
  } else {
    // 'all_uncrawled' — cursor-based
    const lastCheckedId = (job.lastCheckedIngredientId as number) || 0

    const ingredients = await payload.find({
      collection: 'ingredients',
      where: {
        and: [
          { id: { greater_than: lastCheckedId } },
          {
            or: [
              { longDescription: { exists: false } },
              { longDescription: { equals: '' } },
            ],
          },
        ],
      },
      sort: 'id',
      limit: itemsPerTick,
    })

    if (ingredients.docs.length === 0) {
      jlog.info('No more ingredients, completing crawl', { jobId, lastCursor: lastCheckedId })
      await payload.update({
        collection: 'ingredient-crawls',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
    jlog.event('job.completed_empty', { collection: 'ingredient-crawls', reason: 'No more uncrawled ingredients' })
      return { type: 'none' }
    }

    for (const doc of ingredients.docs) {
      const ingredient = doc as Record<string, unknown>
      workItems.push({
        ingredientId: ingredient.id as number,
        ingredientName: ingredient.name as string,
        hasImage: !!ingredient.image,
      })
    }
  }

  const lastId = workItems.length > 0 ? workItems[workItems.length - 1].ingredientId : 0
  jlog.info('Prepared ingredient crawl work items', { jobId, count: workItems.length, cursor: lastId })

  return {
    type: 'ingredient-crawl',
    jobId,
    crawlType,
    lastCheckedIngredientId: lastId,
    workItems,
  }
}

async function buildBotCheckWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('bot-checks', jobId)
  const job = await payload.findByID({ collection: 'bot-checks', id: jobId }) as Record<string, unknown>

  if (job.status === 'pending') {
    await payload.update({
      collection: 'bot-checks',
      id: jobId,
      data: { status: 'in_progress', startedAt: new Date().toISOString() },
    })
    jlog.event('job.claimed', { collection: 'bot-checks', jobId, total: 1 })
  }

  return {
    type: 'bot-check',
    jobId,
    url: (job.url as string) || 'https://bot-detector.rebrowser.net/',
  }
}

async function buildTestSuiteRunWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('test-suite-runs', jobId)
  const job = await payload.findByID({ collection: 'test-suite-runs', id: jobId }) as Record<string, unknown>

  if (job.status === 'pending') {
    await payload.update({
      collection: 'test-suite-runs',
      id: jobId,
      data: { status: 'in_progress', startedAt: new Date().toISOString() },
    })
    jlog.event('job.claimed', { collection: 'test-suite-runs', jobId, total: 1 })
  }

  // Fetch the linked test suite template
  const testSuiteId = typeof job.testSuite === 'object' ? (job.testSuite as any)?.id : job.testSuite
  const suite = await payload.findByID({ collection: 'test-suites', id: testSuiteId }) as Record<string, unknown>

  return {
    type: 'test-suite-run',
    jobId,
    suite,
    phases: job.phases || null,
    currentPhase: job.currentPhase || 'pending',
  }
}
