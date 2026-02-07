import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getSourceDriver } from '@/lib/source-discovery/driver'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 300

// Job types
type JobType = 'ingredients-discovery' | 'source-discovery' | 'source-crawl'
const ALL_JOB_TYPES: JobType[] = ['ingredients-discovery', 'source-discovery', 'source-crawl']

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

type JobSettings = {
  'ingredients-discovery': IngredientsDiscoverySettings
  'source-discovery': SourceDiscoverySettings
  'source-crawl': SourceCrawlSettings
}

// Default settings
const DEFAULT_SETTINGS: JobSettings = {
  'ingredients-discovery': {},
  'source-discovery': {},
  'source-crawl': { itemsPerTick: 10 },
}

interface ActiveJob {
  type: JobType
  id: number
  status: string
  crawlType?: string // 'all' | 'selected_gtins' for source-crawl jobs
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
  jobCollection: 'source-discoveries' | 'source-crawls' | 'ingredients-discoveries',
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

  if (activeJobs.length === 0) {
    return Response.json({
      message: 'No pending jobs',
      enabledTypes: enabledTypes.length < ALL_JOB_TYPES.length ? enabledTypes : undefined,
    })
  }

  // Prioritize selected_gtins source-crawls, otherwise random
  const selectedGtinsCrawls = activeJobs.filter(
    (j) => j.type === 'source-crawl' && j.crawlType === 'selected_gtins',
  )
  const selected = selectedGtinsCrawls.length > 0
    ? selectedGtinsCrawls[0]
    : activeJobs[Math.floor(Math.random() * activeJobs.length)]

  if (selected.type === 'ingredients-discovery') {
    return processIngredientsDiscovery(payload, selected.id, startTime, settings['ingredients-discovery'])
  } else if (selected.type === 'source-discovery') {
    return processSourceDiscovery(payload, selected.id, settings['source-discovery'])
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

  const browser = await launchBrowser()
  const page = await browser.newPage()

  try {
    // Discover all products from the category page
    const { products } = await driver.discoverProducts(page, discovery.sourceUrl)
    await browser.close()

    // Update discovered count immediately
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        discovered: products.length,
      },
    })

    // Create DmProducts with status "uncrawled"
    let created = 0
    let existing = 0

    for (const product of products) {
      const existingProduct = await payload.find({
        collection: 'dm-products',
        where: { gtin: { equals: product.gtin } },
        limit: 1,
      })

      if (existingProduct.docs.length === 0) {
        await payload.create({
          collection: 'dm-products',
          data: {
            gtin: product.gtin,
            sourceUrl: product.productUrl
              ? (product.productUrl.startsWith('http') ? product.productUrl : `https://www.dm.de${product.productUrl}`)
              : null,
            status: 'uncrawled',
          },
        })
        created++
      } else {
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

    // Mark as completed
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
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
    await browser.close()

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
  const maxDurationMs = settings.maxDurationMs // undefined = no limit
  console.log(`[Source Crawl] Starting with itemsPerTick: ${itemsPerTick}, maxDurationMs: ${maxDurationMs ?? 'unlimited'}`)

  let crawl = await payload.findByID({
    collection: 'source-crawls',
    id: crawlId,
  })

  // Initialize if pending
  if (crawl.status === 'pending') {
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

  // Branch based on crawl type
  if (crawl.type === 'selected_gtins') {
    return processSourceCrawlSelectedGtins(payload, crawlId, crawl, startTime, settings)
  }

  // Default: crawl all uncrawled products
  // Find uncrawled DmProducts
  const uncrawledProducts = await payload.find({
    collection: 'dm-products',
    where: { status: { equals: 'uncrawled' } },
    limit: itemsPerTick,
  })
  console.log(`[Source Crawl] Found ${uncrawledProducts.docs.length} uncrawled products (limit: ${itemsPerTick})`)

  if (uncrawledProducts.docs.length === 0) {
    // No more products to crawl
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      message: 'Crawl completed - no uncrawled products',
      jobId: crawlId,
      type: 'source-crawl',
      crawled: crawl.crawled || 0,
      errors: crawl.errors || 0,
    })
  }

  const driver = getSourceDriver('https://www.dm.de')
  if (!driver) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createErrorEvent(payload, 'source-crawls', crawlId, 'No DM driver found')
    return Response.json({
      error: 'No DM driver found',
      jobId: crawlId,
      type: 'source-crawl',
    }, { status: 400 })
  }

  const browser = await launchBrowser()
  const page = await browser.newPage()

  // Accept cookies once
  await page.goto(driver.getBaseUrl(), { waitUntil: 'domcontentloaded' })
  await driver.acceptCookies(page)

  let crawled = crawl.crawled || 0
  let errors = crawl.errors || 0
  let processedThisTick = 0

  try {
    for (const product of uncrawledProducts.docs) {
      if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
        console.log(`[Source Crawl] Stopping: maxDurationMs (${maxDurationMs}ms) reached after ${processedThisTick} products`)
        break
      }

      const productId = await driver.crawlProduct(
        page,
        product.gtin!,
        product.sourceUrl || null,
        payload,
      )

      if (productId !== null) {
        // Product was crawled successfully - ensure status is updated on the original product
        await payload.update({
          collection: 'dm-products',
          id: product.id,
          data: { status: 'crawled' },
        })
        crawled++
      } else {
        // Mark as failed
        await payload.update({
          collection: 'dm-products',
          id: product.id,
          data: { status: 'failed' },
        })
        errors++
      }

      processedThisTick++

      // Update crawl progress
      await payload.update({
        collection: 'source-crawls',
        id: crawlId,
        data: { crawled, errors },
      })

      // Random delay between products
      if (processedThisTick < uncrawledProducts.docs.length) {
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 500)
      }
    }

    await browser.close()

    // Check if there are more uncrawled products
    const remaining = await payload.count({
      collection: 'dm-products',
      where: { status: { equals: 'uncrawled' } },
    })

    if (remaining.totalDocs === 0) {
      await payload.update({
        collection: 'source-crawls',
        id: crawlId,
        data: {
          status: 'completed',
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
      remaining: remaining.totalDocs,
    })
  } catch (error) {
    console.error('Source crawl error:', error)
    await browser.close()

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

async function processSourceCrawlSelectedGtins(
  payload: Awaited<ReturnType<typeof getPayload>>,
  crawlId: number,
  crawl: { crawled?: number | null; errors?: number | null; status?: string | null; gtins?: Array<{ gtin: string }> | null },
  startTime: number,
  settings: SourceCrawlSettings,
) {
  const itemsPerTick = settings.itemsPerTick ?? 10
  const maxDurationMs = settings.maxDurationMs
  const gtinList = (crawl.gtins || []).map((g) => g.gtin)

  console.log(`[Source Crawl] Selected GTINs mode: ${gtinList.length} GTINs`)

  if (gtinList.length === 0) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      message: 'Crawl completed - no GTINs specified',
      jobId: crawlId,
      type: 'source-crawl',
    })
  }

  // On first tick, reset matching products to uncrawled
  if (crawl.status === 'in_progress' && (crawl.crawled || 0) === 0 && (crawl.errors || 0) === 0) {
    await payload.update({
      collection: 'dm-products',
      where: { gtin: { in: gtinList.join(',') } },
      data: { status: 'uncrawled' },
    })
  }

  // Find uncrawled products matching our GTINs
  const uncrawledProducts = await payload.find({
    collection: 'dm-products',
    where: {
      and: [
        { gtin: { in: gtinList.join(',') } },
        { status: { equals: 'uncrawled' } },
      ],
    },
    limit: itemsPerTick,
  })

  if (uncrawledProducts.docs.length === 0) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      message: 'Crawl completed - all selected GTINs processed',
      jobId: crawlId,
      type: 'source-crawl',
      crawled: crawl.crawled || 0,
      errors: crawl.errors || 0,
    })
  }

  const driver = getSourceDriver('https://www.dm.de')
  if (!driver) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'failed',
        completedAt: new Date().toISOString(),
      },
    })
    await createErrorEvent(payload, 'source-crawls', crawlId, 'No DM driver found')
    return Response.json({
      error: 'No DM driver found',
      jobId: crawlId,
      type: 'source-crawl',
    }, { status: 400 })
  }

  const browser = await launchBrowser()
  const page = await browser.newPage()

  await page.goto(driver.getBaseUrl(), { waitUntil: 'domcontentloaded' })
  await driver.acceptCookies(page)

  let crawled = (crawl.crawled as number) || 0
  let errors = (crawl.errors as number) || 0
  let processedThisTick = 0

  try {
    for (const product of uncrawledProducts.docs) {
      if (maxDurationMs && Date.now() - startTime >= maxDurationMs) {
        console.log(`[Source Crawl] Selected GTINs: stopping after ${processedThisTick} products (maxDurationMs reached)`)
        break
      }

      const productId = await driver.crawlProduct(
        page,
        product.gtin!,
        product.sourceUrl || null,
        payload,
      )

      if (productId !== null) {
        await payload.update({
          collection: 'dm-products',
          id: product.id,
          data: { status: 'crawled' },
        })
        crawled++
      } else {
        await payload.update({
          collection: 'dm-products',
          id: product.id,
          data: { status: 'failed' },
        })
        errors++
      }

      processedThisTick++

      await payload.update({
        collection: 'source-crawls',
        id: crawlId,
        data: { crawled, errors },
      })

      if (processedThisTick < uncrawledProducts.docs.length) {
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 500)
      }
    }

    await browser.close()

    // Check if there are remaining uncrawled products in our GTIN list
    const remaining = await payload.count({
      collection: 'dm-products',
      where: {
        and: [
          { gtin: { in: gtinList.join(',') } },
          { status: { equals: 'uncrawled' } },
        ],
      },
    })

    if (remaining.totalDocs === 0) {
      // Check for GTINs that had no matching DmProduct
      const allMatching = await payload.count({
        collection: 'dm-products',
        where: { gtin: { in: gtinList.join(',') } },
      })
      const missingGtins = gtinList.length - allMatching.totalDocs
      if (missingGtins > 0) {
        errors += missingGtins
      }

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
        missingGtins,
      })
    }

    return Response.json({
      message: 'Tick completed',
      jobId: crawlId,
      type: 'source-crawl',
      processedThisTick,
      crawled,
      errors,
      remaining: remaining.totalDocs,
    })
  } catch (error) {
    console.error('Source crawl (selected GTINs) error:', error)
    await browser.close()

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
