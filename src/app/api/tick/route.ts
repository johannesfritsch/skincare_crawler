import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getSourceDriver, getSourceDriverBySlug, getAllSourceDrivers } from '@/lib/source-discovery/driver'
import type { SourceDriver } from '@/lib/source-discovery/types'
import { launchBrowser } from '@/lib/browser'
import { aggregateProduct } from '@/lib/aggregate-product'

export const runtime = 'nodejs'
export const maxDuration = 300

// Job types
type JobType = 'ingredients-discovery' | 'source-discovery' | 'source-crawl' | 'product-aggregation'
const ALL_JOB_TYPES: JobType[] = ['ingredients-discovery', 'source-discovery', 'source-crawl', 'product-aggregation']

// Settings interfaces for each job type
interface IngredientsDiscoverySettings {
  pagesPerTick?: number  // Optional: limit pages processed per tick
  maxDurationMs?: number // Optional: limit execution time (for serverless)
}

interface SourceDiscoverySettings {
  maxDurationMs?: number // Optional: limit execution time (for serverless)
}

interface SourceCrawlSettings {
  itemsPerTick?: number   // Default: 10
  maxDurationMs?: number  // Optional: limit execution time (for serverless)
}

interface ProductAggregationSettings {
  itemsPerTick?: number   // Default: 10
  maxDurationMs?: number  // Optional: limit execution time (for serverless)
}

type JobSettings = {
  'ingredients-discovery': IngredientsDiscoverySettings
  'source-discovery': SourceDiscoverySettings
  'source-crawl': SourceCrawlSettings
  'product-aggregation': ProductAggregationSettings
}

// Default settings
const DEFAULT_SETTINGS: JobSettings = {
  'ingredients-discovery': {},
  'source-discovery': {},
  'source-crawl': { itemsPerTick: 10 },
  'product-aggregation': { itemsPerTick: 10 },
}

interface ActiveJob {
  type: JobType
  id: number
  status: string
  crawlType?: string // 'all' | 'selected_gtins' for source-crawl jobs
  aggregationType?: string // 'all' | 'selected_gtins' for product-aggregation jobs
}

// Parse and validate settings from request body
function parseSettings(body: Record<string, unknown>): {
  enabledTypes: JobType[]
  settings: JobSettings
} {
  // If no types specified, enable all with defaults
  if (!body.types || typeof body.types !== 'object') {
    return { enabledTypes: ALL_JOB_TYPES, settings: DEFAULT_SETTINGS }
  }

  const typesObj = body.types as Record<string, unknown>
  const enabledTypes: JobType[] = []
  const settings: JobSettings = { ...DEFAULT_SETTINGS }

  for (const type of ALL_JOB_TYPES) {
    if (type in typesObj) {
      enabledTypes.push(type)
      const typeSettings = typesObj[type]
      if (typeSettings && typeof typeSettings === 'object') {
        settings[type] = { ...DEFAULT_SETTINGS[type], ...typeSettings } as JobSettings[typeof type]
      }
    }
  }

  // If types object was provided but empty or had no valid types, return empty
  if (enabledTypes.length === 0 && Object.keys(typesObj).length > 0) {
    return { enabledTypes: [], settings }
  }

  // If types object was empty {}, enable all
  if (enabledTypes.length === 0) {
    return { enabledTypes: ALL_JOB_TYPES, settings: DEFAULT_SETTINGS }
  }

  return { enabledTypes, settings }
}

async function createErrorEvent(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobCollection: 'source-discoveries' | 'source-crawls' | 'ingredients-discoveries' | 'product-aggregations',
  jobId: number,
  message: string,
) {
  try {
    await payload.create({
      collection: 'events',
      data: { type: 'error', message, job: { relationTo: jobCollection, value: jobId } },
    })
  } catch (e) {
    console.error('Failed to create error event:', e)
  }
}

export const POST = async (request: Request) => {
  const startTime = Date.now()
  const payload = await getPayload({ config: configPromise })

  // Parse request body for types and settings
  let enabledTypes: JobType[] = ALL_JOB_TYPES
  let settings: JobSettings = DEFAULT_SETTINGS

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = parseSettings(body)
    enabledTypes = parsed.enabledTypes
    settings = parsed.settings
  } catch {
    // No body or invalid JSON, use all types with defaults
  }

  // Find active jobs only for enabled types
  const activeJobs: ActiveJob[] = []

  if (enabledTypes.includes('ingredients-discovery')) {
    const [inProgress, pending] = await Promise.all([
      payload.find({
        collection: 'ingredients-discoveries',
        where: { status: { equals: 'in_progress' } },
        limit: 10,
      }),
      payload.find({
        collection: 'ingredients-discoveries',
        where: { status: { equals: 'pending' } },
        limit: 10,
        sort: 'createdAt',
      }),
    ])
    activeJobs.push(
      ...inProgress.docs.map((d) => ({
        type: 'ingredients-discovery' as const,
        id: d.id,
        status: d.status!,
      })),
      ...pending.docs.map((d) => ({
        type: 'ingredients-discovery' as const,
        id: d.id,
        status: d.status!,
      })),
    )
  }

  if (enabledTypes.includes('source-discovery')) {
    const [inProgress, pending] = await Promise.all([
      payload.find({
        collection: 'source-discoveries',
        where: { status: { equals: 'in_progress' } },
        limit: 10,
      }),
      payload.find({
        collection: 'source-discoveries',
        where: { status: { equals: 'pending' } },
        limit: 10,
        sort: 'createdAt',
      }),
    ])
    activeJobs.push(
      ...inProgress.docs.map((d) => ({
        type: 'source-discovery' as const,
        id: d.id,
        status: d.status!,
      })),
      ...pending.docs.map((d) => ({
        type: 'source-discovery' as const,
        id: d.id,
        status: d.status!,
      })),
    )
  }

  if (enabledTypes.includes('source-crawl')) {
    const [inProgress, pending] = await Promise.all([
      payload.find({
        collection: 'source-crawls',
        where: { status: { equals: 'in_progress' } },
        limit: 10,
      }),
      payload.find({
        collection: 'source-crawls',
        where: { status: { equals: 'pending' } },
        limit: 10,
        sort: 'createdAt',
      }),
    ])
    activeJobs.push(
      ...inProgress.docs.map((d) => ({
        type: 'source-crawl' as const,
        id: d.id,
        status: d.status!,
        crawlType: d.type || 'all',
      })),
      ...pending.docs.map((d) => ({
        type: 'source-crawl' as const,
        id: d.id,
        status: d.status!,
        crawlType: d.type || 'all',
      })),
    )
  }

  if (enabledTypes.includes('product-aggregation')) {
    const [inProgress, pending] = await Promise.all([
      payload.find({
        collection: 'product-aggregations',
        where: { status: { equals: 'in_progress' } },
        limit: 10,
      }),
      payload.find({
        collection: 'product-aggregations',
        where: { status: { equals: 'pending' } },
        limit: 10,
        sort: 'createdAt',
      }),
    ])
    activeJobs.push(
      ...inProgress.docs.map((d) => ({
        type: 'product-aggregation' as const,
        id: d.id,
        status: d.status!,
        aggregationType: d.type || 'all',
      })),
      ...pending.docs.map((d) => ({
        type: 'product-aggregation' as const,
        id: d.id,
        status: d.status!,
        aggregationType: d.type || 'all',
      })),
    )
  }

  if (activeJobs.length === 0) {
    return Response.json({
      message: 'No pending jobs',
      enabledTypes: enabledTypes.length < ALL_JOB_TYPES.length ? enabledTypes : undefined,
    })
  }

  // Prioritize selected_gtins jobs, otherwise random
  const selectedGtinsJobs = activeJobs.filter(
    (j) => (j.type === 'source-crawl' && j.crawlType === 'selected_gtins') ||
           (j.type === 'product-aggregation' && j.aggregationType === 'selected_gtins'),
  )
  const selected = selectedGtinsJobs.length > 0
    ? selectedGtinsJobs[0]
    : activeJobs[Math.floor(Math.random() * activeJobs.length)]

  if (selected.type === 'ingredients-discovery') {
    return processIngredientsDiscovery(payload, selected.id, startTime, settings['ingredients-discovery'])
  } else if (selected.type === 'source-discovery') {
    return processSourceDiscovery(payload, selected.id, settings['source-discovery'])
  } else if (selected.type === 'product-aggregation') {
    return processProductAggregation(payload, selected.id, startTime, settings['product-aggregation'])
  } else {
    return processSourceCrawl(payload, selected.id, startTime, settings['source-crawl'])
  }
}

async function processIngredientsDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
  startTime: number,
  settings: IngredientsDiscoverySettings,
) {
  const pagesPerTick = settings.pagesPerTick // undefined = no limit
  const maxDurationMs = settings.maxDurationMs // undefined = no limit
  let pagesProcessed = 0
  console.log(`[Ingredients Discovery] Starting with pagesPerTick: ${pagesPerTick ?? 'unlimited'}, maxDurationMs: ${maxDurationMs ?? 'unlimited'}`)

  let discovery = await payload.findByID({
    collection: 'ingredients-discoveries',
    id: discoveryId,
  })

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
    await createErrorEvent(payload, 'ingredients-discoveries', discoveryId, errorMsg)
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
      if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
        console.log(`[Ingredients Discovery] Stopping: maxDurationMs (${maxDurationMs}ms) reached`)
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

    // Time's up, save final state
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
    await createErrorEvent(payload, 'ingredients-discoveries', discoveryId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'ingredients-discovery',
    }, { status: 500 })
  }
}

async function processSourceDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
  _settings: SourceDiscoverySettings,
) {
  const discovery = await payload.findByID({
    collection: 'source-discoveries',
    id: discoveryId,
  })

  const driver = getSourceDriver(discovery.sourceUrl)
  if (!driver) {
    const errorMsg = `No driver found for URL: ${discovery.sourceUrl}`
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createErrorEvent(payload, 'source-discoveries', discoveryId, errorMsg)
    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'source-discovery',
    }, { status: 400 })
  }

  // Mark as in_progress
  await payload.update({
    collection: 'source-discoveries',
    id: discoveryId,
    data: {
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    },
  })

  try {
    // Discover all products via API
    const { products } = await driver.discoverProducts(discovery.sourceUrl)

    // Update discovered count immediately
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        discovered: products.length,
      },
    })

    // Create or update DmProducts with discovery data
    let created = 0
    let existing = 0

    for (const product of products) {
      const existingProduct = await payload.find({
        collection: 'dm-products',
        where: { gtin: { equals: product.gtin } },
        limit: 1,
      })

      const discoveryData = {
        sourceUrl: product.productUrl,
        brandName: product.brandName,
        name: product.name,
        type: product.category,
        pricing: product.price != null ? {
          amount: product.price,
          currency: product.currency ?? 'EUR',
        } : undefined,
        rating: product.rating,
        ratingNum: product.ratingCount,
      }

      if (existingProduct.docs.length === 0) {
        await payload.create({
          collection: 'dm-products',
          data: {
            gtin: product.gtin,
            status: 'uncrawled',
            ...discoveryData,
          },
        })
        created++
      } else {
        await payload.update({
          collection: 'dm-products',
          id: existingProduct.docs[0].id,
          data: discoveryData,
        })
        existing++
      }

      // Update stats after each product
      await payload.update({
        collection: 'source-discoveries',
        id: discoveryId,
        data: {
          created,
          existing,
        },
      })
    }

    // Mark as completed, output discovered GTINs
    const discoveredGtins = products.map((p) => p.gtin).join(',')
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
        gtins: discoveredGtins,
      },
    })

    return Response.json({
      message: 'Discovery completed',
      jobId: discoveryId,
      type: 'source-discovery',
      discovered: products.length,
      created,
      existing,
    })
  } catch (error) {
    console.error('Source discovery error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createErrorEvent(payload, 'source-discoveries', discoveryId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'source-discovery',
    }, { status: 500 })
  }
}

async function processSourceCrawl(
  payload: Awaited<ReturnType<typeof getPayload>>,
  crawlId: number,
  startTime: number,
  settings: SourceCrawlSettings,
) {
  const itemsPerTick = settings.itemsPerTick ?? 10
  const maxDurationMs = settings.maxDurationMs
  console.log(`[Source Crawl] Starting with itemsPerTick: ${itemsPerTick}, maxDurationMs: ${maxDurationMs ?? 'unlimited'}`)

  let crawl = await payload.findByID({
    collection: 'source-crawls',
    id: crawlId,
  })

  // Initialize if pending
  const isFirstTick = crawl.status === 'pending'
  if (isFirstTick) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      },
    })
    crawl = await payload.findByID({
      collection: 'source-crawls',
      id: crawlId,
    })
  }

  // Resolve drivers from crawl.source (default 'all' for backward compat with null)
  const sourceSlug = (crawl as unknown as Record<string, unknown>).source as string | null | undefined
  const resolvedSource = sourceSlug || 'all'
  let drivers: SourceDriver[]

  if (resolvedSource === 'all') {
    drivers = getAllSourceDrivers()
  } else {
    const driver = getSourceDriverBySlug(resolvedSource)
    if (!driver) {
      await payload.update({
        collection: 'source-crawls',
        id: crawlId,
        data: { status: 'failed', completedAt: new Date().toISOString() },
      })
      await createErrorEvent(payload, 'source-crawls', crawlId, `No driver found for source: ${resolvedSource}`)
      return Response.json({
        error: `No driver found for source: ${resolvedSource}`,
        jobId: crawlId,
        type: 'source-crawl',
      }, { status: 400 })
    }
    drivers = [driver]
  }

  // Parse GTINs for selected_gtins mode
  const isSelectedGtins = crawl.type === 'selected_gtins'
  const gtinList = isSelectedGtins
    ? (crawl.gtins || '').split(',').map((g) => g.trim()).filter(Boolean)
    : undefined

  console.log(`[Source Crawl] id=${crawlId}, source=${resolvedSource}, type=${crawl.type}, drivers=[${drivers.map((d) => d.slug).join(', ')}], isFirstTick=${isFirstTick}, gtins=${gtinList ? gtinList.join(',') : 'all'}`)

  if (isSelectedGtins && (!gtinList || gtinList.length === 0)) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: { status: 'completed', completedAt: new Date().toISOString() },
    })
    return Response.json({
      message: 'Crawl completed - no GTINs specified',
      jobId: crawlId,
      type: 'source-crawl',
    })
  }

  // On first tick, reset products to uncrawled so they get re-crawled
  if (isFirstTick) {
    for (const driver of drivers) {
      await driver.resetProducts(payload, gtinList)
    }
    console.log(`[Source Crawl] Reset products to uncrawled`)
  }

  let crawled = crawl.crawled || 0
  let errors = crawl.errors || 0
  let processedThisTick = 0
  let remainingBudget = itemsPerTick

  try {
    for (const driver of drivers) {
      if (remainingBudget <= 0) break
      if (maxDurationMs && Date.now() - startTime >= maxDurationMs) break

      const products = await driver.findUncrawledProducts(payload, {
        gtins: gtinList,
        limit: remainingBudget,
      })

      if (products.length === 0) continue

      console.log(`[Source Crawl] [${driver.slug}] Found ${products.length} uncrawled products`)

      const browser = await launchBrowser()
      const page = await browser.newPage()

      await page.goto(driver.getBaseUrl(), { waitUntil: 'domcontentloaded' })
      await driver.acceptCookies(page)

      try {
        for (const product of products) {
          if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
            console.log(`[Source Crawl] [${driver.slug}] Stopping: maxDurationMs reached after ${processedThisTick} products`)
            break
          }

          const productId = await driver.crawlProduct(
            page,
            product.gtin,
            product.sourceUrl,
            payload,
          )

          if (productId !== null) {
            await driver.markProductStatus(payload, product.id, 'crawled')
            crawled++
          } else {
            await driver.markProductStatus(payload, product.id, 'failed')
            errors++
          }

          processedThisTick++
          remainingBudget--

          await payload.update({
            collection: 'source-crawls',
            id: crawlId,
            data: { crawled, errors },
          })

          if (remainingBudget > 0) {
            await page.waitForTimeout(Math.floor(Math.random() * 500) + 500)
          }
        }
      } finally {
        await browser.close()
      }
    }

    // Check completion: sum uncrawled across all drivers
    let totalRemaining = 0
    for (const driver of drivers) {
      totalRemaining += await driver.countUncrawled(payload, gtinList ? { gtins: gtinList } : undefined)
    }

    if (totalRemaining === 0) {
      await payload.update({
        collection: 'source-crawls',
        id: crawlId,
        data: {
          status: 'completed',
          crawled,
          errors,
          completedAt: new Date().toISOString(),
        },
      })

      return Response.json({
        message: 'Crawl completed',
        jobId: crawlId,
        type: 'source-crawl',
        crawled,
        errors,
      })
    }

    return Response.json({
      message: 'Tick completed',
      jobId: crawlId,
      type: 'source-crawl',
      processedThisTick,
      crawled,
      errors,
      remaining: totalRemaining,
    })
  } catch (error) {
    console.error('Source crawl error:', error)

    const errorMsg = error instanceof Error ? error.message : String(error)
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createErrorEvent(payload, 'source-crawls', crawlId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId: crawlId,
      type: 'source-crawl',
    }, { status: 500 })
  }
}

async function processProductAggregation(
  payload: Awaited<ReturnType<typeof getPayload>>,
  jobId: number,
  startTime: number,
  settings: ProductAggregationSettings,
) {
  const itemsPerTick = settings.itemsPerTick ?? 10
  const maxDurationMs = settings.maxDurationMs
  console.log(`[Product Aggregation] Starting with itemsPerTick: ${itemsPerTick}, maxDurationMs: ${maxDurationMs ?? 'unlimited'}`)

  let job = await payload.findByID({
    collection: 'product-aggregations',
    id: jobId,
  })

  // Initialize if pending
  if (job.status === 'pending') {
    await payload.update({
      collection: 'product-aggregations',
      id: jobId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      },
    })
    job = await payload.findByID({
      collection: 'product-aggregations',
      id: jobId,
    })
  }

  // Branch based on type
  if (job.type === 'selected_gtins') {
    return processProductAggregationSelectedGtins(payload, jobId, job, settings)
  }

  // Default: aggregate all non-aggregated products
  const lastCheckedSourceId = job.lastCheckedSourceId || 0
  let aggregated = job.aggregated || 0
  let errors = job.errors || 0
  let tokensUsed = job.tokensUsed || 0

  try {
    // Query DmProducts where status='crawled' AND id > lastCheckedSourceId
    const dmProducts = await payload.find({
      collection: 'dm-products',
      where: {
        and: [
          { status: { equals: 'crawled' } },
          { id: { greater_than: lastCheckedSourceId } },
        ],
      },
      sort: 'id',
      limit: itemsPerTick * 5,
    })

    if (dmProducts.docs.length === 0) {
      // No more sources to check
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })
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

    for (const dmProduct of dmProducts.docs) {
      if (processedAggregations >= itemsPerTick) break
      if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
        console.log(`[Product Aggregation] Stopping: maxDurationMs (${maxDurationMs}ms) reached`)
        break
      }

      lastId = dmProduct.id

      if (!dmProduct.gtin) {
        continue
      }

      // Check if Product with same GTIN already has lastAggregatedAt set
      const existingProducts = await payload.find({
        collection: 'products',
        where: { gtin: { equals: dmProduct.gtin } },
        limit: 1,
      })

      if (existingProducts.docs.length > 0 && existingProducts.docs[0].lastAggregatedAt) {
        // Already aggregated, skip
        continue
      }

      // Find or create Product
      let productId: number
      if (existingProducts.docs.length > 0) {
        productId = existingProducts.docs[0].id
      } else {
        const newProduct = await payload.create({
          collection: 'products',
          data: {
            gtin: dmProduct.gtin,
            name: dmProduct.name || undefined,
          },
        })
        productId = newProduct.id
      }

      // Run per-GTIN aggregation logic
      const result = await aggregateProduct(payload, productId, dmProduct, 'dm')
      processedAggregations++
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        aggregated++
      } else {
        errors++
        await createErrorEvent(payload, 'product-aggregations', jobId, `GTIN ${dmProduct.gtin}: ${result.error}`)
      }

      // Update progress
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { aggregated, errors, tokensUsed, lastCheckedSourceId: lastId },
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
    await createErrorEvent(payload, 'product-aggregations', jobId, errorMsg)

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
  job: { aggregated?: number | null; errors?: number | null; tokensUsed?: number | null; gtins?: string | null },
  settings: ProductAggregationSettings,
) {
  const gtinList = (job.gtins || '').split(',').map((g) => g.trim()).filter(Boolean)

  console.log(`[Product Aggregation] Selected GTINs mode: ${gtinList.length} GTINs`)

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
  const _itemsPerTick = settings.itemsPerTick ?? 10

  try {
    for (const gtin of gtinList) {
      // Find DmProduct with this GTIN
      const dmProducts = await payload.find({
        collection: 'dm-products',
        where: {
          and: [
            { gtin: { equals: gtin } },
            { status: { equals: 'crawled' } },
          ],
        },
        limit: 1,
      })

      if (dmProducts.docs.length === 0) {
        // No source found, create warning event
        await payload.create({
          collection: 'events',
          data: {
            type: 'warning',
            message: `No crawled DmProduct found for GTIN ${gtin}`,
            job: { relationTo: 'product-aggregations', value: jobId },
          },
        })
        errors++
        continue
      }

      const dmProduct = dmProducts.docs[0]

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
            name: dmProduct.name || undefined,
          },
        })
        productId = newProduct.id
      }

      // Run per-GTIN aggregation logic
      const result = await aggregateProduct(payload, productId, dmProduct, 'dm')
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        aggregated++
      } else {
        errors++
        await createErrorEvent(payload, 'product-aggregations', jobId, `GTIN ${gtin}: ${result.error}`)
      }

      // Update progress
      await payload.update({
        collection: 'product-aggregations',
        id: jobId,
        data: { aggregated, errors, tokensUsed },
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
    await createErrorEvent(payload, 'product-aggregations', jobId, errorMsg)

    return Response.json({
      error: errorMsg,
      jobId,
      type: 'product-aggregation',
    }, { status: 500 })
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Tick API',
    usage: 'POST /api/tick',
    description: 'Processes pending jobs incrementally. Call repeatedly via cron.',
    parameters: {
      types: {
        type: 'object',
        optional: true,
        description: 'Object where keys are job types to enable, and values are settings for that type. If omitted, all types run with default settings.',
      },
    },
    jobTypes: {
      'ingredients-discovery': {
        collection: 'ingredients-discoveries',
        description: 'Discovers ingredients from CosIng API',
        settings: {
          pagesPerTick: {
            type: 'number',
            optional: true,
            description: 'Limit pages processed per tick.',
          },
          maxDurationMs: {
            type: 'number',
            optional: true,
            description: 'Limit execution time (ms). For serverless environments with timeouts.',
          },
        },
      },
      'source-discovery': {
        collection: 'source-discoveries',
        description: 'Discovers products from category pages, creates DmProducts with status "uncrawled"',
        settings: {
          maxDurationMs: {
            type: 'number',
            optional: true,
            description: 'Limit execution time (ms). For serverless environments with timeouts.',
          },
        },
      },
      'source-crawl': {
        collection: 'source-crawls',
        description: 'Crawls uncrawled DmProducts, adds full details (price, ingredients, etc.)',
        settings: {
          itemsPerTick: {
            type: 'number',
            default: 10,
            description: 'Number of products to crawl per tick',
          },
          maxDurationMs: {
            type: 'number',
            optional: true,
            description: 'Limit execution time (ms). For serverless environments with timeouts.',
          },
        },
      },
      'product-aggregation': {
        collection: 'product-aggregations',
        description: 'Aggregates data from DmProducts into Products, matches ingredients via LLM',
        settings: {
          itemsPerTick: {
            type: 'number',
            default: 10,
            description: 'Number of products to aggregate per tick',
          },
          maxDurationMs: {
            type: 'number',
            optional: true,
            description: 'Limit execution time (ms). For serverless environments with timeouts.',
          },
        },
      },
    },
    examples: [
      {
        description: 'Process any pending job with defaults',
        body: {},
      },
      {
        description: 'Process only source-discovery',
        body: {
          types: {
            'source-discovery': {},
          },
        },
      },
      {
        description: 'Process only source-crawl with custom items per tick',
        body: {
          types: {
            'source-crawl': { itemsPerTick: 20 },
          },
        },
      },
      {
        description: 'Process multiple types with mixed settings',
        body: {
          types: {
            'source-discovery': {},
            'source-crawl': { itemsPerTick: 5 },
          },
        },
      },
    ],
  })
}
