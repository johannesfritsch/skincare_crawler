import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getSourceDriver, getSourceDriverBySlug, getAllSourceDrivers } from '@/lib/source-discovery/driver'
import type { SourceDriver, DiscoveredProduct } from '@/lib/source-discovery/types'
import { aggregateProduct } from '@/lib/aggregate-product'
import { getVideoDriver } from '@/lib/video-discovery/driver'
import { processVideo } from '@/lib/video-processing/process-video'
import { getCategoryDriver } from '@/lib/category-discovery/driver'
import type { DriverProgress, DiscoveredCategory } from '@/lib/category-discovery/types'

export const runtime = 'nodejs'
export const maxDuration = 300

interface ActiveJob {
  type: 'ingredients-discovery' | 'product-discovery' | 'product-crawl' | 'product-aggregation' | 'video-discovery' | 'video-processing' | 'category-discovery'
  id: number
  status: string
  crawlType?: string
  aggregationType?: string
}

type JobCollection = 'product-discoveries' | 'product-crawls' | 'ingredients-discoveries' | 'product-aggregations' | 'video-discoveries' | 'video-processings' | 'category-discoveries'
type EventType = 'start' | 'success' | 'info' | 'warning' | 'error'

async function createEvent(
  payload: Awaited<ReturnType<typeof getPayload>>,
  type: EventType,
  jobCollection: JobCollection,
  jobId: number,
  message: string,
) {
  try {
    await payload.create({
      collection: 'events',
      data: { type, message, job: { relationTo: jobCollection, value: jobId } },
    })
  } catch (e) {
    console.error('Failed to create event:', e)
  }
}

export const POST = async () => {
  const payload = await getPayload({ config: configPromise })

  // Find active jobs across all types
  const activeJobs: ActiveJob[] = []

  const [
    ingredientsInProgress, ingredientsPending,
    prodDiscInProgress, prodDiscPending,
    crawlInProgress, crawlPending,
    aggInProgress, aggPending,
    videoDiscInProgress, videoDiscPending,
    videoProcInProgress, videoProcPending,
    catDiscInProgress, catDiscPending,
  ] = await Promise.all([
    payload.find({ collection: 'ingredients-discoveries', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'ingredients-discoveries', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'product-discoveries', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'product-discoveries', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'product-crawls', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'product-crawls', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'product-aggregations', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'product-aggregations', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'video-discoveries', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'video-discoveries', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'video-processings', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'video-processings', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'category-discoveries', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'category-discoveries', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
  ])

  activeJobs.push(
    ...ingredientsInProgress.docs.map((d) => ({ type: 'ingredients-discovery' as const, id: d.id, status: d.status! })),
    ...ingredientsPending.docs.map((d) => ({ type: 'ingredients-discovery' as const, id: d.id, status: d.status! })),
    ...prodDiscInProgress.docs.map((d) => ({ type: 'product-discovery' as const, id: d.id, status: d.status! })),
    ...prodDiscPending.docs.map((d) => ({ type: 'product-discovery' as const, id: d.id, status: d.status! })),
    ...crawlInProgress.docs.map((d) => ({ type: 'product-crawl' as const, id: d.id, status: d.status!, crawlType: d.type || 'all' })),
    ...crawlPending.docs.map((d) => ({ type: 'product-crawl' as const, id: d.id, status: d.status!, crawlType: d.type || 'all' })),
    ...aggInProgress.docs.map((d) => ({ type: 'product-aggregation' as const, id: d.id, status: d.status!, aggregationType: d.type || 'all' })),
    ...aggPending.docs.map((d) => ({ type: 'product-aggregation' as const, id: d.id, status: d.status!, aggregationType: d.type || 'all' })),
    ...videoDiscInProgress.docs.map((d) => ({ type: 'video-discovery' as const, id: d.id, status: d.status! })),
    ...videoDiscPending.docs.map((d) => ({ type: 'video-discovery' as const, id: d.id, status: d.status! })),
    ...videoProcInProgress.docs.map((d) => ({ type: 'video-processing' as const, id: d.id, status: d.status! })),
    ...videoProcPending.docs.map((d) => ({ type: 'video-processing' as const, id: d.id, status: d.status! })),
    ...catDiscInProgress.docs.map((d) => ({ type: 'category-discovery' as const, id: d.id, status: d.status! })),
    ...catDiscPending.docs.map((d) => ({ type: 'category-discovery' as const, id: d.id, status: d.status! })),
  )

  if (activeJobs.length === 0) {
    return Response.json({ message: 'No pending jobs' })
  }

  // Prioritize selected jobs, otherwise random
  const selectedTargetJobs = activeJobs.filter(
    (j) => (j.type === 'product-crawl' && (j.crawlType === 'selected_urls' || j.crawlType === 'from_discovery' || j.crawlType === 'selected_gtins')) ||
           (j.type === 'product-aggregation' && j.aggregationType === 'selected_gtins'),
  )
  const selected = selectedTargetJobs.length > 0
    ? selectedTargetJobs[0]
    : activeJobs[Math.floor(Math.random() * activeJobs.length)]

  if (selected.type === 'ingredients-discovery') {
    return processIngredientsDiscovery(payload, selected.id)
  } else if (selected.type === 'product-discovery') {
    return processProductDiscovery(payload, selected.id)
  } else if (selected.type === 'product-aggregation') {
    return processProductAggregation(payload, selected.id)
  } else if (selected.type === 'video-discovery') {
    return processVideoDiscovery(payload, selected.id)
  } else if (selected.type === 'video-processing') {
    return processVideoProcessing(payload, selected.id)
  } else if (selected.type === 'category-discovery') {
    return processCategoryDiscovery(payload, selected.id)
  } else {
    return processProductCrawl(payload, selected.id)
  }
}

async function processIngredientsDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
) {
  let discovery = await payload.findByID({
    collection: 'ingredients-discoveries',
    id: discoveryId,
  })

  const pagesPerTick = discovery.pagesPerTick ?? undefined
  let pagesProcessed = 0
  console.log(`[Ingredients Discovery] Starting with pagesPerTick: ${pagesPerTick ?? 'unlimited'}`)

  const driver = getIngredientsDriver(discovery.sourceUrl)
  if (!driver) {
    const errorMsg = `No driver found for URL: ${discovery.sourceUrl}`
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'ingredients-discoveries', discoveryId, errorMsg)
    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'ingredients-discovery',
    }, { status: 400 })
  }

  // Initialize if pending
  if (discovery.status === 'pending') {
    const termQueue = driver.getInitialTermQueue()
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discoveryId,
      data: {
        status: 'in_progress',
        termQueue,
        startedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'start', 'ingredients-discoveries', discoveryId, `Started ingredients discovery for ${discovery.sourceUrl}`)
    discovery = await payload.findByID({
      collection: 'ingredients-discoveries',
      id: discoveryId,
    })
  }

  // Get current state
  let termQueue: string[] = (discovery.termQueue as string[]) || []
  let currentTerm = discovery.currentTerm || null
  let currentPage = discovery.currentPage || 1
  let totalPagesForTerm = discovery.totalPagesForTerm || 0
  let discovered = discovery.discovered || 0
  let created = discovery.created || 0
  let existing = discovery.existing || 0
  let errors = discovery.errors || 0

  try {
    // Process until limit (if set) or completion
    while (true) {
      if (pagesPerTick && pagesProcessed >= pagesPerTick) {
        console.log(`[Ingredients Discovery] Stopping: pagesPerTick (${pagesPerTick}) reached`)
        break
      }
      // If no current term, get next from queue
      if (!currentTerm) {
        if (termQueue.length === 0) {
          // All done!
          await payload.update({
            collection: 'ingredients-discoveries',
            id: discoveryId,
            data: {
              status: 'completed',
              termQueue: [],
              currentTerm: null,
              currentPage: null,
              totalPagesForTerm: null,
              completedAt: new Date().toISOString(),
            },
          })
          await createEvent(payload, 'success', 'ingredients-discoveries', discoveryId, `Completed: ${discovered} discovered, ${created} created, ${existing} existing, ${errors} errors`)
          return Response.json({
            message: 'Discovery completed',
            jobId: discoveryId,
            type: 'ingredients-discovery',
            discovered,
            created,
            existing,
            errors,
          })
        }

        currentTerm = termQueue.shift()!
        currentPage = 1
        totalPagesForTerm = 0

        // Check term
        const checkResult = await driver.checkTerm(currentTerm)

        if (checkResult.split) {
          // Need to split into sub-terms
          termQueue = [...checkResult.subTerms, ...termQueue]
          currentTerm = null
          continue
        }

        totalPagesForTerm = checkResult.totalPages

        if (totalPagesForTerm === 0) {
          // No results for this term
          currentTerm = null
          continue
        }
      }

      // Process current page
      const stats = await driver.processPage(currentTerm, currentPage, payload)

      discovered += stats.discovered
      created += stats.created
      existing += stats.existing
      errors += stats.errors
      currentPage++
      pagesProcessed++

      // Save progress after each page
      await payload.update({
        collection: 'ingredients-discoveries',
        id: discoveryId,
        data: {
          termQueue,
          currentTerm,
          currentPage,
          totalPagesForTerm,
          discovered,
          created,
          existing,
          errors,
        },
      })

      // Check if term is done
      if (currentPage > totalPagesForTerm) {
        currentTerm = null
        currentPage = 1
        totalPagesForTerm = 0
      }
    }

    // Tick limit reached, save final state
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discoveryId,
      data: {
        termQueue,
        currentTerm,
        currentPage,
        totalPagesForTerm,
        discovered,
        created,
        existing,
        errors,
      },
    })

    return Response.json({
      message: 'Tick completed',
      jobId: discoveryId,
      type: 'ingredients-discovery',
      currentTerm,
      currentPage,
      totalPagesForTerm,
      termQueueLength: termQueue.length,
      discovered,
      created,
      existing,
      errors,
    })
  } catch (error) {
    console.error('Ingredients discovery error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'ingredients-discoveries', discoveryId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'ingredients-discovery',
    }, { status: 500 })
  }
}

interface ProductDiscoveryJobProgress {
  currentUrlIndex: number
  driverProgress: unknown | null
}

async function processProductDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
) {
  const discovery = await payload.findByID({
    collection: 'product-discoveries',
    id: discoveryId,
  })

  // Parse newline-separated URLs
  const sourceUrls = (discovery.sourceUrls ?? '').split('\n').map((u) => u.trim()).filter(Boolean)
  if (sourceUrls.length === 0) {
    await payload.update({
      collection: 'product-discoveries',
      id: discoveryId,
      data: { status: 'failed', completedAt: new Date().toISOString() },
    })
    await createEvent(payload, 'error', 'product-discoveries', discoveryId, 'No URLs provided')
    return Response.json({ error: 'No URLs provided', jobId: discoveryId, type: 'product-discovery' }, { status: 400 })
  }

  const maybeDriver = getSourceDriver(sourceUrls[0])
  if (!maybeDriver) {
    const errorMsg = `No driver found for URL: ${sourceUrls[0]}`
    await payload.update({
      collection: 'product-discoveries',
      id: discoveryId,
      data: { status: 'failed', completedAt: new Date().toISOString() },
    })
    await createEvent(payload, 'error', 'product-discoveries', discoveryId, errorMsg)
    return Response.json({ error: errorMsg, jobId: discoveryId, type: 'product-discovery' }, { status: 400 })
  }
  const driver: SourceDriver = maybeDriver

  // Mark as in_progress if pending
  if (discovery.status === 'pending') {
    await payload.update({
      collection: 'product-discoveries',
      id: discoveryId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        discovered: 0,
        created: 0,
        existing: 0,
      },
    })
    await createEvent(payload, 'start', 'product-discoveries', discoveryId, `Started product discovery for ${sourceUrls.length} URL(s)`)
  }

  // Restore or initialize progress cursor
  const rawProgress = discovery.progress as ProductDiscoveryJobProgress | null
  let currentUrlIndex = rawProgress?.currentUrlIndex ?? 0
  let driverProgress: unknown | null = rawProgress?.driverProgress ?? null

  // Local state — productUrls accumulate from textarea, seenProductUrls for within-tick dedup
  const productUrls: string[] = (discovery.productUrls ?? '').split('\n').filter(Boolean)
  const seenProductUrls = new Set<string>(productUrls)
  let created = discovery.created ?? 0
  let existing = discovery.existing ?? 0
  let discovered = discovery.discovered ?? 0

  const maxPages = discovery.itemsPerTick ?? undefined
  const delayMs = (discovery as unknown as Record<string, unknown>).delay as number | undefined ?? 2000

  console.log(`[Product Discovery] Job ${discoveryId}: urlIndex=${currentUrlIndex}, discovered=${discovered}, maxPages=${maxPages ?? 'unlimited'}, delay=${delayMs}ms`)

  // Save minimal progress cursor + counters
  async function saveProgress(currentDriverProgress: unknown | null): Promise<void> {
    await payload.update({
      collection: 'product-discoveries',
      id: discoveryId,
      data: {
        discovered,
        created,
        existing,
        progress: { currentUrlIndex, driverProgress: currentDriverProgress },
      },
    })
  }

  // onProgress callback: called by drivers after each page
  async function onProgress(dp: unknown): Promise<void> {
    driverProgress = dp
    await saveProgress(dp)
  }

  // onProduct callback: dedup, create/update SourceProduct, create DiscoveryResult
  async function onProduct(product: DiscoveredProduct): Promise<void> {
    if (seenProductUrls.has(product.productUrl)) return
    seenProductUrls.add(product.productUrl)
    productUrls.push(product.productUrl)
    discovered++

    const urlDriver: SourceDriver = getSourceDriver(product.productUrl) ?? driver

    const existingProduct = await payload.find({
      collection: 'source-products',
      where: { and: [
        { sourceUrl: { equals: product.productUrl } },
        { or: [{ source: { equals: urlDriver.slug } }, { source: { exists: false } }] },
      ] },
      limit: 1,
    })

    // Look up SourceCategory by URL
    let sourceCategoryId: number | null = null
    if (product.categoryUrl) {
      const catMatch = await payload.find({
        collection: 'source-categories',
        where: { and: [{ url: { equals: product.categoryUrl } }, { source: { equals: urlDriver.slug } }] },
        limit: 1,
      })
      if (catMatch.docs.length > 0) sourceCategoryId = catMatch.docs[0].id
    }

    const now = new Date().toISOString()
    const priceEntry = product.price != null ? {
      recordedAt: now,
      amount: product.price,
      currency: product.currency ?? 'EUR',
    } : null

    const discoveryData = {
      sourceUrl: product.productUrl,
      brandName: product.brandName,
      name: product.name,
      sourceCategory: sourceCategoryId,
      rating: product.rating,
      ratingNum: product.ratingCount,
      ...(product.gtin ? { gtin: product.gtin } : {}),
    }

    let sourceProductId: number
    if (existingProduct.docs.length === 0) {
      const newProduct = await payload.create({
        collection: 'source-products',
        data: {
          source: urlDriver.slug,
          status: 'uncrawled',
          ...discoveryData,
          priceHistory: priceEntry ? [priceEntry] : [],
        },
      })
      sourceProductId = newProduct.id
      created++
    } else {
      sourceProductId = existingProduct.docs[0].id
      const existingHistory = existingProduct.docs[0].priceHistory ?? []
      await payload.update({
        collection: 'source-products',
        id: sourceProductId,
        data: {
          source: urlDriver.slug,
          ...discoveryData,
          ...(priceEntry ? { priceHistory: [...existingHistory, priceEntry] } : {}),
        },
      })
      existing++
    }

    await payload.create({
      collection: 'discovery-results',
      data: { discovery: discoveryId, sourceProduct: sourceProductId },
    })
  }

  try {
    let pagesRemaining = maxPages

    while (currentUrlIndex < sourceUrls.length) {
      if (pagesRemaining !== undefined && pagesRemaining <= 0) break

      const url = sourceUrls[currentUrlIndex]
      const urlDriver = getSourceDriver(url) ?? driver

      const result = await urlDriver.discoverProducts({
        url,
        onProduct,
        onError: () => {},
        onProgress,
        progress: driverProgress ?? undefined,
        maxPages: pagesRemaining,
        delay: delayMs,
      })

      if (result.done) {
        // This URL is fully discovered — save immediately so progress survives crashes
        currentUrlIndex++
        driverProgress = null
        await saveProgress(null)
        if (pagesRemaining !== undefined) {
          pagesRemaining -= result.pagesUsed
        }
      } else {
        // Budget exhausted mid-URL
        break
      }
    }

    const allDone = currentUrlIndex >= sourceUrls.length

    if (allDone) {
      await payload.update({
        collection: 'product-discoveries',
        id: discoveryId,
        data: {
          status: 'completed',
          discovered,
          created,
          existing,
          productUrls: productUrls.length > 0 ? productUrls.join('\n') : null,
          progress: null,
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'product-discoveries', discoveryId, `Completed: ${discovered} discovered, ${created} created, ${existing} existing`)

      return Response.json({
        message: 'Discovery completed',
        jobId: discoveryId,
        type: 'product-discovery',
        discovered,
        created,
        existing,
      })
    } else {
      // Save final state
      await saveProgress(driverProgress)
      await createEvent(payload, 'info', 'product-discoveries', discoveryId, `Tick done: ${discovered} discovered so far, URL ${currentUrlIndex + 1}/${sourceUrls.length}`)

      return Response.json({
        message: 'Product discovery tick completed',
        jobId: discoveryId,
        type: 'product-discovery',
        discovered,
        created,
        existing,
        progress: true,
      })
    }
  } catch (error) {
    console.error('Product discovery error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)

    // Save progress even on failure so we can resume
    await saveProgress(driverProgress)
    await payload.update({
      collection: 'product-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'product-discoveries', discoveryId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'product-discovery',
    }, { status: 500 })
  }
}

async function processProductCrawl(
  payload: Awaited<ReturnType<typeof getPayload>>,
  crawlId: number,
) {
  let crawl = await payload.findByID({
    collection: 'product-crawls',
    id: crawlId,
  })

  const itemsPerTick = crawl.itemsPerTick ?? 10
  console.log(`[Product Crawl] Starting with itemsPerTick: ${itemsPerTick}`)

  // Initialize if pending
  const isFirstTick = crawl.status === 'pending'
  if (isFirstTick) {
    await payload.update({
      collection: 'product-crawls',
      id: crawlId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        crawled: 0,
        errors: 0,
      },
    })
    await createEvent(payload, 'start', 'product-crawls', crawlId, `Started product crawl (source=${crawl.source || 'all'}, type=${crawl.type || 'all'}, scope=${crawl.scope ?? 'uncrawled_only'})`)
    crawl = await payload.findByID({
      collection: 'product-crawls',
      id: crawlId,
    })
  }

  // Resolve drivers from crawl.source (default 'all' for backward compat with null)
  const resolvedSource = crawl.source || 'all'
  let drivers: SourceDriver[]

  if (resolvedSource === 'all') {
    drivers = getAllSourceDrivers()
  } else {
    const driver = getSourceDriverBySlug(resolvedSource)
    if (!driver) {
      await payload.update({
        collection: 'product-crawls',
        id: crawlId,
        data: { status: 'failed', completedAt: new Date().toISOString() },
      })
      await createEvent(payload, 'error', 'product-crawls', crawlId, `No driver found for source: ${resolvedSource}`)
      return Response.json({
        error: `No driver found for source: ${resolvedSource}`,
        jobId: crawlId,
        type: 'product-crawl',
      }, { status: 400 })
    }
    drivers = [driver]
  }

  // Parse URLs for selected_urls / from_discovery mode
  const isSelectedUrls = crawl.type === 'selected_urls'
  const isFromDiscovery = crawl.type === 'from_discovery'
  const isSelectedGtins = crawl.type === 'selected_gtins'

  let urlList: string[] | undefined
  if (isSelectedUrls) {
    urlList = (crawl.urls || '').split('\n').map((u) => u.trim()).filter(Boolean)
  } else if (isFromDiscovery && crawl.discovery) {
    const discoveryId = typeof crawl.discovery === 'object' ? crawl.discovery.id : crawl.discovery
    const discovery = await payload.findByID({ collection: 'product-discoveries', id: discoveryId })
    urlList = (discovery.productUrls || '').split('\n').map((u) => u.trim()).filter(Boolean)
  } else if (isSelectedGtins) {
    const gtinList = ((crawl as unknown as Record<string, unknown>).gtins as string || '')
      .split('\n').map((g) => g.trim()).filter(Boolean)
    if (gtinList.length > 0) {
      const sourceProducts = await payload.find({
        collection: 'source-products',
        where: { gtin: { in: gtinList.join(',') } },
        limit: 10000,
      })
      urlList = sourceProducts.docs.map((doc) => doc.sourceUrl).filter(Boolean) as string[]
    }
  }

  const hasUrlList = !!urlList

  // Read scope and minimum crawl age settings
  const scope = crawl.scope ?? 'uncrawled_only'
  const minCrawlAge = crawl.minCrawlAge
  const minCrawlAgeUnit = crawl.minCrawlAgeUnit

  console.log(`[Product Crawl] id=${crawlId}, source=${resolvedSource}, type=${crawl.type}, scope=${scope}, drivers=[${drivers.map((d) => d.slug).join(', ')}], isFirstTick=${isFirstTick}, urls=${urlList ? urlList.join(',') : 'all'}`)

  if (hasUrlList && (!urlList || urlList.length === 0)) {
    await payload.update({
      collection: 'product-crawls',
      id: crawlId,
      data: { status: 'completed', completedAt: new Date().toISOString() },
    })
    return Response.json({
      message: 'Crawl completed - no URLs specified',
      jobId: crawlId,
      type: 'product-crawl',
    })
  }

  // On first tick for selected_urls/from_discovery, auto-create SourceProduct stubs for URLs that don't exist yet
  if (isFirstTick && (isSelectedUrls || isFromDiscovery) && urlList) {
    let stubsCreated = 0
    for (const url of urlList) {
      const urlDriver = getSourceDriver(url)
      if (!urlDriver) continue
      const exists = await payload.find({
        collection: 'source-products',
        where: { sourceUrl: { equals: url } },
        limit: 1,
      })
      if (exists.docs.length === 0) {
        await payload.create({
          collection: 'source-products',
          data: { sourceUrl: url, source: urlDriver.slug, status: 'uncrawled' },
        })
        stubsCreated++
      }
    }
    if (stubsCreated > 0) {
      console.log(`[Product Crawl] Created ${stubsCreated} SourceProduct stub(s) for selected URLs`)
    }
  }

  // On first tick, reset products to uncrawled if scope includes re-crawl
  if (isFirstTick && scope === 'recrawl') {
    let crawledBefore: Date | undefined
    if (minCrawlAge && minCrawlAgeUnit) {
      const multipliers: Record<string, number> = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 }
      crawledBefore = new Date(Date.now() - minCrawlAge * (multipliers[minCrawlAgeUnit] ?? 86400000))
      console.log(`[Product Crawl] Re-crawl with minCrawlAge: ${minCrawlAge} ${minCrawlAgeUnit} (crawledBefore: ${crawledBefore.toISOString()})`)
    }
    for (const driver of drivers) {
      await driver.resetProducts(payload, urlList, crawledBefore)
    }
    console.log(`[Product Crawl] Reset products to uncrawled`)
  }

  // Count total on first tick
  if (isFirstTick) {
    let totalUncrawled = 0
    for (const driver of drivers) {
      totalUncrawled += await driver.countUncrawled(payload, urlList ? { sourceUrls: urlList } : undefined)
    }
    await payload.update({
      collection: 'product-crawls',
      id: crawlId,
      data: { total: totalUncrawled },
    })
    console.log(`[Product Crawl] Total products to crawl: ${totalUncrawled}`)
  }

  let crawled = crawl.crawled || 0
  let errors = crawl.errors || 0
  let processedThisTick = 0
  let remainingBudget = itemsPerTick

  try {
    for (const driver of drivers) {
      if (remainingBudget <= 0) break

      const products = await driver.findUncrawledProducts(payload, {
        sourceUrls: urlList,
        limit: remainingBudget,
      })

      if (products.length === 0) {
        console.log(`[Product Crawl] [${driver.slug}] No uncrawled products found, skipping`)
        continue
      }

      console.log(`[Product Crawl] [${driver.slug}] Found ${products.length} uncrawled products: ${products.map((p) => p.sourceUrl).join(', ')}`)

      for (const product of products) {
        const productId = await driver.crawlProduct(
          product.sourceUrl,
          payload,
          { debug: crawl.debug ?? false },
        )

        if (productId !== null) {
          await driver.markProductStatus(payload, product.id, 'crawled')
          await payload.create({
            collection: 'crawl-results',
            data: { crawl: crawlId, sourceProduct: productId },
          })
          crawled++
          console.log(`[Product Crawl] [${driver.slug}] Crawled ${product.sourceUrl} -> source-product #${productId}`)
        } else {
          await driver.markProductStatus(payload, product.id, 'failed')
          await payload.create({
            collection: 'crawl-results',
            data: { crawl: crawlId, sourceProduct: product.id, error: `Failed to crawl ${product.sourceUrl}` },
          })
          errors++
          console.log(`[Product Crawl] [${driver.slug}] Failed to crawl ${product.sourceUrl}`)
        }

        processedThisTick++
        remainingBudget--

        await payload.update({
          collection: 'product-crawls',
          id: crawlId,
          data: { crawled, errors },
        })
      }
    }

    // Check completion: sum uncrawled across all drivers
    let totalRemaining = 0
    for (const driver of drivers) {
      totalRemaining += await driver.countUncrawled(payload, urlList ? { sourceUrls: urlList } : undefined)
    }

    if (totalRemaining === 0) {
      await payload.update({
        collection: 'product-crawls',
        id: crawlId,
        data: {
          status: 'completed',
          crawled,
          errors,
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'product-crawls', crawlId, `Completed: ${crawled} crawled, ${errors} errors`)

      return Response.json({
        message: 'Crawl completed',
        jobId: crawlId,
        type: 'product-crawl',
        crawled,
        errors,
      })
    }

    await createEvent(payload, 'info', 'product-crawls', crawlId, `Tick: ${processedThisTick} processed (${crawled} crawled, ${errors} errors, ${totalRemaining} remaining)`)

    return Response.json({
      message: 'Tick completed',
      jobId: crawlId,
      type: 'product-crawl',
      processedThisTick,
      crawled,
      errors,
      remaining: totalRemaining,
    })
  } catch (error) {
    console.error('Product crawl error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'product-crawls',
      id: crawlId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'product-crawls', crawlId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId: crawlId,
      type: 'product-crawl',
    }, { status: 500 })
  }
}

async function processProductAggregation(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobId: number,
) {
  let job = await payload.findByID({
    collection: 'product-aggregations',
    id: jobId,
  })

  const itemsPerTick = job.itemsPerTick ?? 10
  console.log(`[Product Aggregation] Starting with itemsPerTick: ${itemsPerTick}`)

  // Initialize if pending
  if (job.status === 'pending') {
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        aggregated: 0,
        errors: 0,
        tokensUsed: 0,
      },
    })
    await createEvent(payload, 'start', 'product-aggregations', jobId, `Started product aggregation (type=${job.type || 'all'})`)
    job = await payload.findByID({
      collection: 'product-aggregations',
      id: jobId,
    })
  }

  // Branch based on type
  if (job.type === 'selected_gtins') {
    return processProductAggregationSelectedGtins(payload, jobId, job)
  }

  // Count total crawled source products on first tick
  if (!job.total) {
    const totalCount = await payload.count({
      collection: 'source-products',
      where: { status: { equals: 'crawled' } },
    })
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: { total: totalCount.totalDocs },
    })
    console.log(`[Product Aggregation] Total source products to check: ${totalCount.totalDocs}`)
  }

  // Default: aggregate all non-aggregated products
  const lastCheckedSourceId = job.lastCheckedSourceId || 0
  let aggregated = job.aggregated || 0
  let errors = job.errors || 0
  let tokensUsed = job.tokensUsed || 0

  try {
    // Query source products where status='crawled' AND id > lastCheckedSourceId
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
      // No more sources to check
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'product-aggregations', jobId, `Completed: ${aggregated} aggregated, ${errors} errors`)
      return Response.json({
        message: 'Aggregation completed - no more sources to process',
        jobId,
        type: 'product-aggregation',
        aggregated,
        errors,
      })
    }

    let processedAggregations = 0
    let lastId = lastCheckedSourceId

    for (const sourceProduct of sourceProducts.docs) {
      if (processedAggregations >= itemsPerTick) break

      lastId = sourceProduct.id

      if (!sourceProduct.gtin) {
        continue
      }

      // Find all crawled source products with this GTIN
      const allSourcesForGtin = await payload.find({
        collection: 'source-products',
        where: {
          and: [
            { gtin: { equals: sourceProduct.gtin } },
            { status: { equals: 'crawled' } },
          ],
        },
        limit: 100,
      })

      // Find or create Product
      const existingProducts = await payload.find({
        collection: 'products',
        where: { gtin: { equals: sourceProduct.gtin } },
        limit: 1,
      })

      let productId: number
      if (existingProducts.docs.length > 0) {
        productId = existingProducts.docs[0].id
      } else {
        const newProduct = await payload.create({
          collection: 'products',
          data: {
            gtin: sourceProduct.gtin,
            name: sourceProduct.name || undefined,
          },
        })
        productId = newProduct.id
      }

      // Run per-GTIN aggregation logic with ALL source products
      const result = await aggregateProduct(payload, productId, allSourcesForGtin.docs, job.language || 'de')
      processedAggregations++
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        aggregated++
        if (result.warning) {
          await createEvent(payload, 'warning', 'product-aggregations', jobId, `GTIN ${sourceProduct.gtin}: ${result.warning}`)
        }
      } else {
        errors++
        await createEvent(payload, 'error', 'product-aggregations', jobId, `GTIN ${sourceProduct.gtin}: ${result.error}`)
      }

      // Update progress
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { aggregated, errors, tokensUsed, product: productId, lastCheckedSourceId: lastId },
      })
    }

    // Update lastCheckedSourceId even if we just skipped
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: { lastCheckedSourceId: lastId },
    })

    return Response.json({
      message: 'Tick completed',
      jobId,
      type: 'product-aggregation',
      processedAggregations,
      aggregated,
      errors,
    })
  } catch (error) {
    console.error('Product aggregation error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'product-aggregations', jobId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId,
      type: 'product-aggregation',
    }, { status: 500 })
  }
}

async function processProductAggregationSelectedGtins(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobId: number,
  job: { aggregated?: number | null; errors?: number | null; tokensUsed?: number | null; gtins?: string | null; language?: string | null },
) {
  const gtinList = (job.gtins || '').split('\n').map((g) => g.trim()).filter(Boolean)

  console.log(`[Product Aggregation] Selected GTINs mode: ${gtinList.length} GTINs`)

  await payload.update({
    collection: 'product-aggregations',
    id: jobId,
    data: { total: gtinList.length },
  })

  if (gtinList.length === 0) {
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      message: 'Aggregation completed - no GTINs specified',
      jobId,
      type: 'product-aggregation',
    })
  }

  let aggregated = job.aggregated || 0
  let errors = job.errors || 0
  let tokensUsed = job.tokensUsed || 0

  try {
    for (const gtin of gtinList) {
      // Find ALL crawled source products with this GTIN
      const allSourcesForGtin = await payload.find({
        collection: 'source-products',
        where: {
          and: [
            { gtin: { equals: gtin } },
            { status: { equals: 'crawled' } },
          ],
        },
        limit: 100,
      })

      if (allSourcesForGtin.docs.length === 0) {
        // No source found, create warning event
        await payload.create({
          collection: 'events',
          data: {
            type: 'warning',
            message: `No crawled source product found for GTIN ${gtin}`,
            job: { relationTo: 'product-aggregations', value: jobId },
          },
        })
        errors++
        continue
      }

      // Find or create Product
      const existingProducts = await payload.find({
        collection: 'products',
        where: { gtin: { equals: gtin } },
        limit: 1,
      })

      let productId: number
      if (existingProducts.docs.length > 0) {
        productId = existingProducts.docs[0].id
      } else {
        const newProduct = await payload.create({
          collection: 'products',
          data: {
            gtin,
            name: allSourcesForGtin.docs[0].name || undefined,
          },
        })
        productId = newProduct.id
      }

      // Run per-GTIN aggregation logic with ALL source products
      const result = await aggregateProduct(payload, productId, allSourcesForGtin.docs, job.language || 'de')
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        aggregated++
        if (result.warning) {
          await createEvent(payload, 'warning', 'product-aggregations', jobId, `GTIN ${gtin}: ${result.warning}`)
        }
      } else {
        errors++
        await createEvent(payload, 'error', 'product-aggregations', jobId, `GTIN ${gtin}: ${result.error}`)
      }

      // Update progress
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { aggregated, errors, tokensUsed, product: productId },
      })
    }

    // All GTINs processed
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'success', 'product-aggregations', jobId, `Completed: ${aggregated} aggregated, ${errors} errors`)

    return Response.json({
      message: 'Aggregation completed',
      jobId,
      type: 'product-aggregation',
      aggregated,
      errors,
    })
  } catch (error) {
    console.error('Product aggregation (selected GTINs) error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'product-aggregations', jobId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId,
      type: 'product-aggregation',
    }, { status: 500 })
  }
}

async function processVideoDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobId: number,
) {
  const discovery = await payload.findByID({
    collection: 'video-discoveries',
    id: jobId,
  })

  const itemsPerTick = discovery.itemsPerTick ?? undefined
  console.log(`[Video Discovery] Starting with itemsPerTick: ${itemsPerTick ?? 'unlimited'}`)

  const driver = getVideoDriver(discovery.channelUrl)
  if (!driver) {
    const errorMsg = `No video driver found for URL: ${discovery.channelUrl}`
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'video-discoveries', jobId, errorMsg)
    return Response.json({
      error: errorMsg,
      jobId,
      type: 'video-discovery',
    }, { status: 400 })
  }

  // Mark as in_progress if pending
  if (discovery.status === 'pending') {
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        discovered: 0,
        created: 0,
        existing: 0,
      },
    })
    await createEvent(payload, 'start', 'video-discoveries', jobId, `Started video discovery for ${discovery.channelUrl}`)
  }

  try {
    // Discover all videos via driver
    const videos = await driver.discoverVideos(discovery.channelUrl)

    // Update discovered count
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: { discovered: videos.length },
    })

    // Find or create the channel
    const channelUrl = videos[0]?.channelUrl || discovery.channelUrl
    const channelName = videos[0]?.channelName

    let existingChannel = await payload.find({
      collection: 'channels',
      where: { externalUrl: { equals: channelUrl } },
      limit: 1,
    })

    let channelId: number
    if (existingChannel.docs.length > 0) {
      channelId = existingChannel.docs[0].id
    } else {
      // Find or create creator from channel name
      const creatorName = channelName || channelUrl
      const existingCreator = await payload.find({
        collection: 'creators',
        where: { name: { equals: creatorName } },
        limit: 1,
      })
      let creatorId: number
      if (existingCreator.docs.length > 0) {
        creatorId = existingCreator.docs[0].id
      } else {
        const newCreator = await payload.create({
          collection: 'creators',
          data: { name: creatorName },
        })
        creatorId = newCreator.id
      }

      const newChannel = await payload.create({
        collection: 'channels',
        data: {
          creator: creatorId,
          platform: driver.slug as 'youtube' | 'instagram' | 'tiktok',
          externalUrl: channelUrl,
        },
      })
      channelId = newChannel.id
    }

    // Calculate offset from already-processed count
    let created = discovery.created || 0
    let existing = discovery.existing || 0
    const offset = created + existing

    // Determine slice to process this tick
    const end = itemsPerTick ? Math.min(offset + itemsPerTick, videos.length) : videos.length
    const batch = videos.slice(offset, end)

    for (const video of batch) {
      const existingVideo = await payload.find({
        collection: 'videos',
        where: { externalUrl: { equals: video.externalUrl } },
        limit: 1,
      })

      const publishedAt = video.timestamp
        ? new Date(video.timestamp * 1000).toISOString()
        : video.uploadDate
          ? `${video.uploadDate}T00:00:00.000Z`
          : undefined

      // Download and upload thumbnail if available and video doesn't already have one
      const existingHasImage = existingVideo.docs.length > 0 && existingVideo.docs[0].image
      let imageId: number | undefined
      if (video.thumbnailUrl && !existingHasImage) {
        try {
          console.log(`[Video Discovery] Downloading thumbnail for "${video.title}"`)
          const res = await fetch(video.thumbnailUrl)
          if (res.ok) {
            const buffer = Buffer.from(await res.arrayBuffer())
            const ext = video.thumbnailUrl.includes('.webp') ? 'webp' : 'jpg'
            const mimetype = ext === 'webp' ? 'image/webp' : 'image/jpeg'
            const media = await payload.create({
              collection: 'media',
              data: { alt: video.title },
              file: {
                data: buffer,
                mimetype,
                name: `${video.externalId}.${ext}`,
                size: buffer.length,
              },
            })
            imageId = media.id
            console.log(`[Video Discovery] Uploaded thumbnail as media #${imageId}`)
          }
        } catch (e) {
          console.warn(`[Video Discovery] Failed to download thumbnail: ${e}`)
        }
      } else if (existingHasImage) {
        console.log(`[Video Discovery] Skipping thumbnail for "${video.title}" (already has image)`)
      }

      if (existingVideo.docs.length === 0) {
        await payload.create({
          collection: 'videos',
          data: {
            channel: channelId,
            title: video.title,
            externalUrl: video.externalUrl,
            publishedAt,
            duration: video.duration ?? undefined,
            viewCount: video.viewCount ?? undefined,
            likeCount: video.likeCount ?? undefined,
            ...(imageId ? { image: imageId } : {}),
          },
        })
        created++
      } else {
        await payload.update({
          collection: 'videos',
          id: existingVideo.docs[0].id,
          data: {
            title: video.title,
            channel: channelId,
            publishedAt,
            duration: video.duration ?? undefined,
            viewCount: video.viewCount ?? undefined,
            likeCount: video.likeCount ?? undefined,
            ...(imageId ? { image: imageId } : {}),
          },
        })
        existing++
      }

      // Update stats after each video
      await payload.update({
        collection: 'video-discoveries',
        id: jobId,
        data: { created, existing },
      })
    }

    // Check if all videos processed
    if (created + existing >= videos.length) {
      await payload.update({
        collection: 'video-discoveries',
        id: jobId,
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'video-discoveries', jobId, `Completed: ${videos.length} discovered, ${created} created, ${existing} existing`)

      return Response.json({
        message: 'Video discovery completed',
        jobId,
        type: 'video-discovery',
        discovered: videos.length,
        created,
        existing,
      })
    }

    // More videos remaining, stay in_progress
    return Response.json({
      message: 'Tick completed',
      jobId,
      type: 'video-discovery',
      discovered: videos.length,
      created,
      existing,
      remaining: videos.length - (created + existing),
    })
  } catch (error) {
    console.error('Video discovery error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'video-discoveries',
      id: jobId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'video-discoveries', jobId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId,
      type: 'video-discovery',
    }, { status: 500 })
  }
}

async function processVideoProcessing(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobId: number,
) {
  let job = await payload.findByID({
    collection: 'video-processings',
    id: jobId,
  })

  const itemsPerTick = job.itemsPerTick ?? 1
  const sceneThreshold = job.sceneThreshold ?? 0.4
  const clusterThreshold = job.clusterThreshold ?? 25
  console.log(`[Video Processing] Starting job #${jobId} with itemsPerTick: ${itemsPerTick}, sceneThreshold: ${sceneThreshold}, clusterThreshold: ${clusterThreshold}`)

  // Initialize if pending
  if (job.status === 'pending') {
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        processed: 0,
        errors: 0,
        tokensUsed: 0,
      },
    })
    await createEvent(payload, 'start', 'video-processings', jobId, `Started video processing (type=${job.type || 'all_unprocessed'})`)
    job = await payload.findByID({
      collection: 'video-processings',
      id: jobId,
    })
  }

  // Set total on first tick (selected_urls sets its own total after resolving)
  if (!job.total) {
    if (job.type === 'single_video') {
      await payload.update({ collection: 'video-processings', id: jobId, data: { total: 1 } })
    } else if (job.type === 'all_unprocessed') {
      const totalCount = await payload.count({
        collection: 'videos',
        where: { and: [{ processingStatus: { equals: 'unprocessed' } }, { externalUrl: { exists: true } }] },
      })
      await payload.update({ collection: 'video-processings', id: jobId, data: { total: totalCount.totalDocs } })
      console.log(`[Video Processing] Total unprocessed videos: ${totalCount.totalDocs}`)
    }
  }

  let processed = job.processed || 0
  let errors = job.errors || 0
  let tokensUsed = job.tokensUsed || 0

  try {
    if (job.type === 'single_video') {
      // Process a single video
      const videoId = typeof job.video === 'object' && job.video !== null ? job.video.id : job.video
      if (!videoId) {
        await payload.update({
          collection: 'video-processings',
          id: jobId,
          data: { status: 'failed', completedAt: new Date().toISOString() },
        })
        await createEvent(payload, 'error', 'video-processings', jobId, 'No video specified for single_video mode')
        return Response.json({ error: 'No video specified', jobId, type: 'video-processing' }, { status: 400 })
      }

      console.log(`[Video Processing] Single video mode: video #${videoId}`)
      const result = await processVideo(payload, videoId as number, sceneThreshold, clusterThreshold, jobId)
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        processed++
        await createEvent(payload, 'success', 'video-processings', jobId, `Video #${videoId}: ${result.segmentsCreated} segments, ${result.screenshotsCreated} screenshots`)
      } else {
        errors++
        await createEvent(payload, 'error', 'video-processings', jobId, `Video #${videoId}: ${result.error}`)
      }

      await payload.update({
        collection: 'video-processings',
        id: jobId,
        data: {
          status: 'completed',
          processed,
          errors,
          tokensUsed,
          completedAt: new Date().toISOString(),
        },
      })

      return Response.json({
        message: 'Video processing completed',
        jobId,
        type: 'video-processing',
        processed,
        errors,
      })
    }

    if (job.type === 'selected_urls') {
      // Resolve URLs to video IDs
      const urlList = (job.urls || '').split('\n').map((u) => u.trim()).filter(Boolean)
      console.log(`[Video Processing] Selected URLs mode: ${urlList.length} URLs`)

      // Separate video URLs from channel URLs by looking up channels first
      const videoIds: number[] = []

      for (const url of urlList) {
        // Try to find as a video
        const videoResult = await payload.find({
          collection: 'videos',
          where: { externalUrl: { equals: url } },
          limit: 1,
        })

        if (videoResult.docs.length > 0) {
          videoIds.push(videoResult.docs[0].id)
          continue
        }

        // Try to find as a channel and collect all its videos
        const channelResult = await payload.find({
          collection: 'channels',
          where: { externalUrl: { equals: url } },
          limit: 1,
        })

        if (channelResult.docs.length > 0) {
          const channelVideos = await payload.find({
            collection: 'videos',
            where: { channel: { equals: channelResult.docs[0].id } },
            limit: 1000,
            sort: 'createdAt',
          })
          for (const v of channelVideos.docs) {
            videoIds.push(v.id)
          }
          console.log(`[Video Processing] Channel "${url}" → ${channelVideos.docs.length} videos`)
          continue
        }

        await createEvent(payload, 'warning', 'video-processings', jobId, `URL not found as video or channel: ${url}`)
      }

      // Deduplicate
      const uniqueVideoIds = [...new Set(videoIds)]
      console.log(`[Video Processing] Resolved to ${uniqueVideoIds.length} unique videos`)

      await payload.update({
        collection: 'video-processings',
        id: jobId,
        data: { total: uniqueVideoIds.length },
      })

      // Process up to itemsPerTick, track which have been done via processed + errors count
      const alreadyDone = processed + errors
      const batch = uniqueVideoIds.slice(alreadyDone, alreadyDone + itemsPerTick)

      if (batch.length === 0) {
        await payload.update({
          collection: 'video-processings',
          id: jobId,
          data: { status: 'completed', completedAt: new Date().toISOString() },
        })
        await createEvent(payload, 'success', 'video-processings', jobId, `Completed: ${processed} processed, ${errors} errors`)
        return Response.json({ message: 'Video processing completed', jobId, type: 'video-processing', processed, errors })
      }

      for (const videoId of batch) {
        console.log(`[Video Processing] Processing video #${videoId}`)
        const result = await processVideo(payload, videoId, sceneThreshold, clusterThreshold, jobId)
        tokensUsed += result.tokensUsed ?? 0

        if (result.success) {
          processed++
          await createEvent(payload, 'info', 'video-processings', jobId, `Video #${videoId}: ${result.segmentsCreated} segments, ${result.screenshotsCreated} screenshots`)
        } else {
          errors++
          await createEvent(payload, 'error', 'video-processings', jobId, `Video #${videoId}: ${result.error}`)
        }

        await payload.update({
          collection: 'video-processings',
          id: jobId,
          data: { processed, errors, tokensUsed },
        })
      }

      if (processed + errors >= uniqueVideoIds.length) {
        await payload.update({
          collection: 'video-processings',
          id: jobId,
          data: { status: 'completed', completedAt: new Date().toISOString() },
        })
        await createEvent(payload, 'success', 'video-processings', jobId, `Completed: ${processed} processed, ${errors} errors`)
        return Response.json({ message: 'Video processing completed', jobId, type: 'video-processing', processed, errors })
      }

      return Response.json({
        message: 'Tick completed',
        jobId,
        type: 'video-processing',
        processed,
        errors,
        remaining: uniqueVideoIds.length - processed - errors,
      })
    }

    // Default: all_unprocessed mode
    console.log(`[Video Processing] All unprocessed mode, fetching up to ${itemsPerTick} videos`)

    const unprocessedVideos = await payload.find({
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

    console.log(`[Video Processing] Found ${unprocessedVideos.docs.length} unprocessed videos`)

    if (unprocessedVideos.docs.length === 0) {
      await payload.update({
        collection: 'video-processings',
        id: jobId,
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'video-processings', jobId, `Completed: ${processed} processed, ${errors} errors`)
      return Response.json({
        message: 'Video processing completed - no more unprocessed videos',
        jobId,
        type: 'video-processing',
        processed,
        errors,
      })
    }

    for (const video of unprocessedVideos.docs) {
      console.log(`[Video Processing] Processing video #${video.id}: "${video.title}"`)

      const result = await processVideo(payload, video.id, sceneThreshold, clusterThreshold, jobId)
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        processed++
        await createEvent(payload, 'info', 'video-processings', jobId, `Video #${video.id} "${video.title}": ${result.segmentsCreated} segments, ${result.screenshotsCreated} screenshots`)
      } else {
        errors++
        await createEvent(payload, 'error', 'video-processings', jobId, `Video #${video.id} "${video.title}": ${result.error}`)
      }

      await payload.update({
        collection: 'video-processings',
        id: jobId,
        data: { processed, errors, tokensUsed },
      })
    }

    // Check if there are more unprocessed videos
    const remaining = await payload.count({
      collection: 'videos',
      where: {
        and: [
          { processingStatus: { equals: 'unprocessed' } },
          { externalUrl: { exists: true } },
        ],
      },
    })

    if (remaining.totalDocs === 0) {
      await payload.update({
        collection: 'video-processings',
        id: jobId,
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'video-processings', jobId, `Completed: ${processed} processed, ${errors} errors`)

      return Response.json({
        message: 'Video processing completed',
        jobId,
        type: 'video-processing',
        processed,
        errors,
      })
    }

    return Response.json({
      message: 'Tick completed',
      jobId,
      type: 'video-processing',
      processed,
      errors,
      remaining: remaining.totalDocs,
    })
  } catch (error) {
    console.error('Video processing error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'video-processings',
      id: jobId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'video-processings', jobId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId,
      type: 'video-processing',
    }, { status: 500 })
  }
}

interface CategoryDiscoveryProgress {
  currentUrlIndex: number
  driverProgress: DriverProgress | null
  pathToId: Record<string, number>
}

async function processCategoryDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobId: number,
) {
  const discovery = await payload.findByID({
    collection: 'category-discoveries',
    id: jobId,
  })

  // Parse newline-separated URLs
  const storeUrls = (discovery.storeUrls ?? '').split('\n').map((u) => u.trim()).filter(Boolean)
  if (storeUrls.length === 0) {
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: { status: 'failed', completedAt: new Date().toISOString() },
    })
    await createEvent(payload, 'error', 'category-discoveries', jobId, 'No URLs provided')
    return Response.json({ error: 'No URLs provided', jobId, type: 'category-discovery' }, { status: 400 })
  }

  const driver = getCategoryDriver(storeUrls[0])
  if (!driver) {
    const errorMsg = `No category discovery driver found for URL: ${storeUrls[0]}`
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: { status: 'failed', completedAt: new Date().toISOString() },
    })
    await createEvent(payload, 'error', 'category-discoveries', jobId, errorMsg)
    return Response.json({ error: errorMsg, jobId, type: 'category-discovery' }, { status: 400 })
  }

  // Mark as in_progress
  if (discovery.status === 'pending') {
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        discovered: 0,
        created: 0,
        existing: 0,
      },
    })
    await createEvent(payload, 'start', 'category-discoveries', jobId, `Started category discovery for ${storeUrls.length} URL(s)`)
  }

  // Restore or initialize progress cursor
  const rawProgress = discovery.progress as CategoryDiscoveryProgress | null
  let currentUrlIndex = rawProgress?.currentUrlIndex ?? 0
  let driverProgress: DriverProgress | null = rawProgress?.driverProgress ?? null
  const pathToId = new Map<string, number>(Object.entries(rawProgress?.pathToId ?? {}).map(([k, v]) => [k, v]))

  // Local state — categoryUrls/errorUrls from textareas, seenUrls for within-tick dedup
  const categoryUrls: string[] = (discovery.categoryUrls ?? '').split('\n').filter(Boolean)
  const errorUrls: string[] = (discovery.errorUrls ?? '').split('\n').filter(Boolean)
  const seenUrls = new Set<string>(categoryUrls)
  let created = discovery.created ?? 0
  let existing = discovery.existing ?? 0
  let discovered = discovery.discovered ?? 0

  const source = driver.slug as 'dm' | 'mueller' | 'rossmann'
  const maxPages = discovery.itemsPerTick ?? undefined

  console.log(`[Category Discovery] Job ${jobId}: urlIndex=${currentUrlIndex}, discovered=${discovered}, queue=${driverProgress?.queue?.length ?? 0}, maxPages=${maxPages ?? 'unlimited'}`)

  // Derive slug from URL path
  function deriveSlug(cat: DiscoveredCategory): string {
    let slug = cat.name.toLowerCase().replace(/\s+/g, '-')
    try {
      const urlPath = new URL(cat.url).pathname
      const segments = urlPath.split('/').filter(Boolean)
      const meaningful = segments.filter((s) => s !== 'c' && s !== 'de' && !/^olcat\d/.test(s))
      if (meaningful.length > 0) {
        slug = meaningful[meaningful.length - 1]
      }
    } catch { /* use name-derived slug */ }
    return slug
  }

  // Save minimal progress cursor + counters
  async function saveProgress(currentDriverProgress: DriverProgress | null): Promise<void> {
    const progressState: CategoryDiscoveryProgress = {
      currentUrlIndex,
      driverProgress: currentDriverProgress,
      pathToId: Object.fromEntries(pathToId),
    }
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: {
        discovered,
        created,
        existing,
        progress: JSON.parse(JSON.stringify(progressState)),
      },
    })
  }

  // onProgress callback: called by drivers after each page, persists full state
  async function onProgress(dp: DriverProgress): Promise<void> {
    driverProgress = dp
    await saveProgress(dp)
  }

  // onCategory callback: saves each SourceCategory immediately
  async function onCategory(cat: DiscoveredCategory): Promise<void> {
    if (seenUrls.has(cat.url)) return
    seenUrls.add(cat.url)
    categoryUrls.push(cat.url)
    discovered++

    const parentPathParts = cat.path.slice(0, -1)
    const parentKey = parentPathParts.join(' > ')
    const parentId = parentKey ? (pathToId.get(parentKey) ?? null) : null
    const slug = deriveSlug(cat)
    const currentKey = cat.path.join(' > ')

    const existingCat = await payload.find({
      collection: 'source-categories',
      where: {
        and: [
          { slug: { equals: slug } },
          { source: { equals: source } },
          parentId
            ? { parent: { equals: parentId } }
            : { parent: { exists: false } },
        ],
      },
      limit: 1,
    })

    if (existingCat.docs.length > 0) {
      existing++
      if (existingCat.docs[0].url !== cat.url) {
        await payload.update({
          collection: 'source-categories',
          id: existingCat.docs[0].id,
          data: { url: cat.url, name: cat.name },
        })
      }
      pathToId.set(currentKey, existingCat.docs[0].id)
    } else {
      const newCat = await payload.create({
        collection: 'source-categories',
        data: {
          name: cat.name,
          slug,
          source,
          url: cat.url,
          ...(parentId ? { parent: parentId } : {}),
        },
      })
      created++
      pathToId.set(currentKey, newCat.id)
    }
  }

  try {
    let pagesRemaining = maxPages

    while (currentUrlIndex < storeUrls.length) {
      if (pagesRemaining !== undefined && pagesRemaining <= 0) break

      const url = storeUrls[currentUrlIndex]
      const urlDriver = getCategoryDriver(url) ?? driver

      // Capture visited count before the call (onProgress updates driverProgress during execution)
      const prevVisited = driverProgress?.visitedUrls?.length ?? 0

      const result = await urlDriver.discoverCategories({
        url,
        onCategory,
        onError: (failedUrl: string) => { errorUrls.push(failedUrl) },
        onProgress,
        progress: driverProgress ?? undefined,
        maxPages: pagesRemaining,
      })

      const pagesUsed = result.visitedUrls.length - prevVisited

      if (result.queue.length === 0) {
        // This URL is fully discovered — save immediately so progress survives crashes
        currentUrlIndex++
        driverProgress = null
        await saveProgress(null)
        if (pagesRemaining !== undefined) {
          pagesRemaining -= pagesUsed
        }
      } else {
        // Budget exhausted mid-URL, save driver progress for next tick
        driverProgress = result
        break
      }
    }

    const allDone = currentUrlIndex >= storeUrls.length

    if (allDone) {
      await payload.update({
        collection: 'category-discoveries',
        id: jobId,
        data: {
          status: 'completed',
          discovered,
          created,
          existing,
          categoryUrls: categoryUrls.join('\n'),
          errorUrls: errorUrls.length > 0 ? errorUrls.join('\n') : null,
          progress: null,
          completedAt: new Date().toISOString(),
        },
      })
      await createEvent(payload, 'success', 'category-discoveries', jobId, `Completed: ${discovered} discovered, ${created} created, ${existing} existing`)

      return Response.json({
        message: 'Category discovery completed',
        jobId,
        type: 'category-discovery',
        discovered,
        created,
        existing,
      })
    } else {
      // Save final state (currentUrlIndex may have advanced since last onProgress)
      await saveProgress(driverProgress)
      await createEvent(payload, 'info', 'category-discoveries', jobId, `Tick done: ${discovered} discovered so far, URL ${currentUrlIndex + 1}/${storeUrls.length}, queue ${driverProgress?.queue?.length ?? 0} remaining`)

      return Response.json({
        message: 'Category discovery tick completed',
        jobId,
        type: 'category-discovery',
        discovered,
        created,
        existing,
        progress: true,
      })
    }
  } catch (error) {
    console.error('Category discovery error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)

    // Save progress even on failure so we can resume
    await saveProgress(driverProgress)
    await payload.update({
      collection: 'category-discoveries',
      id: jobId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createEvent(payload, 'error', 'category-discoveries', jobId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId,
      type: 'category-discovery',
    }, { status: 500 })
  }
}

export const GET = async () => {
  return Response.json({ message: 'POST /api/tick to process pending jobs' })
}
