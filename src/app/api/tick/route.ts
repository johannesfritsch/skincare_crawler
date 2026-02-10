import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver as getIngredientsDriver } from '@/lib/ingredients-discovery/driver'
import { getSourceDriver, getSourceDriverBySlug, getAllSourceDrivers } from '@/lib/source-discovery/driver'
import type { SourceDriver } from '@/lib/source-discovery/types'
import { aggregateProduct } from '@/lib/aggregate-product'

export const runtime = 'nodejs'
export const maxDuration = 300

interface ActiveJob {
  type: 'ingredients-discovery' | 'source-discovery' | 'source-crawl' | 'product-aggregation'
  id: number
  status: string
  crawlType?: string
  aggregationType?: string
}

type JobCollection = 'source-discoveries' | 'source-crawls' | 'ingredients-discoveries' | 'product-aggregations'
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
    sourceDiscInProgress, sourceDiscPending,
    crawlInProgress, crawlPending,
    aggInProgress, aggPending,
  ] = await Promise.all([
    payload.find({ collection: 'ingredients-discoveries', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'ingredients-discoveries', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'source-discoveries', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'source-discoveries', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'source-crawls', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'source-crawls', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
    payload.find({ collection: 'product-aggregations', where: { status: { equals: 'in_progress' } }, limit: 10 }),
    payload.find({ collection: 'product-aggregations', where: { status: { equals: 'pending' } }, limit: 10, sort: 'createdAt' }),
  ])

  activeJobs.push(
    ...ingredientsInProgress.docs.map((d) => ({ type: 'ingredients-discovery' as const, id: d.id, status: d.status! })),
    ...ingredientsPending.docs.map((d) => ({ type: 'ingredients-discovery' as const, id: d.id, status: d.status! })),
    ...sourceDiscInProgress.docs.map((d) => ({ type: 'source-discovery' as const, id: d.id, status: d.status! })),
    ...sourceDiscPending.docs.map((d) => ({ type: 'source-discovery' as const, id: d.id, status: d.status! })),
    ...crawlInProgress.docs.map((d) => ({ type: 'source-crawl' as const, id: d.id, status: d.status!, crawlType: d.type || 'all' })),
    ...crawlPending.docs.map((d) => ({ type: 'source-crawl' as const, id: d.id, status: d.status!, crawlType: d.type || 'all' })),
    ...aggInProgress.docs.map((d) => ({ type: 'product-aggregation' as const, id: d.id, status: d.status!, aggregationType: d.type || 'all' })),
    ...aggPending.docs.map((d) => ({ type: 'product-aggregation' as const, id: d.id, status: d.status!, aggregationType: d.type || 'all' })),
  )

  if (activeJobs.length === 0) {
    return Response.json({ message: 'No pending jobs' })
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
    return processIngredientsDiscovery(payload, selected.id)
  } else if (selected.type === 'source-discovery') {
    return processSourceDiscovery(payload, selected.id)
  } else if (selected.type === 'product-aggregation') {
    return processProductAggregation(payload, selected.id)
  } else {
    return processSourceCrawl(payload, selected.id)
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

async function processSourceDiscovery(
  payload: Awaited<ReturnType<typeof getPayload>>,
  discoveryId: number,
) {
  const discovery = await payload.findByID({
    collection: 'source-discoveries',
    id: discoveryId,
  })

  const itemsPerTick = discovery.itemsPerTick ?? undefined
  console.log(`[Source Discovery] Starting with itemsPerTick: ${itemsPerTick ?? 'unlimited'}`)

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
    await createEvent(payload, 'error', 'source-discoveries', discoveryId, errorMsg)
    return Response.json({
      error: errorMsg,
      jobId: discoveryId,
      type: 'source-discovery',
    }, { status: 400 })
  }

  // Mark as in_progress if pending
  if (discovery.status === 'pending') {
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        discovered: 0,
        created: 0,
        existing: 0,
      },
    })
    await createEvent(payload, 'start', 'source-discoveries', discoveryId, `Started source discovery for ${discovery.sourceUrl}`)
  }

  try {
    // Discover all products via API (fast, idempotent)
    const { products } = await driver.discoverProducts(discovery.sourceUrl)

    // Update discovered count
    await payload.update({
      collection: 'source-discoveries',
      id: discoveryId,
      data: {
        discovered: products.length,
      },
    })

    // Calculate offset from already-processed count
    let created = discovery.created || 0
    let existing = discovery.existing || 0
    const offset = created + existing

    // Determine slice to process this tick
    const end = itemsPerTick ? Math.min(offset + itemsPerTick, products.length) : products.length
    const batch = products.slice(offset, end)

    for (const product of batch) {
      const existingProduct = await payload.find({
        collection: 'source-products',
        where: { and: [
          { gtin: { equals: product.gtin } },
          { or: [{ source: { equals: driver.slug } }, { source: { exists: false } }] },
        ] },
        limit: 1,
      })

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
        type: product.category,
        rating: product.rating,
        ratingNum: product.ratingCount,
      }

      if (existingProduct.docs.length === 0) {
        await payload.create({
          collection: 'source-products',
          data: {
            gtin: product.gtin,
            source: driver.slug,
            status: 'uncrawled',
            ...discoveryData,
            priceHistory: priceEntry ? [priceEntry] : [],
          },
        })
        created++
      } else {
        const existingHistory = existingProduct.docs[0].priceHistory ?? []
        await payload.update({
          collection: 'source-products',
          id: existingProduct.docs[0].id,
          data: {
            source: driver.slug,
            ...discoveryData,
            ...(priceEntry ? { priceHistory: [...existingHistory, priceEntry] } : {}),
          },
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

    // Check if all products processed
    if (created + existing >= products.length) {
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
      await createEvent(payload, 'success', 'source-discoveries', discoveryId, `Completed: ${products.length} discovered, ${created} created, ${existing} existing`)

      return Response.json({
        message: 'Discovery completed',
        jobId: discoveryId,
        type: 'source-discovery',
        discovered: products.length,
        created,
        existing,
      })
    }

    // More products remaining, stay in_progress
    return Response.json({
      message: 'Tick completed',
      jobId: discoveryId,
      type: 'source-discovery',
      discovered: products.length,
      created,
      existing,
      remaining: products.length - (created + existing),
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
    await createEvent(payload, 'error', 'source-discoveries', discoveryId, errorMsg)

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
) {
  let crawl = await payload.findByID({
    collection: 'source-crawls',
    id: crawlId,
  })

  const itemsPerTick = crawl.itemsPerTick ?? 10
  console.log(`[Source Crawl] Starting with itemsPerTick: ${itemsPerTick}`)

  // Initialize if pending
  const isFirstTick = crawl.status === 'pending'
  if (isFirstTick) {
    await payload.update({
      collection: 'source-crawls',
      id: crawlId,
      data: {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        crawled: 0,
        errors: 0,
      },
    })
    await createEvent(payload, 'start', 'source-crawls', crawlId, `Started source crawl (source=${crawl.source || 'all'}, type=${crawl.type || 'all'}, scope=${crawl.scope ?? 'uncrawled_only'})`)
    crawl = await payload.findByID({
      collection: 'source-crawls',
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
        collection: 'source-crawls',
        id: crawlId,
        data: { status: 'failed', completedAt: new Date().toISOString() },
      })
      await createEvent(payload, 'error', 'source-crawls', crawlId, `No driver found for source: ${resolvedSource}`)
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

  // Read scope and minimum crawl age settings
  const scope = crawl.scope ?? 'uncrawled_only'
  const minCrawlAge = crawl.minCrawlAge
  const minCrawlAgeUnit = crawl.minCrawlAgeUnit

  console.log(`[Source Crawl] id=${crawlId}, source=${resolvedSource}, type=${crawl.type}, scope=${scope}, drivers=[${drivers.map((d) => d.slug).join(', ')}], isFirstTick=${isFirstTick}, gtins=${gtinList ? gtinList.join(',') : 'all'}`)

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

  // On first tick, reset products to uncrawled if scope includes re-crawl
  if (isFirstTick && scope === 'recrawl') {
    let crawledBefore: Date | undefined
    if (minCrawlAge && minCrawlAgeUnit) {
      const multipliers: Record<string, number> = { minutes: 60000, hours: 3600000, days: 86400000, weeks: 604800000 }
      crawledBefore = new Date(Date.now() - minCrawlAge * (multipliers[minCrawlAgeUnit] ?? 86400000))
      console.log(`[Source Crawl] Re-crawl with minCrawlAge: ${minCrawlAge} ${minCrawlAgeUnit} (crawledBefore: ${crawledBefore.toISOString()})`)
    }
    for (const driver of drivers) {
      await driver.resetProducts(payload, gtinList, crawledBefore)
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

      const products = await driver.findUncrawledProducts(payload, {
        gtins: gtinList,
        limit: remainingBudget,
      })

      if (products.length === 0) {
        console.log(`[Source Crawl] [${driver.slug}] No uncrawled products found, skipping`)
        continue
      }

      console.log(`[Source Crawl] [${driver.slug}] Found ${products.length} uncrawled products: ${products.map((p) => p.gtin).join(', ')}`)

      for (const product of products) {
        const productId = await driver.crawlProduct(
          product.gtin,
          payload,
        )

        if (productId !== null) {
          await driver.markProductStatus(payload, product.id, 'crawled')
          crawled++
          console.log(`[Source Crawl] [${driver.slug}] Crawled ${product.gtin} -> source-product #${productId}`)
        } else {
          await driver.markProductStatus(payload, product.id, 'failed')
          errors++
          console.log(`[Source Crawl] [${driver.slug}] Failed to crawl ${product.gtin}`)
        }

        processedThisTick++
        remainingBudget--

        await payload.update({
          collection: 'source-crawls',
          id: crawlId,
          data: { crawled, errors },
        })
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
      await createEvent(payload, 'success', 'source-crawls', crawlId, `Completed: ${crawled} crawled, ${errors} errors`)

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
    await createEvent(payload, 'error', 'source-crawls', crawlId, errorMsg)

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

      // Check if Product with same GTIN already has lastAggregatedAt set
      const existingProducts = await payload.find({
        collection: 'products',
        where: { gtin: { equals: sourceProduct.gtin } },
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
            gtin: sourceProduct.gtin,
            name: sourceProduct.name || undefined,
          },
        })
        productId = newProduct.id
      }

      // Run per-GTIN aggregation logic
      const result = await aggregateProduct(payload, productId, sourceProduct, sourceProduct.source || 'dm')
      processedAggregations++
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        aggregated++
      } else {
        errors++
        await createEvent(payload, 'error', 'product-aggregations', jobId, `GTIN ${sourceProduct.gtin}: ${result.error}`)
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
  job: { aggregated?: number | null; errors?: number | null; tokensUsed?: number | null; gtins?: string | null },
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

  try {
    for (const gtin of gtinList) {
      // Find source product with this GTIN
      const sourceProducts = await payload.find({
        collection: 'source-products',
        where: {
          and: [
            { gtin: { equals: gtin } },
            { status: { equals: 'crawled' } },
          ],
        },
        limit: 1,
      })

      if (sourceProducts.docs.length === 0) {
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

      const sourceProduct = sourceProducts.docs[0]

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
            name: sourceProduct.name || undefined,
          },
        })
        productId = newProduct.id
      }

      // Run per-GTIN aggregation logic
      const result = await aggregateProduct(payload, productId, sourceProduct, sourceProduct.source || 'dm')
      tokensUsed += result.tokensUsed ?? 0

      if (result.success) {
        aggregated++
      } else {
        errors++
        await createEvent(payload, 'error', 'product-aggregations', jobId, `GTIN ${gtin}: ${result.error}`)
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

export const GET = async () => {
  return Response.json({ message: 'POST /api/tick to process pending jobs' })
}
