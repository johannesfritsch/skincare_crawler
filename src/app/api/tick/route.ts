import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getDmDriver } from '@/lib/dm-discovery/driver'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 300

// Job types
type JobType = 'ingredients-discovery' | 'dm-discovery' | 'dm-crawl'
const ALL_JOB_TYPES: JobType[] = ['ingredients-discovery', 'dm-discovery', 'dm-crawl']

// Settings interfaces for each job type
interface IngredientsDiscoverySettings {
  pagesPerTick?: number  // Optional: limit pages processed per tick
  maxDurationMs?: number // Optional: limit execution time (for serverless)
}

interface DmDiscoverySettings {
  maxDurationMs?: number // Optional: limit execution time (for serverless)
}

interface DmCrawlSettings {
  itemsPerTick?: number   // Default: 10
  maxDurationMs?: number  // Optional: limit execution time (for serverless)
}

type JobSettings = {
  'ingredients-discovery': IngredientsDiscoverySettings
  'dm-discovery': DmDiscoverySettings
  'dm-crawl': DmCrawlSettings
}

// Default settings
const DEFAULT_SETTINGS: JobSettings = {
  'ingredients-discovery': {},
  'dm-discovery': {},
  'dm-crawl': { itemsPerTick: 10 },
}

interface ActiveJob {
  type: JobType
  id: number
  status: string
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

  if (enabledTypes.includes('dm-discovery')) {
    const [inProgress, pending] = await Promise.all([
      payload.find({
        collection: 'dm-discoveries',
        where: { status: { equals: 'in_progress' } },
        limit: 10,
      }),
      payload.find({
        collection: 'dm-discoveries',
        where: { status: { equals: 'pending' } },
        limit: 10,
        sort: 'createdAt',
      }),
    ])
    activeJobs.push(
      ...inProgress.docs.map((d) => ({
        type: 'dm-discovery' as const,
        id: d.id,
        status: d.status!,
      })),
      ...pending.docs.map((d) => ({
        type: 'dm-discovery' as const,
        id: d.id,
        status: d.status!,
      })),
    )
  }

  if (enabledTypes.includes('dm-crawl')) {
    const [inProgress, pending] = await Promise.all([
      payload.find({
        collection: 'dm-crawls',
        where: { status: { equals: 'in_progress' } },
        limit: 10,
      }),
      payload.find({
        collection: 'dm-crawls',
        where: { status: { equals: 'pending' } },
        limit: 10,
        sort: 'createdAt',
      }),
    ])
    activeJobs.push(
      ...inProgress.docs.map((d) => ({
        type: 'dm-crawl' as const,
        id: d.id,
        status: d.status!,
      })),
      ...pending.docs.map((d) => ({
        type: 'dm-crawl' as const,
        id: d.id,
        status: d.status!,
      })),
    )
  }

  if (activeJobs.length === 0) {
    return Response.json({
      message: 'No pending jobs',
      enabledTypes: enabledTypes.length < ALL_JOB_TYPES.length ? enabledTypes : undefined,
    })
  }

  // Randomly select one job to process
  const selected = activeJobs[Math.floor(Math.random() * activeJobs.length)]

  if (selected.type === 'ingredients-discovery') {
    return processIngredientsDiscovery(payload, selected.id, startTime, settings['ingredients-discovery'])
  } else if (selected.type === 'dm-discovery') {
    return processDmDiscovery(payload, selected.id, settings['dm-discovery'])
  } else {
    return processDmCrawl(payload, selected.id, startTime, settings['dm-crawl'])
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
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        error: `No driver found for URL: ${discovery.sourceUrl}`,
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      error: `No driver found for URL: ${discovery.sourceUrl}`,
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

    await payload.update({
      collection: 'ingredients-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      jobId: discoveryId,
      type: 'ingredients-discovery',
    }, { status: 500 })
  }
}

async function processDmDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
  _settings: DmDiscoverySettings,
) {
  const discovery = await payload.findByID({
    collection: 'dm-discoveries',
    id: discoveryId,
  })

  const driver = getDmDriver(discovery.sourceUrl)
  if (!driver) {
    await payload.update({
      collection: 'dm-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        error: `No driver found for URL: ${discovery.sourceUrl}`,
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      error: `No driver found for URL: ${discovery.sourceUrl}`,
      jobId: discoveryId,
      type: 'dm-discovery',
    }, { status: 400 })
  }

  // Mark as in_progress
  await payload.update({
    collection: 'dm-discoveries',
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
      collection: 'dm-discoveries',
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
        collection: 'dm-discoveries',
        id: discoveryId,
        data: {
          created,
          existing,
        },
      })
    }

    // Mark as completed
    await payload.update({
      collection: 'dm-discoveries',
      id: discoveryId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      message: 'Discovery completed',
      jobId: discoveryId,
      type: 'dm-discovery',
      discovered: products.length,
      created,
      existing,
    })
  } catch (error) {
    console.error('DM discovery error:', error)
    await browser.close()

    await payload.update({
      collection: 'dm-discoveries',
      id: discoveryId,
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      jobId: discoveryId,
      type: 'dm-discovery',
    }, { status: 500 })
  }
}

async function processDmCrawl(
  payload: Awaited<ReturnType<typeof getPayload>>,
  crawlId: number,
  startTime: number,
  settings: DmCrawlSettings,
) {
  const itemsPerTick = settings.itemsPerTick ?? 10
  const maxDurationMs = settings.maxDurationMs // undefined = no limit
  console.log(`[DM Crawl] Starting with itemsPerTick: ${itemsPerTick}, maxDurationMs: ${maxDurationMs ?? 'unlimited'}`)

  let crawl = await payload.findByID({
    collection: 'dm-crawls',
    id: crawlId,
  })

  // Initialize if pending
  if (crawl.status === 'pending') {
    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      },
    })
    crawl = await payload.findByID({
      collection: 'dm-crawls',
      id: crawlId,
    })
  }

  // Find uncrawled DmProducts
  const uncrawledProducts = await payload.find({
    collection: 'dm-products',
    where: { status: { equals: 'uncrawled' } },
    limit: itemsPerTick,
  })
  console.log(`[DM Crawl] Found ${uncrawledProducts.docs.length} uncrawled products (limit: ${itemsPerTick})`)

  if (uncrawledProducts.docs.length === 0) {
    // No more products to crawl
    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        status: 'completed',
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      message: 'Crawl completed - no uncrawled products',
      jobId: crawlId,
      type: 'dm-crawl',
      crawled: crawl.crawled || 0,
      errors: crawl.errors || 0,
    })
  }

  const driver = getDmDriver('https://www.dm.de')
  if (!driver) {
    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        status: 'failed',
        error: 'No DM driver found',
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      error: 'No DM driver found',
      jobId: crawlId,
      type: 'dm-crawl',
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
        console.log(`[DM Crawl] Stopping: maxDurationMs (${maxDurationMs}ms) reached after ${processedThisTick} products`)
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
        collection: 'dm-crawls',
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
        collection: 'dm-crawls',
        id: crawlId,
        data: {
          status: 'completed',
          completedAt: new Date().toISOString(),
        },
      })

      return Response.json({
        message: 'Crawl completed',
        jobId: crawlId,
        type: 'dm-crawl',
        crawled,
        errors,
      })
    }

    return Response.json({
      message: 'Tick completed',
      jobId: crawlId,
      type: 'dm-crawl',
      processedThisTick,
      crawled,
      errors,
      remaining: remaining.totalDocs,
    })
  } catch (error) {
    console.error('DM crawl error:', error)
    await browser.close()

    await payload.update({
      collection: 'dm-crawls',
      id: crawlId,
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      jobId: crawlId,
      type: 'dm-crawl',
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
      'dm-discovery': {
        collection: 'dm-discoveries',
        description: 'Discovers products from dm.de category pages, creates DmProducts with status "uncrawled"',
        settings: {
          maxDurationMs: {
            type: 'number',
            optional: true,
            description: 'Limit execution time (ms). For serverless environments with timeouts.',
          },
        },
      },
      'dm-crawl': {
        collection: 'dm-crawls',
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
        description: 'Process only dm-discovery',
        body: {
          types: {
            'dm-discovery': {},
          },
        },
      },
      {
        description: 'Process only dm-crawl with custom items per tick',
        body: {
          types: {
            'dm-crawl': { itemsPerTick: 20 },
          },
        },
      },
      {
        description: 'Process multiple types with mixed settings',
        body: {
          types: {
            'dm-discovery': {},
            'dm-crawl': { itemsPerTick: 5 },
          },
        },
      },
    ],
  })
}
