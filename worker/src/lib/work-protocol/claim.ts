import type { PayloadRestClient } from '@/lib/payload-client'
import type { AuthenticatedWorker } from './types'
import { findUncrawledProducts, getSourceSlugFromUrl, countUncrawled, resetProducts, normalizeProductUrl } from '@/lib/source-product-queries'
import type { SourceSlug } from '@/lib/source-product-queries'
import { createLogger } from '@/lib/logger'
import type { JobCollection } from '@/lib/logger'

type JobType = 'product-crawl' | 'product-discovery' | 'ingredients-discovery' | 'video-discovery' | 'video-processing' | 'product-aggregation'

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
} as const

const JOB_TYPE_TO_CAPABILITY = {
  'product-crawl': 'product-crawl',
  'product-discovery': 'product-discovery',
  'ingredients-discovery': 'ingredients-discovery',
  'video-discovery': 'video-discovery',
  'video-processing': 'video-processing',
  'product-aggregation': 'product-aggregation',
} as const

const log = createLogger('WorkProtocol')

export async function claimWork(
  payload: PayloadRestClient,
  worker: AuthenticatedWorker,
): Promise<Record<string, unknown>> {
  log.debug(`claim: worker "${worker.name}" capabilities=[${worker.capabilities.join(', ')}]`)

  // Find active jobs across all types the worker supports
  const activeJobs: ActiveJob[] = []

  const queries: Promise<void>[] = []

  for (const [jobType, collection] of Object.entries(JOB_TYPE_TO_COLLECTION)) {
    const capability = JOB_TYPE_TO_CAPABILITY[jobType as JobType]
    if (!worker.capabilities.includes(capability)) continue

    queries.push(
      (async () => {
        const [inProgress, pending] = await Promise.all([
          payload.find({ collection, where: { status: { equals: 'in_progress' } }, limit: 10 }),
          payload.find({ collection, where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
        ])

        if (inProgress.totalDocs > 0 || pending.totalDocs > 0) {
          log.debug(`claim: ${jobType}: ${inProgress.totalDocs} in_progress, ${pending.totalDocs} pending`)
        }

        for (const doc of inProgress.docs) {
          const d = doc as Record<string, unknown>
          const docType = d.type as string | undefined
          activeJobs.push({
            type: jobType as JobType,
            id: d.id as number,
            status: d.status as string,
            crawlType: docType,
            aggregationType: jobType === 'product-aggregation' ? docType : undefined,
          })
        }
        for (const doc of pending.docs) {
          const d = doc as Record<string, unknown>
          const docType = d.type as string | undefined
          activeJobs.push({
            type: jobType as JobType,
            id: d.id as number,
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
    log.debug('claim: no active jobs found')
    return { type: 'none' }
  }

  // Prioritize: selected crawls/aggregations first, otherwise random
  const selectedTargetJobs = activeJobs.filter(
    (j) => (j.type === 'product-crawl' &&
           (j.crawlType === 'selected_urls' || j.crawlType === 'from_discovery' || j.crawlType === 'selected_gtins')) ||
           (j.type === 'product-aggregation' && j.aggregationType === 'selected_gtins'),
  )
  const selected = selectedTargetJobs.length > 0
    ? selectedTargetJobs[0]
    : activeJobs[Math.floor(Math.random() * activeJobs.length)]

  const reason = selectedTargetJobs.length > 0 ? 'priority (selected target)' : `random (${activeJobs.length} candidates)`
  log.info(`claim: selected ${selected.type} #${selected.id} (${selected.status}, ${reason})`)

  // Build work unit based on job type
  switch (selected.type) {
    case 'product-crawl':
      return buildProductCrawlWork(payload, selected.id)
    case 'product-discovery':
      return buildProductDiscoveryWork(payload, selected.id)
    case 'ingredients-discovery':
      return buildIngredientsDiscoveryWork(payload, selected.id)
    case 'video-discovery':
      return buildVideoDiscoveryWork(payload, selected.id)
    case 'video-processing':
      return buildVideoProcessingWork(payload, selected.id)
    case 'product-aggregation':
      return buildProductAggregationWork(payload, selected.id)
    default:
      return { type: 'none' }
  }
}

async function buildProductCrawlWork(payload: PayloadRestClient, jobId: number) {
  const jlog = log.forJob('product-crawls' as JobCollection, jobId)
  jlog.info(`buildProductCrawlWork: job #${jobId}`)
  const job = await payload.findByID({ collection: 'product-crawls', id: jobId }) as Record<string, unknown>
  jlog.info(`buildProductCrawlWork #${jobId}: type=${job.type}, source=${job.source}, status=${job.status}`)

  // Determine source drivers
  const sources: string[] = job.source === 'all' ? ['dm', 'mueller', 'rossmann'] : [job.source as string]

  // Build URL list based on type (all URLs are normalized to strip query params and trailing slashes)
  let sourceUrls: string[] | undefined
  if (job.type === 'selected_urls') {
    sourceUrls = ((job.urls as string) ?? '').split('\n').map((u: string) => normalizeProductUrl(u.trim())).filter(Boolean)
  } else if (job.type === 'from_discovery' && job.discovery) {
    const discoveryId = typeof job.discovery === 'number' ? job.discovery : (job.discovery as Record<string, number>).id
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId }) as Record<string, unknown>
    sourceUrls = ((discovery.productUrls as string) ?? '').split('\n').filter(Boolean).map(normalizeProductUrl)
  } else if (job.type === 'selected_gtins') {
    const gtins = ((job.gtins as string) ?? '').split('\n').map((g: string) => g.trim()).filter(Boolean)
    const products = await payload.find({
      collection: 'source-products',
      where: { gtin: { in: gtins.join(',') } },
      limit: 10000,
    })
    sourceUrls = products.docs.map((p) => (p as Record<string, unknown>).sourceUrl).filter(Boolean) as string[]
  }

  const itemsPerTick = (job.itemsPerTick as number) ?? 10

  // Initialize job if pending: create stubs, reset products, count total
  if (job.status === 'pending') {
    jlog.info(`buildProductCrawlWork #${jobId}: pending → in_progress`)

    // Auto-create stubs for URLs that don't have source-products yet
    if (sourceUrls) {
      let stubsCreated = 0
      for (const url of sourceUrls) {
        const slug = getSourceSlugFromUrl(url)
        if (!slug) {
          jlog.info(`buildProductCrawlWork #${jobId}: skipping URL (no source slug): ${url}`)
          continue
        }

        const existing = await payload.find({
          collection: 'source-products',
          where: {
            and: [
              { sourceUrl: { equals: url } },
              { or: [{ source: { equals: slug } }, { source: { exists: false } }] },
            ],
          },
          limit: 1,
        })

        if (existing.docs.length === 0) {
          await payload.create({
            collection: 'source-products',
            data: { source: slug, sourceUrl: url, status: 'uncrawled' },
          })
          stubsCreated++
        }
      }
      jlog.info(`buildProductCrawlWork #${jobId}: ${stubsCreated} stubs created from ${sourceUrls.length} URLs`)
    }

    // If scope='recrawl', reset matching products
    if (job.scope === 'recrawl') {
      let crawledBefore: Date | undefined
      if (job.minCrawlAge && job.minCrawlAgeUnit) {
        const now = Date.now()
        const ms = (job.minCrawlAge as number) * ((job.minCrawlAgeUnit as string) === 'hours' ? 3600000 : (job.minCrawlAgeUnit as string) === 'days' ? 86400000 : 1)
        crawledBefore = new Date(now - ms)
      }

      jlog.info(`buildProductCrawlWork #${jobId}: resetting products (scope=recrawl, crawledBefore=${crawledBefore?.toISOString() ?? 'any'})`)
      for (const source of sources) {
        await resetProducts(payload, source as SourceSlug, sourceUrls, crawledBefore)
      }
    }

    // Count total
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

  // Find uncrawled products to process in this batch (after initialization so stubs/resets are applied)
  const workItems: Array<{ sourceProductId: number; sourceUrl: string; source: string }> = []

  for (const source of sources) {
    const products = await findUncrawledProducts(payload, source as SourceSlug, {
      sourceUrls,
      limit: itemsPerTick - workItems.length,
    })

    jlog.info(`buildProductCrawlWork #${jobId}: source=${source}, ${products.length} uncrawled products found`)

    for (const p of products) {
      workItems.push({ sourceProductId: p.id, sourceUrl: p.sourceUrl, source })
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
  jlog.info(`buildVideoDiscoveryWork #${jobId}: channel=${channelUrl}`)

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
      },
    })
    jlog.info(`Started video discovery: ${channelUrl}`, { event: 'start' })
  }

  return {
    type: 'video-discovery',
    jobId,
    channelUrl,
    itemsPerTick: (job.itemsPerTick as number) ?? 10,
    created: (job.created as number) ?? 0,
    existing: (job.existing as number) ?? 0,
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
  const imageSourcePriority = (job.imageSourcePriority as string[] | null) ?? ['dm', 'rossmann', 'mueller']
  jlog.info(`buildProductAggregationWork #${jobId}: type=${aggregationType}, status=${job.status}, itemsPerTick=${itemsPerTick}`)

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
      ingredients: Array<{ name: string | null }> | null
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
      ingredients: sp.ingredients
        ? (sp.ingredients as Array<{ name?: string | null }>).map((i) => ({ name: i.name ?? null }))
        : null,
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
    imageSourcePriority,
    lastCheckedSourceId: (job.lastCheckedSourceId as number) || 0,
    workItems,
  }
}
