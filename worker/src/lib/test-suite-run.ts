/**
 * Test Suite Run — Worker-driven orchestration.
 *
 * The worker claims a test-suite-run job, then for each phase
 * (searches → discoveries → crawls → aggregations):
 * 1. Creates real jobs via the REST API
 * 2. Polls until all complete (with heartbeat)
 * 3. Validates DB records against JSON schemas
 * 4. Advances to next phase or fails the run
 */

import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import type { PayloadRestClient } from '@/lib/payload-client'
import { createLogger } from '@/lib/logger'

const log = createLogger('TestSuiteRun')

type PhaseName = 'searches' | 'discoveries' | 'crawls' | 'aggregations'

interface PhaseState {
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  jobIds: number[]
  jobCollection: string
  validationResults: Array<{
    entryIndex: number
    passed: boolean
    errors?: string[]
  }>
}

type PhasesMap = Record<PhaseName, PhaseState>

const PHASE_ORDER: PhaseName[] = ['searches', 'discoveries', 'crawls', 'aggregations']

const PHASE_TO_COLLECTION: Record<PhaseName, string> = {
  searches: 'product-searches',
  discoveries: 'product-discoveries',
  crawls: 'product-crawls',
  aggregations: 'product-aggregations',
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function handleTestSuiteRun(
  client: PayloadRestClient,
  work: Record<string, unknown>,
  heartbeat: () => Promise<void>,
): Promise<void> {
  const jobId = work.jobId as number
  const jlog = log.forJob('test-suite-runs', jobId)

  // Fetch the test suite run and its linked template
  const run = await client.findByID({ collection: 'test-suite-runs', id: jobId }) as Record<string, unknown>
  const testSuiteId = typeof run.testSuite === 'object' ? (run.testSuite as any)?.id : run.testSuite
  if (!testSuiteId) throw new Error('Test suite run has no linked test suite')
  const suite = await client.findByID({ collection: 'test-suites', id: testSuiteId }) as Record<string, unknown>
  const suiteName = (suite.name as string) || 'Unknown'

  const startMs = Date.now()

  // Initialize phases map
  const phases: PhasesMap = {
    searches: { status: 'pending', jobIds: [], jobCollection: 'product-searches', validationResults: [] },
    discoveries: { status: 'pending', jobIds: [], jobCollection: 'product-discoveries', validationResults: [] },
    crawls: { status: 'pending', jobIds: [], jobCollection: 'product-crawls', validationResults: [] },
    aggregations: { status: 'pending', jobIds: [], jobCollection: 'product-aggregations', validationResults: [] },
  }

  // Count non-empty phases
  const nonEmptyPhases = PHASE_ORDER.filter(p => {
    const entries = suite[p] as unknown[] | undefined
    return entries && entries.length > 0
  })

  jlog.event('test_suite.started', { suiteName, phases: nonEmptyPhases.length })
  log.banner(`TEST SUITE: ${suiteName}`, { jobId, phases: nonEmptyPhases.join(', ') })

  let passedCount = 0
  let failedCount = 0

  try {
    for (const phase of PHASE_ORDER) {
      const entries = (suite[phase] as Array<Record<string, unknown>>) ?? []

      if (entries.length === 0) {
        phases[phase].status = 'skipped'
        jlog.event('test_suite.phase_skipped', { phase })
        continue
      }

      // ── Create jobs for this phase ──
      phases[phase].status = 'running'
      const collection = PHASE_TO_COLLECTION[phase]
      const jobIds: number[] = []

      for (const entry of entries) {
        const jobData = buildJobData(phase, entry)
        const job = await client.create({ collection, data: jobData })
        jobIds.push(job.id as number)
      }

      phases[phase].jobIds = jobIds
      jlog.event('test_suite.phase_started', { phase, jobs: jobIds.length })

      // Update run with current phase state
      await client.update({
        collection: 'test-suite-runs',
        id: jobId,
        data: { currentPhase: phase, phases },
      })

      // ── Poll until all jobs complete ──
      const pollResult = await pollJobsUntilDone(client, collection, jobIds, heartbeat, jlog)

      if (pollResult.failed) {
        phases[phase].status = 'failed'
        failedCount++
        const error = `Job ${pollResult.failedJobId} in phase "${phase}" failed`
        jlog.event('test_suite.phase_failed', { phase, error })
        await failRun(client, jobId, phases, error, passedCount, failedCount)
        log.bannerEnd(`TEST SUITE: ${suiteName}`, false, { phase, error: error.slice(0, 80) })
        return
      }

      // ── Validate DB records ──
      const validationResults = await validatePhase(client, phase, entries, jobIds, collection, jlog)
      phases[phase].validationResults = validationResults

      const allPassed = validationResults.every(r => r.passed)
      if (!allPassed) {
        phases[phase].status = 'failed'
        failedCount++
        const failedChecks = validationResults.filter(r => !r.passed)
        const errorDetails = failedChecks.map(r => `Entry ${r.entryIndex}: ${r.errors?.join('; ')}`).join('\n')
        jlog.event('test_suite.phase_failed', { phase, error: errorDetails.slice(0, 200) })
        await failRun(client, jobId, phases, `Validation failed in "${phase}":\n${errorDetails}`, passedCount, failedCount)
        log.bannerEnd(`TEST SUITE: ${suiteName}`, false, { phase, error: 'validation failed' })
        return
      }

      phases[phase].status = 'passed'
      passedCount++
      jlog.event('test_suite.phase_passed', { phase })

      // Update run progress
      await client.update({
        collection: 'test-suite-runs',
        id: jobId,
        data: { phases, passed: passedCount },
      })

      await heartbeat()
    }

    // ── All phases done ──
    const durationMs = Date.now() - startMs
    await client.update({
      collection: 'test-suite-runs',
      id: jobId,
      data: {
        status: 'completed',
        currentPhase: 'done',
        phases,
        passed: passedCount,
        failed: failedCount,
        completedAt: new Date().toISOString(),
      },
    })

    jlog.event('test_suite.completed', { passed: passedCount, failed: failedCount, durationMs })
    jlog.event('job.completed', { collection: 'test-suite-runs', durationMs })
    log.bannerEnd(`TEST SUITE: ${suiteName}`, true, { passed: passedCount, duration: `${(durationMs / 1000).toFixed(1)}s` })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    jlog.event('test_suite.error', { error })
    await failRun(client, jobId, phases, error, passedCount, failedCount + 1)
    log.bannerEnd(`TEST SUITE: ${suiteName}`, false, { error: error.slice(0, 80) })
    throw e
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildJobData(phase: PhaseName, entry: Record<string, unknown>): Record<string, unknown> {
  switch (phase) {
    case 'searches':
      return {
        query: entry.query,
        sources: entry.sources,
        maxResults: entry.maxResults ?? 50,
        status: 'pending',
      }
    case 'discoveries':
      return {
        sourceUrls: entry.sourceUrl,
        status: 'pending',
      }
    case 'crawls':
      return {
        type: 'selected_urls',
        urls: entry.urls,
        crawlVariants: entry.crawlVariants ?? true,
        status: 'pending',
      }
    case 'aggregations':
      return {
        type: 'selected_gtins',
        gtins: entry.gtins,
        status: 'pending',
      }
  }
}

async function pollJobsUntilDone(
  client: PayloadRestClient,
  collection: string,
  jobIds: number[],
  heartbeat: () => Promise<void>,
  jlog: ReturnType<typeof log.forJob>,
): Promise<{ failed: boolean; failedJobId?: number }> {
  const maxWaitMs = 30 * 60 * 1000 // 30 minutes
  const startMs = Date.now()

  while (Date.now() - startMs < maxWaitMs) {
    let allDone = true

    for (const jobId of jobIds) {
      const job = await client.findByID({ collection, id: jobId }) as Record<string, unknown>
      if (job.status === 'failed') {
        return { failed: true, failedJobId: jobId }
      }
      if (job.status !== 'completed') {
        allDone = false
      }
    }

    if (allDone) return { failed: false }

    await heartbeat()
    await sleep(5000)
  }

  return { failed: true, failedJobId: jobIds[0] } // timeout
}

async function validatePhase(
  client: PayloadRestClient,
  phase: PhaseName,
  entries: Array<Record<string, unknown>>,
  jobIds: number[],
  collection: string,
  jlog: ReturnType<typeof log.forJob>,
): Promise<PhaseState['validationResults']> {
  const ajv = new Ajv({ allErrors: true, strict: false })
  addFormats(ajv)

  const results: PhaseState['validationResults'] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const checkSchema = entry.checkSchema as Record<string, unknown> | undefined

    if (!checkSchema) {
      results.push({ entryIndex: i, passed: true })
      continue
    }

    let record: Record<string, unknown> | null = null

    try {
      switch (phase) {
        case 'searches':
        case 'discoveries': {
          // Validate the job record itself
          if (jobIds[i]) {
            const job = await client.findByID({ collection, id: jobIds[i] })
            record = job as unknown as Record<string, unknown>
          }
          break
        }
        case 'crawls': {
          // Query source-variant by first URL
          const url = (entry.urls as string)?.split('\n')[0]?.trim()
          if (url) {
            const variants = await client.find({
              collection: 'source-variants',
              where: { sourceUrl: { equals: url } },
              limit: 1,
            })
            record = (variants.docs[0] as unknown as Record<string, unknown>) ?? null
          }
          break
        }
        case 'aggregations': {
          // Query product-variant by first GTIN
          const gtin = (entry.gtins as string)?.split('\n')[0]?.trim()
          if (gtin) {
            const variants = await client.find({
              collection: 'product-variants',
              where: { gtin: { equals: gtin } },
              limit: 1,
            })
            record = (variants.docs[0] as unknown as Record<string, unknown>) ?? null
          }
          break
        }
      }

      const validate = ajv.compile(checkSchema)
      const passed = record ? validate(record) : false
      const errors = validate.errors?.map(e => `${e.instancePath || '/'} ${e.message}`) ?? (record ? [] : ['Record not found'])

      if (!passed) {
        jlog.event('test_suite.validation_failed', { phase, entry: i, errors: errors.join('; ').slice(0, 200) })
      }

      results.push({ entryIndex: i, passed, errors: passed ? undefined : errors })
    } catch (e) {
      const error = `Validation error: ${e instanceof Error ? e.message : String(e)}`
      results.push({ entryIndex: i, passed: false, errors: [error] })
    }
  }

  return results
}

async function failRun(
  client: PayloadRestClient,
  jobId: number,
  phases: PhasesMap,
  reason: string,
  passed: number,
  failed: number,
): Promise<void> {
  await client.update({
    collection: 'test-suite-runs',
    id: jobId,
    data: {
      status: 'failed',
      currentPhase: 'done',
      phases,
      failureReason: reason,
      passed,
      failed,
      completedAt: new Date().toISOString(),
    },
  })
}
