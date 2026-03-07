import type { PayloadRestClient } from '@/lib/payload-client'
import type { AuthenticatedWorker } from './types'
import { findUncrawledProducts, findUncrawledVariants, getSourceSlugFromUrl, countUncrawled, resetProducts, normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'
import type { SourceSlug } from '@/lib/source-product-queries'
import { ALL_SOURCE_SLUGS, DEFAULT_IMAGE_SOURCE_PRIORITY } from '@/lib/source-discovery/driver'
import { createLogger } from '@/lib/logger'

export type JobType = 'product-crawl' | 'product-discovery' | 'product-search' | 'ingredients-discovery' | 'video-discovery' | 'video-processing' | 'product-aggregation' | 'ingredient-crawl'

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
  'video-processing': 'video-processings',
  'product-aggregation': 'product-aggregations',
  'ingredient-crawl': 'ingredient-crawls',
} as const

const JOB_TYPE_TO_CAPABILITY = {
  'product-crawl': 'product-crawl',
  'product-discovery': 'product-discovery',
  'product-search': 'product-search',
  'ingredients-discovery': 'ingredients-discovery',
  'video-discovery': 'video-discovery',
  'video-processing': 'video-processing',
  'product-aggregation': 'product-aggregation',
  'ingredient-crawl': 'ingredient-crawl',
} as const

const log = createLogger('Claim')

export async function claimWork(
  payload: PayloadRestClient,
  worker: AuthenticatedWorker,
  jobTimeoutMinutes = 30,
): Promise<Record<string, unknown>> {
  log.debug('Claim: searching for work', { worker: worker.name, capabilities: worker.capabilities.join(', '), timeoutMinutes: jobTimeoutMinutes })

  const staleThreshold = new Date(Date.now() - jobTimeoutMinutes * 60 * 1000).toISOString()

  // Find claimable jobs: pending, or in_progress with stale/missing claimedAt
  const activeJobs: ActiveJob[] = []

  const queries: Promise<void>[] = []

  for (const [jobType, collection] of Object.entries(JOB_TYPE_TO_COLLECTION)) {
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
           (j.crawlType === 'selected_urls' || j.crawlType === 'from_discovery' || j.crawlType === 'selected_gtins')) ||
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
          return buildIngredientsDiscoveryWork(payload, candidate.id)
        case 'video-discovery':
          return buildVideoDiscoveryWork(payload, candidate.id)
        case 'video-processing':
          return buildVideoProcessingWork(payload, candidate.id)
        case 'product-aggregation':
          return buildProductAggregationWork(payload, candidate.id)
        case 'ingredient-crawl':
          return buildIngredientCrawlWork(payload, candidate.id)
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

  // Build URL list based on type — these are now product-level URLs (on source-products.sourceUrl)
  let sourceUrls: string[] | undefined
  if (job.type === 'selected_urls') {
    sourceUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => normalizeProductUrl(u.trim())).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId }) as Record<string, unknown>
    sourceUrls = ((discovery.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeProductUrl)
  } else if (job.type === 'selected_gtins') {
    // GTINs live on source-variants — resolve to parent source-product URLs
    const gtins = ((job.gtins as string) ?? '').split('\n').map((g: string) => g.trim()).filter(Boolean)
    const variants = await payload.find({
      collection: 'source-variants',
      where: { gtin: { in: gtins.join(',') } },
      limit: 10000,
    })
    // Get parent source-product IDs, then their sourceUrls
    const spIds = [...new Set(variants.docs.map((v) => {
      const sv = v as Record<string, unknown>
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      return typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
    }))]
    if (spIds.length > 0) {
      const spResult = await payload.find({
        collection: 'source-products',
        where: { id: { in: spIds.join(',') } },
        limit: 10000,
      })
      sourceUrls = spResult.docs
        .map((sp) => (sp as Record<string, unknown>).sourceUrl as string)
        .filter(Boolean)
    }
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

    // Auto-create stubs for URLs that don't have source-products yet
    if (sourceUrls) {
      let stubsCreated = 0
      for (const url of sourceUrls) {
        const slug = getSourceSlugFromUrl(url)
        if (!slug) {
          jlog.info('Skipping URL with no source slug', { jobId, url })
          continue
        }

        // Check if a source-product with this URL already exists
        const existingProduct = await payload.find({
          collection: 'source-products',
          where: { sourceUrl: { equals: url } },
          limit: 1,
        })

        if (existingProduct.docs.length === 0) {
          // Create a stub source-product (no variant — variants are created during crawl)
          await payload.create({
            collection: 'source-products',
            data: { source: slug, sourceUrl: url, status: 'uncrawled' },
          })
          stubsCreated++
        }
      }
      jlog.info('Created stubs for uncrawled URLs', { jobId, stubsCreated, totalUrls: sourceUrls.length })
    }

    // Reset matching products so they're eligible for crawling.
    // For 'selected_urls' and 'from_discovery': always reset (these target specific URLs explicitly).
    // For 'all' and 'selected_gtins': only reset when scope='recrawl'.
    const shouldReset = job.type === 'selected_urls' || job.type === 'from_discovery' || job.scope === 'recrawl'
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

    // Count total uncrawled source-products
    let total = 0
    for (const source of sources) {
      total += await countUncrawled(payload, source as SourceSlug, sourceUrls ? { sourceUrls } : undefined)
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
      },
    })

    jlog.info('Started product crawl', { total }, { event: 'start' })
  }

  // Build query options for finding work
  const queryOpts = sourceProductIds
    ? { sourceProductIds }
    : sourceUrls ? { sourceUrls } : undefined

  // Find work items: first try uncrawled products (no variants yet), then uncrawled variants
  const workItems: Array<{ sourceVariantId?: number; sourceProductId: number; sourceUrl: string; source: string }> = []

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

  // No uncrawled products left for this job's scope — mark complete
  if (workItems.length === 0) {
    jlog.info('No remaining work, completing job', { jobId })
    await payload.update({
      collection: 'product-crawls',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info('Product crawl completed', { crawled: (job.crawled as number) ?? 0, errors: (job.errors as number) ?? 0 }, { event: 'success' })
    return { type: 'none' }
  }

  return {
    type: 'product-crawl',
    jobId,
    workItems,
    itemsPerTick: (job.itemsPerTick as number) ?? 10,
    debug: (job.debug as boolean) ?? false,
    crawlVariants: (job.crawlVariants as boolean) ?? true,
    source: job.source,
  }
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
        created: 0,
        existing: 0,
        progress: null,
      },
    })
    jlog.info('Started product discovery', { urlCount: sourceUrls.length }, { event: 'start' })
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
  const debug = (job.debug as boolean) ?? false

  jlog.info('Product search job loaded', { jobId, query, sources: sources.join(', '), maxResults })

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
        created: 0,
        existing: 0,
      },
    })
    jlog.info('Started product search', { query, sources: sources.join(', ') }, { event: 'start' })
  }

  return {
    type: 'product-search',
    jobId,
    query,
    sources,
    maxResults,
    debug,
  }
}

async function buildIngredientsDiscoveryWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('ingredients-discoveries', jobId)
  jlog.info('Building ingredients discovery work', { jobId })
  const job = await payload.findByID({ collection: 'ingredients-discoveries', id: jobId }) as Record<string, unknown>

  const termQueue = (job.termQueue as string[]) ?? []
  jlog.info('Ingredients discovery job loaded', { jobId, sourceUrl: job.sourceUrl as string, currentTerm: (job.currentTerm as string) ?? 'none', termQueueSize: termQueue.length })

  // Initialize job if pending: set in_progress and reset counters
  if (job.status === 'pending') {
    jlog.info('Initializing ingredients discovery job', { jobId })
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
      },
    })
    jlog.info('Started ingredients discovery', { event: 'start' })
  }

  return {
    type: 'ingredients-discovery',
    jobId,
    sourceUrl: job.sourceUrl,
    currentTerm: (job.currentTerm as string) ?? null,
    currentPage: (job.currentPage as number) ?? 1,
    totalPagesForTerm: (job.totalPagesForTerm as number) ?? 0,
    termQueue,
    pagesPerTick: (job.pagesPerTick as number) ?? undefined,
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
        created: 0,
        existing: 0,
        progress: null,
      },
    })
    jlog.info('Started video discovery', { channelUrl }, { event: 'start' })
  }

  return {
    type: 'video-discovery',
    jobId,
    channelUrl,
    currentOffset,
    batchSize,
    maxVideos,
  }
}

async function buildVideoProcessingWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('video-processings', jobId)
  jlog.info('Building video processing work', { jobId })
  const job = await payload.findByID({ collection: 'video-processings', id: jobId }) as Record<string, unknown>

  // Initialize job if pending: count total videos and set in_progress
  if (job.status === 'pending') {
    jlog.info('Initializing video processing job', { jobId })

    let total = 0
    if (job.type === 'single_video' && job.video) {
      total = 1
    } else if (job.type === 'selected_urls') {
      const urls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
      total = urls.length
    } else {
      // all_unprocessed — count all unprocessed videos
      const count = await payload.count({
        collection: 'videos',
        where: {
          and: [
            { processingStatus: { equals: 'unprocessed' } },
            { externalUrl: { exists: true } },
          ],
        },
      })
      total = count.totalDocs
    }

    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        completedAt: null,
        total,
        processed: 0,
        errors: 0,
        tokensUsed: 0,
        tokensRecognition: 0,
        tokensTranscriptCorrection: 0,
        tokensSentiment: 0,
      },
    })
    jlog.info('Started video processing', { total }, { event: 'start' })
  }

  // Find videos to process
  const videos: Array<{ videoId: number; externalUrl: string; title: string }> = []
  const itemsPerTick = (job.itemsPerTick as number) ?? 1

  if (job.type === 'single_video' && job.video) {
    const videoId = typeof job.video === 'number' ? job.video : (job.video as { id: number }).id
    const video = await payload.findByID({ collection: 'videos', id: videoId }) as Record<string, unknown>
    if (video.externalUrl) {
      videos.push({ videoId: video.id as number, externalUrl: video.externalUrl as string, title: video.title as string })
    }
  } else if (job.type === 'selected_urls') {
    const urls = ((job.urls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)
    for (const url of urls.slice(0, itemsPerTick)) {
      const existing = await payload.find({
        collection: 'videos',
        where: { externalUrl: { equals: url } },
        limit: 1,
      })
      if (existing.docs.length > 0) {
        const v = existing.docs[0] as Record<string, unknown>
        if (v.externalUrl) {
          videos.push({ videoId: v.id as number, externalUrl: v.externalUrl as string, title: v.title as string })
        }
      }
    }
  } else {
    // all_unprocessed
    const result = await payload.find({
      collection: 'videos',
      where: {
        and: [
          { processingStatus: { equals: 'unprocessed' } },
          { externalUrl: { exists: true } },
        ],
      },
      limit: itemsPerTick,
      sort: 'createdAt',
    })
    for (const doc of result.docs) {
      const v = doc as Record<string, unknown>
      if (v.externalUrl) {
        videos.push({ videoId: v.id as number, externalUrl: v.externalUrl as string, title: v.title as string })
      }
    }
  }

  jlog.info('Selected videos for processing', { jobId, count: videos.length, ...(videos.length > 0 ? { firstTitle: videos[0].title, firstUrl: videos[0].externalUrl } : {}) })

  return {
    type: 'video-processing',
    jobId,
    videos,
    sceneThreshold: (job.sceneThreshold as number) ?? 0.4,
    clusterThreshold: (job.clusterThreshold as number) ?? 25,
    transcriptionEnabled: (job.transcriptionEnabled as boolean) ?? true,
    transcriptionLanguage: (job.transcriptionLanguage as string) ?? 'de',
    transcriptionModel: (job.transcriptionModel as string) ?? 'nova-3',
  }
}

async function buildProductAggregationWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-aggregations', jobId)
  jlog.info('Building product aggregation work', { jobId })
  const job = await payload.findByID({ collection: 'product-aggregations', id: jobId }) as Record<string, unknown>

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const language = (job.language as string) || 'de'
  const aggregationType = ((job.type as string) || 'all') as 'all' | 'selected_gtins'
  const scope = ((job.scope as string) || 'full') as 'full' | 'partial'
  const imageSourcePriority = (job.imageSourcePriority as string[] | null) ?? DEFAULT_IMAGE_SOURCE_PRIORITY
  jlog.info('Product aggregation job loaded', { jobId, type: aggregationType, scope, status: job.status as string, itemsPerTick })

  // Initialize if pending
  if (job.status === 'pending') {
    jlog.info('Initializing product aggregation job', { jobId })
    let total: number | undefined
    if (aggregationType === 'all') {
      const totalCount = await payload.count({
        collection: 'source-products',
        where: { status: { equals: 'crawled' } },
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
        total,
      },
    })

    jlog.info('Started product aggregation', { type: aggregationType, total }, { event: 'start' })
  }

  // Each source in a work item carries product-level data (from source-products)
  // plus variant-level data (from the source-variant matching the GTIN being aggregated).
  interface AggregationSource {
    sourceProductId: number
    sourceVariantId: number
    // Product-level (from source-products)
    name: string | null
    brandName: string | null
    source: string | null
    // Variant-level (from source-variants)
    ingredientsText: string | null
    description: string | null
    images: Array<{ url: string; alt: string | null }> | null
  }

  interface WorkItem {
    gtin: string
    sources: AggregationSource[]
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

    // Fetch only crawled source-products
    const spIds = [...variantsBySpId.keys()]
    const result = await payload.find({
      collection: 'source-products',
      where: {
        and: [
          { id: { in: spIds.join(',') } },
          { status: { equals: 'crawled' } },
        ],
      },
      limit: 100,
    })

    return (result.docs as Record<string, unknown>[]).map((sp) => {
      const sv = variantsBySpId.get(sp.id as number)!
      return {
        sourceProductId: sp.id as number,
        sourceVariantId: sv.id as number,
        // Product-level
        name: (sp.name as string) ?? null,
        brandName: (sp.brandName as string) ?? null,
        source: (sp.source as string) ?? null,
        // Variant-level
        ingredientsText: (sv.ingredientsText as string) ?? null,
        description: (sv.description as string) ?? null,
        images: sv.images
          ? (sv.images as Array<{ url?: string; alt?: string | null }>)
              .filter((img) => !!img.url)
              .map((img) => ({ url: img.url!, alt: img.alt ?? null }))
          : null,
      }
    })
  }

  if (aggregationType === 'selected_gtins') {
    const gtinList = ((job.gtins as string) || '').split('\n').map((g: string) => g.trim()).filter(Boolean)

    if (gtinList.length === 0) {
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
      jlog.info('Completed: no GTINs specified', { event: 'success' })
      return { type: 'none' }
    }

    for (const gtin of gtinList) {
      const sources = await findSourcesByGtin(gtin)
      if (sources.length === 0) continue

      workItems.push({ gtin, sources })
    }
  } else {
    // 'all' type — cursor-based: iterate crawled source-products, look up GTINs from their variants
    const lastCheckedSourceId = (job.lastCheckedSourceId as number) || 0

    const sourceProducts = await payload.find({
      collection: 'source-products',
      where: {
        and: [
          { status: { equals: 'crawled' } },
          { id: { greater_than: lastCheckedSourceId } },
        ],
      },
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
      jlog.info('Product aggregation completed', { aggregated: (job.aggregated as number) ?? 0, errors: (job.errors as number) ?? 0 }, { event: 'success' })
      return { type: 'none' }
    }

    // For each source-product, look up GTINs from its variants and collect unique GTINs
    const seenGtins = new Set<string>()
    let lastId = lastCheckedSourceId

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

    // For each unique GTIN, fetch all crawled source-products + variants that share it
    for (const gtin of seenGtins) {
      const sources = await findSourcesByGtin(gtin)
      if (sources.length === 0) continue

      workItems.push({ gtin, sources })
    }

    jlog.info('Prepared aggregation work items', { jobId, count: workItems.length, gtins: workItems.map((w) => w.gtin).join(', '), cursor: lastId })

    // Return lastId for cursor tracking
    return {
      type: 'product-aggregation',
      jobId,
      language,
      aggregationType,
      scope,
      imageSourcePriority,
      lastCheckedSourceId: lastId,
      workItems,
    }
  }

  jlog.info('Prepared aggregation work items', { jobId, count: workItems.length, gtins: workItems.map((w) => w.gtin).join(', ') })

  return {
    type: 'product-aggregation',
    jobId,
    language,
    aggregationType,
    scope,
    imageSourcePriority,
    lastCheckedSourceId: (job.lastCheckedSourceId as number) || 0,
    workItems,
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

    jlog.info('Started ingredient crawl', { type: crawlType, total }, { event: 'start' })
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
      jlog.info('Completed: no ingredients specified', { event: 'success' })
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
    jlog.info('Ingredient crawl completed', { crawled: (job.crawled as number) ?? 0, errors: (job.errors as number) ?? 0 }, { event: 'success' })
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
