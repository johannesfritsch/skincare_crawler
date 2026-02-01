import { getPayload } from 'payload'
import configPromise from '@payload-config'
import { getDriver } from '@/lib/ingredients-discovery/driver'

export const runtime = 'nodejs'
export const maxDuration = 60

const TICK_DURATION_MS = 25_000 // Process for ~25 seconds

export const POST = async () => {
  const startTime = Date.now()
  const payload = await getPayload({ config: configPromise })

  // Find an in_progress discovery, or a pending one
  let discovery = await payload.find({
    collection: 'ingredients-discoveries',
    where: { status: { equals: 'in_progress' } },
    limit: 1,
  }).then((res) => res.docs[0])

  if (!discovery) {
    discovery = await payload.find({
      collection: 'ingredients-discoveries',
      where: { status: { equals: 'pending' } },
      limit: 1,
      sort: 'createdAt',
    }).then((res) => res.docs[0])
  }

  if (!discovery) {
    return Response.json({ message: 'No pending discoveries' })
  }

  // Get driver for source URL
  const driver = getDriver(discovery.sourceUrl)
  if (!driver) {
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discovery.id,
      data: {
        status: 'failed',
        error: `No driver found for URL: ${discovery.sourceUrl}`,
        completedAt: new Date().toISOString(),
      },
    })
    return Response.json({
      error: `No driver found for URL: ${discovery.sourceUrl}`,
      discoveryId: discovery.id,
    }, { status: 400 })
  }

  // Initialize if pending
  if (discovery.status === 'pending') {
    const termQueue = driver.getInitialTermQueue()
    await payload.update({
      collection: 'ingredients-discoveries',
      id: discovery.id,
      data: {
        status: 'in_progress',
        termQueue,
        startedAt: new Date().toISOString(),
      },
    })
    discovery = await payload.findByID({
      collection: 'ingredients-discoveries',
      id: discovery.id,
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
            id: discovery.id,
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
            discoveryId: discovery.id,
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
        id: discovery.id,
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
      id: discovery.id,
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
      discoveryId: discovery.id,
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
    console.error('Discovery error:', error)

    await payload.update({
      collection: 'ingredients-discoveries',
      id: discovery.id,
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      },
    })

    return Response.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      discoveryId: discovery.id,
    }, { status: 500 })
  }
}

export const GET = async () => {
  return Response.json({
    message: 'Tick API',
    usage: 'POST /api/tick',
    description: 'Processes pending discovery jobs incrementally. Call repeatedly via cron.',
  })
}
