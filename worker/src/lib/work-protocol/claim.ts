import type { PayloadRestClient } from '@/lib/payload-client'
import type { AuthenticatedWorker } from './types'
import { findUncrawledVariants, getSourceSlugFromUrl, countUncrawled, resetProducts, normalizeProductUrl, normalizeVariantUrl } from '@/lib/source-product-queries'
import type { SourceSlug } from '@/lib/source-product-queries'
import { createLogger } from '@/lib/logger'
import type { JobCollection } from '@/lib/logger'

type JobType = 'product-crawl' | 'product-discovery' | 'ingredients-discovery' | 'video-discovery' | 'video-processing' | 'product-aggregation' | 'ingredient-crawl'

interface ActiveJob {
  type: JobType
  id: number
  status: string
  crawlType?: string
  aggregationType?: string
}

const JOB_TYPE_TO_COLLECTION = {
  'product-crawl': 'product-crawls',
  'product-discovery': 'product-discoveries',
  'ingredients-discovery': 'ingredients-discoveries',
  'video-discovery': 'video-discoveries',
  'video-processing': 'video-processings',
  'product-aggregation': 'product-aggregations',
  'ingredient-crawl': 'ingredient-crawls',
} as const

const JOB_TYPE_TO_CAPABILITY = {
  'product-crawl': 'product-crawl',
  'product-discovery': 'product-discovery',
  'ingredients-discovery': 'ingredients-discovery',
  'video-discovery': 'video-discovery',
  'video-processing': 'video-processing',
  'product-aggregation': 'product-aggregation',
  'ingredient-crawl': 'ingredient-crawl',
} as const

const log = createLogger('WorkProtocol')

export async function claimWork(
  payload: PayloadRestClient,
  worker: AuthenticatedWorker,
  jobTimeoutMinutes = 30,
): Promise<Record<string, unknown>> {
  log.debug(`claim: worker "${worker.name}" capabilities=[${worker.capabilities.join(', ')}], timeout=${jobTimeoutMinutes}m`)

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
          log.debug(`claim: ${jobType}: ${unclaimedInProgress.totalDocs} unclaimed in_progress, ${staleInProgress.totalDocs} stale in_progress, ${pending.totalDocs} pending`)
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
    log.debug('claim: no claimable jobs found')
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

      log.info(`claim: claimed ${candidate.type} #${candidate.id} (${candidate.status})`)

      // Build work unit based on job type
      switch (candidate.type) {
        case 'product-crawl':
          return buildProductCrawlWork(payload, candidate.id)
        case 'product-discovery':
          return buildProductDiscoveryWork(payload, candidate.id)
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
      log.debug(`claim: failed to claim ${candidate.type} #${candidate.id}: ${msg}`)
      // Try next candidate
    }
  }

  log.debug('claim: all candidates already claimed by other workers')
  return { type: 'none' }
}

async function buildProductCrawlWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-crawls' as JobCollection, jobId)
  jlog.info(`buildProductCrawlWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'product-crawls', id: jobId }) as Record<string, unknown>
  jlog.info(`buildProductCrawlWork #${jobId}: type=${job.type}, source=${job.source}, status=${job.status}`)

  // Determine source drivers
  const sources: string[] = job.source === 'all' ? ['dm', 'mueller', 'rossmann'] : [job.source as string]

  // Build URL list based on type — URLs are now source-variant URLs (preserving itemId for Mueller)
  let sourceUrls: string[] | undefined
  if (job.type === 'selected_urls') {
    sourceUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => normalizeVariantUrl(u.trim())).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId }) as Record<string, unknown>
    sourceUrls = ((discovery.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeVariantUrl)
  } else if (job.type === 'selected_gtins') {
    // GTINs now live on source-variants, not source-products
    const gtins = ((job.gtins as string) ?? '').split('\n').map((g: string) => g.trim()).filter(Boolean)
    const variants = await payload.find({
      collection: 'source-variants',
      where: { gtin: { in: gtins.join(',') } },
      limit: 10000,
    })
    sourceUrls = variants.docs.map((v) => (v as Record<string, unknown>).sourceUrl).filter(Boolean) as string[]
  }

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const crawlVariants = (job.crawlVariants as boolean) ?? true

  // When crawlVariants=true and we have scoped URLs, resolve to source-product IDs.
  // This ensures sibling variants (with different URLs) are also found and crawled.
  let sourceProductIds: number[] | undefined
  if (crawlVariants && sourceUrls && sourceUrls.length > 0) {
    const svResult = await payload.find({
      collection: 'source-variants',
      where: { sourceUrl: { in: sourceUrls.join(',') } },
      limit: 100000,
    })
    sourceProductIds = [...new Set(svResult.docs.map((doc) => {
      const sv = doc as Record<string, unknown>
      const spRef = sv.sourceProduct as number | Record<string, unknown>
      return typeof spRef === 'number' ? spRef : (spRef as Record<string, unknown>).id as number
    }))]
    jlog.info(`buildProductCrawlWork #${jobId}: crawlVariants=true, resolved ${sourceUrls.length} URLs to ${sourceProductIds.length} source-product IDs`)
  }

  // Build query options: when crawlVariants=true with scoped URLs, use sourceProductIds (finds all variants);
  // otherwise use sourceUrls (finds only the specific variant URLs)
  const queryOpts = sourceProductIds
    ? { sourceProductIds }
    : sourceUrls ? { sourceUrls } : undefined

  // Initialize job if pending: create stubs, reset products, count total
  if (job.status === 'pending') {
    jlog.info(`buildProductCrawlWork #${jobId}: pending → in_progress`)

    // Auto-create stubs for URLs that don't have source-variants yet
    if (sourceUrls) {
      let stubsCreated = 0
      for (const url of sourceUrls) {
        const slug = getSourceSlugFromUrl(url)
        if (!slug) {
          jlog.info(`buildProductCrawlWork #${jobId}: skipping URL (no source slug): ${url}`)
          continue
        }

        // Check if a source-variant with this URL already exists
        const existingVariant = await payload.find({
          collection: 'source-variants',
          where: { sourceUrl: { equals: url } },
          limit: 1,
        })

        if (existingVariant.docs.length === 0) {
          // Create a stub source-product + default source-variant
          const stubProduct = await payload.create({
            collection: 'source-products',
            data: { source: slug, status: 'uncrawled' },
          }) as { id: number }
          await payload.create({
            collection: 'source-variants',
            data: { sourceProduct: stubProduct.id, sourceUrl: url, isDefault: true },
          })
          stubsCreated++
        }
      }
      jlog.info(`buildProductCrawlWork #${jobId}: ${stubsCreated} stubs created from ${sourceUrls.length} URLs`)
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

      jlog.info(`buildProductCrawlWork #${jobId}: resetting products (type=${job.type}, scope=${job.scope}, crawledBefore=${crawledBefore?.toISOString() ?? 'any'})`)
      for (const source of sources) {
        await resetProducts(payload, source as SourceSlug, sourceUrls, crawledBefore)
      }
    }

    // Count total (note: initial count uses sourceUrls since siblings don't exist yet at this point)
    let total = 0
    for (const source of sources) {
      total += await countUncrawled(payload, source as SourceSlug, sourceUrls ? { sourceUrls } : undefined)
    }

    jlog.info(`buildProductCrawlWork #${jobId}: total uncrawled=${total}`)

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

    jlog.info(`Started product crawl: ${total} products to process`, { event: 'start' })
  }

  // Find uncrawled source-variants to process in this batch
  const workItems: Array<{ sourceVariantId: number; sourceProductId: number; sourceUrl: string; source: string }> = []

  for (const source of sources) {
    const variants = await findUncrawledVariants(payload, source as SourceSlug, {
      ...(queryOpts ?? {}),
      limit: itemsPerTick - workItems.length,
    })

    jlog.info(`buildProductCrawlWork #${jobId}: source=${source}, ${variants.length} uncrawled variants found`)

    for (const v of variants) {
      workItems.push({ sourceVariantId: v.sourceVariantId, sourceProductId: v.sourceProductId, sourceUrl: v.sourceUrl, source })
    }

    if (workItems.length >= itemsPerTick) break
  }

  jlog.info(`buildProductCrawlWork #${jobId}: ${workItems.length} work items total`)

  // No uncrawled products left for this job's scope — mark complete
  if (workItems.length === 0) {
    jlog.info(`buildProductCrawlWork #${jobId}: no remaining work, completing job`)
    await payload.update({
      collection: 'product-crawls',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    jlog.info(`Completed: ${(job.crawled as number) ?? 0} crawled, ${(job.errors as number) ?? 0} errors`, { event: 'success' })
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
  const jlog = log.forJob('product-discoveries' as JobCollection, jobId)
  jlog.info(`buildProductDiscoveryWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'product-discoveries', id: jobId }) as Record<string, unknown>

  const sourceUrls = ((job.sourceUrls as string) ?? '').split('\n').map((u: string) => u.trim()).filter(Boolean)

  interface ProductDiscoveryJobProgress {
    currentUrlIndex: number
    driverProgress: unknown | null
  }

  const progress = job.progress as ProductDiscoveryJobProgress | null
  const maxPages = (job.itemsPerTick as number) ?? undefined
  const delay = (job.delay as number) ?? 2000

  jlog.info(`buildProductDiscoveryWork #${jobId}: ${sourceUrls.length} URLs, urlIndex=${progress?.currentUrlIndex ?? 0}, maxPages=${maxPages ?? 'unlimited'}, delay=${delay}ms`)

  // Initialize job if pending: set in_progress and reset counters
  if (job.status === 'pending') {
    jlog.info(`buildProductDiscoveryWork #${jobId}: pending → in_progress`)
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
    jlog.info(`Started product discovery: ${sourceUrls.length} source URLs`, { event: 'start' })
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

async function buildIngredientsDiscoveryWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('ingredients-discoveries' as JobCollection, jobId)
  jlog.info(`buildIngredientsDiscoveryWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'ingredients-discoveries', id: jobId }) as Record<string, unknown>

  const termQueue = (job.termQueue as string[]) ?? []
  jlog.info(`buildIngredientsDiscoveryWork #${jobId}: sourceUrl=${job.sourceUrl}, currentTerm=${job.currentTerm ?? 'none'}, termQueue=${termQueue.length} terms`)

  // Initialize job if pending: set in_progress and reset counters
  if (job.status === 'pending') {
    jlog.info(`buildIngredientsDiscoveryWork #${jobId}: pending → in_progress`)
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
    jlog.info(`Started ingredients discovery`, { event: 'start' })
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
  const jlog = log.forJob('video-discoveries' as JobCollection, jobId)
  jlog.info(`buildVideoDiscoveryWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'video-discoveries', id: jobId }) as Record<string, unknown>

  const channelUrl = job.channelUrl as string

  interface VideoDiscoveryJobProgress {
    currentOffset: number
  }

  const progress = job.progress as VideoDiscoveryJobProgress | null
  const currentOffset = progress?.currentOffset ?? 0
  const batchSize = (job.itemsPerTick as number) || 50
  const maxVideos = (job.maxVideos as number) ?? undefined

  jlog.info(`buildVideoDiscoveryWork #${jobId}: channel=${channelUrl}, offset=${currentOffset}, batchSize=${batchSize}, maxVideos=${maxVideos ?? 'unlimited'}`)

  // Initialize job if pending: set in_progress and reset counters
  if (job.status === 'pending') {
    jlog.info(`buildVideoDiscoveryWork #${jobId}: pending → in_progress`)
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
    jlog.info(`Started video discovery: ${channelUrl}`, { event: 'start' })
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
  const jlog = log.forJob('video-processings' as JobCollection, jobId)
  jlog.info(`buildVideoProcessingWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'video-processings', id: jobId }) as Record<string, unknown>

  // Initialize job if pending: count total videos and set in_progress
  if (job.status === 'pending') {
    jlog.info(`buildVideoProcessingWork #${jobId}: pending → in_progress`)

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
    jlog.info(`Started video processing: ${total} videos to process`, { event: 'start' })
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

  jlog.info(`buildVideoProcessingWork #${jobId}: ${videos.length} videos selected${videos.length > 0 ? ` (first: "${videos[0].title}", ${videos[0].externalUrl})` : ''}`)

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
  const jlog = log.forJob('product-aggregations' as JobCollection, jobId)
  jlog.info(`buildProductAggregationWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'product-aggregations', id: jobId }) as Record<string, unknown>

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const language = (job.language as string) || 'de'
  const aggregationType = ((job.type as string) || 'all') as 'all' | 'selected_gtins'
  const scope = ((job.scope as string) || 'full') as 'full' | 'partial'
  const imageSourcePriority = (job.imageSourcePriority as string[] | null) ?? ['dm', 'rossmann', 'mueller']
  jlog.info(`buildProductAggregationWork #${jobId}: type=${aggregationType}, scope=${scope}, status=${job.status}, itemsPerTick=${itemsPerTick}`)

  // Initialize if pending
  if (job.status === 'pending') {
    jlog.info(`buildProductAggregationWork #${jobId}: pending → in_progress`)
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

    jlog.info(`Started product aggregation (type=${aggregationType}, total=${total})`, { event: 'start' })
  }

  interface WorkItem {
    gtin: string
    sourceProducts: Array<{
      id: number
      gtin: string | null
      name: string | null
      brandName: string | null
      source: string | null
      ingredientsText: string | null
      description: string | null
      images: Array<{ url: string; alt: string | null }> | null
    }>
  }

  const workItems: WorkItem[] = []

  // Helper: convert source product doc to serializable work item shape
  function toSourceProductData(sp: Record<string, unknown>) {
    return {
      id: sp.id as number,
      gtin: (sp.gtin as string) ?? null,
      name: (sp.name as string) ?? null,
      brandName: (sp.brandName as string) ?? null,
      source: (sp.source as string) ?? null,
      ingredientsText: (sp.ingredientsText as string) ?? null,
      description: (sp.description as string) ?? null,
      images: sp.images
        ? (sp.images as Array<{ url?: string; alt?: string | null }>)
            .filter((img) => !!img.url)
            .map((img) => ({ url: img.url!, alt: img.alt ?? null }))
        : null,
    }
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
      const allSources = await payload.find({
        collection: 'source-products',
        where: {
          and: [
            { gtin: { equals: gtin } },
            { status: { equals: 'crawled' } },
          ],
        },
        limit: 100,
      })

      if (allSources.docs.length === 0) continue

      const sourceProducts = allSources.docs.map((sp) => toSourceProductData(sp as Record<string, unknown>))

      workItems.push({ gtin, sourceProducts })
    }
  } else {
    // 'all' type — cursor-based
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
      jlog.info(`buildProductAggregationWork #${jobId}: no more source products after cursor ${lastCheckedSourceId}, completing`)
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
      jlog.info(`Completed: ${(job.aggregated as number) ?? 0} aggregated, ${(job.errors as number) ?? 0} errors`, { event: 'success' })
      return { type: 'none' }
    }

    // Collect unique GTINs, up to itemsPerTick
    const seenGtins = new Set<string>()
    let lastId = lastCheckedSourceId

    for (const doc of sourceProducts.docs) {
      const sp = doc as Record<string, unknown>
      lastId = sp.id as number
      if (!sp.gtin) continue
      if (seenGtins.has(sp.gtin as string)) continue
      if (seenGtins.size >= itemsPerTick) break
      seenGtins.add(sp.gtin as string)
    }

    // For each unique GTIN, fetch all crawled source products
    for (const gtin of seenGtins) {
      const allSources = await payload.find({
        collection: 'source-products',
        where: {
          and: [
            { gtin: { equals: gtin } },
            { status: { equals: 'crawled' } },
          ],
        },
        limit: 100,
      })

      const spData = allSources.docs.map((sp) => toSourceProductData(sp as Record<string, unknown>))

      workItems.push({ gtin, sourceProducts: spData })
    }

    const gtinsList = workItems.map((w) => w.gtin).join(', ')
    jlog.info(`buildProductAggregationWork #${jobId}: ${workItems.length} work items, GTINs=[${gtinsList}], cursor=${lastId}`)

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

  const gtinsList = workItems.map((w) => w.gtin).join(', ')
  jlog.info(`buildProductAggregationWork #${jobId}: ${workItems.length} work items, GTINs=[${gtinsList}]`)

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
  const jlog = log.forJob('ingredient-crawls' as JobCollection, jobId)
  jlog.info(`buildIngredientCrawlWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'ingredient-crawls', id: jobId }) as Record<string, unknown>

  const itemsPerTick = (job.itemsPerTick as number) ?? 10
  const crawlType = ((job.type as string) || 'all_uncrawled') as 'all_uncrawled' | 'selected'
  jlog.info(`buildIngredientCrawlWork #${jobId}: type=${crawlType}, status=${job.status}, itemsPerTick=${itemsPerTick}`)

  // Initialize if pending
  if (job.status === 'pending') {
    jlog.info(`buildIngredientCrawlWork #${jobId}: pending → in_progress`)
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

    jlog.info(`Started ingredient crawl (type=${crawlType}, total=${total})`, { event: 'start' })
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
      jlog.info(`buildIngredientCrawlWork #${jobId}: no more ingredients after cursor ${lastCheckedId}, completing`)
      await payload.update({
        collection: 'ingredient-crawls',
        id: jobId,
        data: { status: 'completed', completedAt: new Date().toISOString() },
      })
      jlog.info(`Completed: ${(job.crawled as number) ?? 0} crawled, ${(job.errors as number) ?? 0} errors`, { event: 'success' })
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
  jlog.info(`buildIngredientCrawlWork #${jobId}: ${workItems.length} work items, cursor=${lastId}`)

  return {
    type: 'ingredient-crawl',
    jobId,
    crawlType,
    lastCheckedIngredientId: lastId,
    workItems,
  }
}
