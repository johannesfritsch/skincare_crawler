import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getDmDriver } from '@/lib/dm-discovery/driver'
import { launchBrowser } from '@/lib/browser'

export const runtime = 'nodejs'
export const maxDuration = 300

const TICK_DURATION_MS = 25_000 // Process for ~25 seconds
const DM_ITEMS_PER_TICK = 20 // Number of DM products to crawl per tick

type DiscoveryType = 'ingredients' | 'dm'

interface ActiveDiscovery {
  type: DiscoveryType
  id: number
  sourceUrl: string
  status: string
}

export const POST = async () => {
  const startTime = Date.now()
  const payload = await getPayload({ config: configPromise })

  // Find all active discoveries (in_progress or pending)
  const [ingredientsInProgress, ingredientsPending, dmInProgress, dmPending] = await Promise.all([
    payload.find({
      collection: 'ingredients-discoveries',
      where: { status: { in: ['in_progress'] } },
      limit: 10,
    }),
    payload.find({
      collection: 'ingredients-discoveries',
      where: { status: { equals: 'pending' } },
      limit: 10,
      sort: 'createdAt',
    }),
    payload.find({
      collection: 'dm-discoveries',
      where: { status: { in: ['discovering', 'discovered', 'crawling'] } },
      limit: 10,
    }),
    payload.find({
      collection: 'dm-discoveries',
      where: { status: { equals: 'pending' } },
      limit: 10,
      sort: 'createdAt',
    }),
  ])

  // Collect all active discoveries
  const activeDiscoveries: ActiveDiscovery[] = [
    ...ingredientsInProgress.docs.map((d) => ({
      type: 'ingredients' as const,
      id: d.id,
      sourceUrl: d.sourceUrl,
      status: d.status!,
    })),
    ...ingredientsPending.docs.map((d) => ({
      type: 'ingredients' as const,
      id: d.id,
      sourceUrl: d.sourceUrl,
      status: d.status!,
    })),
    ...dmInProgress.docs.map((d) => ({
      type: 'dm' as const,
      id: d.id,
      sourceUrl: d.sourceUrl,
      status: d.status!,
    })),
    ...dmPending.docs.map((d) => ({
      type: 'dm' as const,
      id: d.id,
      sourceUrl: d.sourceUrl,
      status: d.status!,
    })),
  ]

  if (activeDiscoveries.length === 0) {
    return Response.json({ message: 'No pending discoveries' })
  }

  // Randomly select one discovery to process
  const selected = activeDiscoveries[Math.floor(Math.random() * activeDiscoveries.length)]

  if (selected.type === 'ingredients') {
    return processIngredientsDiscovery(payload, selected.id, startTime)
  } else {
    return processDmDiscovery(payload, selected.id, startTime)
  }
}

async function processIngredientsDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
  startTime: number,
) {
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
      discoveryId,
      type: 'ingredients',
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
    // Process until time limit
    while (Date.now() - startTime < TICK_DURATION_MS) {
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
            discoveryId,
            type: 'ingredients',
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
      discoveryId,
      type: 'ingredients',
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
      discoveryId,
      type: 'ingredients',
    }, { status: 500 })
  }
}

async function processDmDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
  startTime: number,
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
      discoveryId,
      type: 'dm',
    }, { status: 400 })
  }

  const browser = await launchBrowser()
  const page = await browser.newPage()

  try {
    // Phase 1: Discovery (pending -> discovering -> discovered)
    if (discovery.status === 'pending' || discovery.status === 'discovering') {
      await payload.update({
        collection: 'dm-discoveries',
        id: discoveryId,
        data: { status: 'discovering' },
      })

      const { totalCount, products } = await driver.discoverProducts(page, discovery.sourceUrl)

      // Create discovery items
      for (const product of products) {
        await payload.create({
          collection: 'dm-discovery-items',
          data: {
            discovery: discoveryId,
            gtin: product.gtin,
            productUrl: product.productUrl,
            status: 'pending',
          },
        })
      }

      await payload.update({
        collection: 'dm-discoveries',
        id: discoveryId,
        data: {
          status: 'discovered',
          totalCount,
          itemsDiscovered: products.length,
          itemsCrawled: 0,
          itemsFailed: 0,
          discoveredAt: new Date().toISOString(),
        },
      })

      await browser.close()

      return Response.json({
        message: 'Discovery phase completed',
        discoveryId,
        type: 'dm',
        totalCount,
        itemsDiscovered: products.length,
      })
    }

    // Phase 2: Crawling (discovered/crawling -> crawling -> completed)
    if (discovery.status === 'discovered' || discovery.status === 'crawling') {
      await payload.update({
        collection: 'dm-discoveries',
        id: discoveryId,
        data: { status: 'crawling' },
      })

      // Navigate to site and accept cookies
      await page.goto(driver.getBaseUrl(), { waitUntil: 'domcontentloaded' })
      await driver.acceptCookies(page)

      let itemsCrawled = discovery.itemsCrawled || 0
      let itemsFailed = discovery.itemsFailed || 0
      let processedThisTick = 0

      // Process items until time limit or batch limit
      while (
        Date.now() - startTime < TICK_DURATION_MS &&
        processedThisTick < DM_ITEMS_PER_TICK
      ) {
        // Get next pending item
        const pendingItems = await payload.find({
          collection: 'dm-discovery-items',
          where: {
            discovery: { equals: discoveryId },
            status: { equals: 'pending' },
          },
          limit: 1,
        })

        if (pendingItems.docs.length === 0) {
          // All items processed
          await payload.update({
            collection: 'dm-discoveries',
            id: discoveryId,
            data: {
              status: 'completed',
              itemsCrawled,
              itemsFailed,
              completedAt: new Date().toISOString(),
            },
          })

          await browser.close()

          return Response.json({
            message: 'Crawling completed',
            discoveryId,
            type: 'dm',
            itemsCrawled,
            itemsFailed,
          })
        }

        const item = pendingItems.docs[0]
        const productId = await driver.crawlProduct(page, item.gtin, item.productUrl || null, payload)

        if (productId !== null) {
          await payload.update({
            collection: 'dm-discovery-items',
            id: item.id,
            data: { status: 'crawled', product: productId },
          })
          itemsCrawled++
        } else {
          await payload.update({
            collection: 'dm-discovery-items',
            id: item.id,
            data: { status: 'failed' },
          })
          itemsFailed++
        }

        // Save progress after each item for real-time updates
        await payload.update({
          collection: 'dm-discoveries',
          id: discoveryId,
          data: {
            itemsCrawled,
            itemsFailed,
          },
        })

        processedThisTick++

        // Random delay between products
        await page.waitForTimeout(Math.floor(Math.random() * 500) + 500)
      }

      await browser.close()

      // Check remaining
      const remaining = await payload.count({
        collection: 'dm-discovery-items',
        where: {
          discovery: { equals: discoveryId },
          status: { equals: 'pending' },
        },
      })

      return Response.json({
        message: 'Tick completed',
        discoveryId,
        type: 'dm',
        processedThisTick,
        itemsCrawled,
        itemsFailed,
        remainingPending: remaining.totalDocs,
      })
    }

    await browser.close()
    return Response.json({
      message: 'Discovery already completed or failed',
      discoveryId,
      type: 'dm',
      status: discovery.status,
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
      discoveryId,
      type: 'dm',
    }, { status: 500 })
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Tick API',
    usage: 'POST /api/tick',
    description: 'Processes pending discovery jobs incrementally. Call repeatedly via cron. Randomly selects between ingredients and DM discoveries.',
    supportedDiscoveries: [
      {
        type: 'ingredients',
        collection: 'ingredients-discoveries',
        description: 'Discovers ingredients from CosIng API',
      },
      {
        type: 'dm',
        collection: 'dm-discoveries',
        description: 'Discovers and crawls products from dm.de',
      },
    ],
  })
}
