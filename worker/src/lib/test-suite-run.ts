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
import { getOpenAI } from '@/lib/openai'

const log = createLogger('TestSuiteRun')

type PhaseName = 'searches' | 'discoveries' | 'crawls' | 'aggregations' | 'videoDiscoveries' | 'videoCrawls' | 'videoProcessings'

interface AiCheckResult {
  question: string
  answer: boolean
  reasoning: string
}

interface AiCheckResults {
  score: number
  threshold: number
  passed: boolean
  results: AiCheckResult[]
}

interface TestResult {
  phase: PhaseName
  entryIndex: number
  identifier: string
  passed: boolean
  checkSchema?: Record<string, unknown>
  record?: Record<string, unknown>
  schemaErrors?: string[]
  aiCheckResults?: AiCheckResults
}

interface PhaseState {
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped'
  jobIds: number[]
  jobCollection: string
  validationResults: Array<{
    entryIndex: number
    passed: boolean
    errors?: string[]
    aiCheckResults?: AiCheckResults
    checkSchema?: Record<string, unknown>
    record?: Record<string, unknown>
    identifier?: string
  }>
}

type PhasesMap = Record<PhaseName, PhaseState>

const PHASE_ORDER: PhaseName[] = ['searches', 'discoveries', 'crawls', 'aggregations', 'videoDiscoveries', 'videoCrawls', 'videoProcessings']

const PHASE_TO_COLLECTION: Record<PhaseName, string> = {
  searches: 'product-searches',
  discoveries: 'product-discoveries',
  crawls: 'product-crawls',
  aggregations: 'product-aggregations',
  videoDiscoveries: 'video-discoveries',
  videoCrawls: 'video-crawls',
  videoProcessings: 'video-processings',
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
    videoDiscoveries: { status: 'pending', jobIds: [], jobCollection: 'video-discoveries', validationResults: [] },
    videoCrawls: { status: 'pending', jobIds: [], jobCollection: 'video-crawls', validationResults: [] },
    videoProcessings: { status: 'pending', jobIds: [], jobCollection: 'video-processings', validationResults: [] },
  }

  // Count non-empty phases
  const nonEmptyPhases = PHASE_ORDER.filter(p => {
    const entries = suite[p] as unknown[] | undefined
    return entries && entries.length > 0
  })

  const maxAge = (suite.maxAge as number) ?? 0

  jlog.event('test_suite.started', { suiteName, phases: nonEmptyPhases.length })
  log.banner(`TEST SUITE: ${suiteName}`, { jobId, phases: nonEmptyPhases.join(', '), maxAge })

  let passedCount = 0
  let failedCount = 0
  const allResults: TestResult[] = []

  try {
    for (const phase of PHASE_ORDER) {
      const entries = (suite[phase] as Array<Record<string, unknown>>) ?? []

      if (entries.length === 0) {
        phases[phase].status = 'skipped'
        jlog.event('test_suite.phase_skipped', { phase })
        continue
      }

      // ── Create jobs (or reuse existing data) for this phase ──
      phases[phase].status = 'running'
      const collection = PHASE_TO_COLLECTION[phase]
      const jobIds: number[] = []
      const newJobIds: number[] = []
      let reusedCount = 0

      for (const entry of entries) {
        const reusedId = maxAge > 0 ? await tryReuseEntry(client, phase, entry, maxAge) : null
        if (reusedId !== null) {
          jobIds.push(reusedId)
          reusedCount++
        } else {
          const jobData = buildJobData(phase, entry)
          const job = await client.create({ collection, data: jobData })
          jobIds.push(job.id as number)
          newJobIds.push(job.id as number)
        }
      }

      phases[phase].jobIds = jobIds
      jlog.event('test_suite.phase_started', { phase, jobs: newJobIds.length })

      // Update run with current phase state
      await client.update({
        collection: 'test-suite-runs',
        id: jobId,
        data: { currentPhase: phase, phases },
      })

      // ── Poll until newly created jobs complete (reused entries skip polling) ──
      if (newJobIds.length > 0) {
        const pollResult = await pollJobsUntilDone(client, collection, newJobIds, heartbeat, jlog)

        if (pollResult.failed) {
          phases[phase].status = 'failed'
          failedCount++
          const error = `Job ${pollResult.failedJobId} in phase "${phase}" failed`
          jlog.event('test_suite.phase_failed', { phase, error })
          await failRun(client, jobId, phases, error, passedCount, failedCount, allResults)
          log.bannerEnd(`TEST SUITE: ${suiteName}`, false, { phase, error: error.slice(0, 80) })
          return
        }
      }

      // ── Validate DB records ──
      const validationResults = await validatePhase(client, phase, entries, jobIds, collection, jlog)
      phases[phase].validationResults = validationResults

      // Accumulate flat results for the results field
      for (const vr of validationResults) {
        allResults.push({
          phase,
          entryIndex: vr.entryIndex,
          identifier: vr.identifier ?? `entry-${vr.entryIndex}`,
          passed: vr.passed,
          checkSchema: vr.checkSchema,
          record: vr.record,
          schemaErrors: vr.errors,
          aiCheckResults: vr.aiCheckResults,
        })
      }

      const allPassed = validationResults.every(r => r.passed)
      if (!allPassed) {
        phases[phase].status = 'failed'
        failedCount++
        const failedChecks = validationResults.filter(r => !r.passed)
        const errorDetails = failedChecks.map(r => `Entry ${r.entryIndex}: ${r.errors?.join('; ')}`).join('\n')
        jlog.event('test_suite.phase_failed', { phase, error: errorDetails.slice(0, 200) })
        await failRun(client, jobId, phases, `Validation failed in "${phase}":\n${errorDetails}`, passedCount, failedCount, allResults)
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
        data: { phases, passed: passedCount, results: allResults },
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
        results: allResults,
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
    await failRun(client, jobId, phases, error, passedCount, failedCount + 1, allResults)
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
    case 'videoDiscoveries':
      return {
        channelUrl: entry.channelUrl,
        maxVideos: entry.maxVideos ?? undefined,
        status: 'pending',
      }
    case 'videoCrawls':
      return {
        type: 'selected_urls',
        urls: entry.urls,
        status: 'pending',
      }
    case 'videoProcessings':
      return {
        type: 'selected_urls',
        urls: entry.urls,
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

function getIdentifier(phase: PhaseName, entry: Record<string, unknown>): string {
  switch (phase) {
    case 'searches': return (entry.query as string) ?? 'entry'
    case 'discoveries': return (entry.sourceUrl as string) ?? 'entry'
    case 'crawls': return (entry.urls as string)?.split('\n')[0]?.trim() ?? 'entry'
    case 'aggregations': return (entry.gtins as string)?.split('\n')[0]?.trim() ?? 'entry'
    case 'videoDiscoveries': return (entry.channelUrl as string) ?? 'entry'
    case 'videoCrawls':
    case 'videoProcessings': return (entry.urls as string)?.split('\n')[0]?.trim() ?? 'entry'
  }
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
    const aiChecks = (phase === 'aggregations' ? entry.aiChecks : undefined) as Array<{ question: string }> | undefined
    const aiCheckThreshold = (phase === 'aggregations' ? (entry.aiCheckThreshold as number) ?? 0.75 : 0.75)

    if (!checkSchema && (!aiChecks || aiChecks.length === 0)) {
      results.push({ entryIndex: i, passed: true, identifier: getIdentifier(phase, entry) })
      continue
    }

    let record: Record<string, unknown> | null = null

    try {
      switch (phase) {
        case 'searches':
        case 'discoveries': {
          // Validate the job record with productUrls split into an array
          if (jobIds[i]) {
            const job = await client.findByID({ collection, id: jobIds[i] }) as Record<string, unknown>
            const productUrls = ((job.productUrls as string) ?? '').split('\n').filter(Boolean)
            record = { ...job, productUrls }
          }
          break
        }
        case 'crawls': {
          // For each URL in the entry, fetch the source-variant with resolved relations (depth=2)
          // and include all source-variants for the same source-product
          const urls = (entry.urls as string)?.split('\n').map(u => u.trim()).filter(Boolean) ?? []
          const allVariants: Record<string, unknown>[] = []
          for (const url of urls) {
            const variants = await client.find({
              collection: 'source-variants',
              where: { sourceUrl: { equals: url } },
              limit: 1,
              depth: 2,
            })
            if (variants.docs[0]) allVariants.push(variants.docs[0] as unknown as Record<string, unknown>)
          }
          // Validate against the full array if multiple URLs, or the single record
          record = allVariants.length === 1 ? allVariants[0] : (allVariants.length > 0 ? { variants: allVariants } as any : null)
          break
        }
        case 'aggregations': {
          // For each GTIN, fetch product-variant with resolved relations (depth=2)
          const gtins = (entry.gtins as string)?.split('\n').map(g => g.trim()).filter(Boolean) ?? []
          const allVariants: Record<string, unknown>[] = []
          for (const gtin of gtins) {
            const variants = await client.find({
              collection: 'product-variants',
              where: { gtin: { equals: gtin } },
              limit: 1,
              depth: 2,
            })
            if (variants.docs[0]) allVariants.push(variants.docs[0] as unknown as Record<string, unknown>)
          }
          record = allVariants.length === 1 ? allVariants[0] : (allVariants.length > 0 ? { variants: allVariants } as any : null)
          break
        }
        case 'videoDiscoveries': {
          // Same pattern as searches/discoveries — validate the job record
          if (jobIds[i]) {
            const job = await client.findByID({ collection, id: jobIds[i] }) as Record<string, unknown>
            const videoUrls = ((job.videoUrls as string) ?? '').split('\n').filter(Boolean)
            record = { ...job, videoUrls }
          }
          break
        }
        case 'videoCrawls':
        case 'videoProcessings': {
          // For each URL, fetch the video record with resolved relations (depth=2)
          const urls = (entry.urls as string)?.split('\n').map(u => u.trim()).filter(Boolean) ?? []
          const allVideos: Record<string, unknown>[] = []
          for (const url of urls) {
            const videos = await client.find({
              collection: 'videos',
              where: { externalUrl: { equals: url } },
              limit: 1,
              depth: 2,
            })
            if (videos.docs[0]) allVideos.push(videos.docs[0] as unknown as Record<string, unknown>)
          }
          record = allVideos.length === 1 ? allVideos[0] : (allVideos.length > 0 ? { videos: allVideos } as any : null)
          break
        }
      }

      // Schema validation
      let schemaPassed = true
      let schemaErrors: string[] | undefined
      if (checkSchema) {
        const validate = ajv.compile(checkSchema)
        schemaPassed = record ? validate(record) : false
        schemaErrors = validate.errors?.map(e => `${e.instancePath || '/'} ${e.message}`) ?? (record ? [] : ['Record not found'])
        if (!schemaPassed) {
          jlog.event('test_suite.validation_failed', { phase, entry: i, errors: schemaErrors.join('; ').slice(0, 200) })
        }
      }

      // AI checks (aggregations only)
      let aiCheckResults: AiCheckResults | undefined
      if (aiChecks && aiChecks.length > 0 && record) {
        aiCheckResults = await runAiChecks(record, aiChecks, aiCheckThreshold, jlog, phase, i)
      }

      const aiPassed = !aiCheckResults || aiCheckResults.passed
      const passed = schemaPassed && aiPassed

      results.push({
        entryIndex: i,
        passed,
        errors: schemaPassed ? undefined : schemaErrors,
        aiCheckResults,
        checkSchema: checkSchema ?? undefined,
        record: record ?? undefined,
        identifier: getIdentifier(phase, entry),
      })
    } catch (e) {
      const error = `Validation error: ${e instanceof Error ? e.message : String(e)}`
      results.push({ entryIndex: i, passed: false, errors: [error], identifier: getIdentifier(phase, entry) })
    }
  }

  return results
}

/** Check if an entry's data can be reused (fresh enough). Returns reused jobId or null. */
async function tryReuseEntry(
  client: PayloadRestClient,
  phase: PhaseName,
  entry: Record<string, unknown>,
  maxAgeMinutes: number,
): Promise<number | null> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString()

  switch (phase) {
    case 'searches': {
      const results = await client.find({
        collection: 'product-searches',
        where: {
          and: [
            { status: { equals: 'completed' } },
            { completedAt: { greater_than: cutoff } },
            { query: { equals: entry.query } },
          ],
        },
        sort: '-completedAt',
        limit: 1,
      })
      return (results.docs[0]?.id as number) ?? null
    }
    case 'discoveries': {
      const results = await client.find({
        collection: 'product-discoveries',
        where: {
          and: [
            { status: { equals: 'completed' } },
            { completedAt: { greater_than: cutoff } },
            { sourceUrls: { equals: entry.sourceUrl } },
          ],
        },
        sort: '-completedAt',
        limit: 1,
      })
      return (results.docs[0]?.id as number) ?? null
    }
    case 'crawls': {
      const urls = (entry.urls as string)?.split('\n').map(u => u.trim()).filter(Boolean) ?? []
      for (const url of urls) {
        const variants = await client.find({
          collection: 'source-variants',
          where: {
            and: [
              { sourceUrl: { equals: url } },
              { crawledAt: { greater_than: cutoff } },
            ],
          },
          limit: 1,
        })
        if (variants.totalDocs === 0) return null
      }
      return 0 // sentinel — validatePhase doesn't use jobId for crawls
    }
    case 'aggregations': {
      const gtins = (entry.gtins as string)?.split('\n').map(g => g.trim()).filter(Boolean) ?? []
      for (const gtin of gtins) {
        const variants = await client.find({
          collection: 'product-variants',
          where: {
            and: [
              { gtin: { equals: gtin } },
              { updatedAt: { greater_than: cutoff } },
            ],
          },
          limit: 1,
        })
        if (variants.totalDocs === 0) return null
      }
      return 0 // sentinel — validatePhase doesn't use jobId for aggregations
    }
    case 'videoDiscoveries':
    case 'videoCrawls':
    case 'videoProcessings':
      return null // no reuse logic for video phases — always re-run
  }
}

/** Trim product data to reduce token usage before sending to LLM */
function trimProductForAiCheck(record: Record<string, unknown>): Record<string, unknown> {
  const trimmed = JSON.parse(JSON.stringify(record)) as Record<string, unknown>

  function trimVariant(v: Record<string, unknown>): void {
    // Strip priceHistory to latest entry only
    if (Array.isArray(v.priceHistory) && v.priceHistory.length > 0) {
      v.priceHistory = [v.priceHistory[v.priceHistory.length - 1]]
    }
    // Replace images array with count
    if (Array.isArray(v.images)) {
      v.imageCount = v.images.length
      delete v.images
    }
    // Cap ingredientsText
    if (typeof v.ingredientsText === 'string' && v.ingredientsText.length > 2000) {
      v.ingredientsText = v.ingredientsText.slice(0, 2000) + '...'
    }
    // Cap description
    if (typeof v.description === 'string' && v.description.length > 3000) {
      v.description = v.description.slice(0, 3000) + '...'
    }
  }

  // Trim the product-variant itself
  trimVariant(trimmed)

  // Trim sourceVariants if resolved
  if (Array.isArray(trimmed.sourceVariants)) {
    for (const sv of trimmed.sourceVariants) {
      if (sv && typeof sv === 'object') trimVariant(sv as Record<string, unknown>)
    }
  }

  // Trim the resolved product
  if (trimmed.product && typeof trimmed.product === 'object') {
    const product = trimmed.product as Record<string, unknown>
    delete product.scoreHistory
    if (Array.isArray(product.variants)) {
      product.variantCount = product.variants.length
      delete product.variants
    }
    if (Array.isArray(product.images)) {
      product.imageCount = product.images.length
      delete product.images
    }
  }

  return trimmed
}

/** Run AI quality checks against a product record using LLM */
async function runAiChecks(
  record: Record<string, unknown>,
  aiChecks: Array<{ question: string }>,
  threshold: number,
  jlog: ReturnType<typeof log.forJob>,
  phase: string,
  entryIndex: number,
): Promise<AiCheckResults> {
  try {
    const openai = getOpenAI()
    const trimmed = trimProductForAiCheck(record)

    const questionList = aiChecks
      .map((c, i) => `${i + 1}. ${c.question}`)
      .join('\n')

    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      temperature: 0,
      seed: 42,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are a product data quality evaluator. You will receive product data and a list of yes/no questions. For each question, evaluate the product data and answer true (yes) or false (no) with brief reasoning. Respond with JSON: { "results": [{ "questionIndex": 0, "answer": true, "reasoning": "..." }] }',
        },
        {
          role: 'user',
          content: `Product data:\n\`\`\`json\n${JSON.stringify(trimmed, null, 2)}\n\`\`\`\n\nQuestions:\n${questionList}\n\nAnswer each question based on the product data above.`,
        },
      ],
    })

    const content = response.choices[0]?.message?.content
    if (!content) throw new Error('Empty LLM response')

    const parsed = JSON.parse(content) as { results: Array<{ questionIndex: number; answer: boolean; reasoning: string }> }
    if (!Array.isArray(parsed.results)) throw new Error('Invalid response format: missing results array')

    const results: AiCheckResult[] = aiChecks.map((check, i) => {
      const match = parsed.results.find(r => r.questionIndex === i)
      return {
        question: check.question,
        answer: match?.answer === true,
        reasoning: match?.reasoning ?? 'No response for this question',
      }
    })

    const yesCount = results.filter(r => r.answer).length
    const score = yesCount / results.length
    const passed = score >= threshold

    if (!passed) {
      jlog.event('test_suite.validation_failed', {
        phase,
        entry: entryIndex,
        errors: `AI checks failed: ${yesCount}/${results.length} (${(score * 100).toFixed(0)}%) < ${(threshold * 100).toFixed(0)}%`,
      })
    }

    return { score, threshold, passed, results }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    log.warn(`AI check failed for entry ${entryIndex}`, { error })
    return {
      score: 0,
      threshold,
      passed: false,
      results: aiChecks.map(c => ({
        question: c.question,
        answer: false,
        reasoning: `AI check execution failed: ${error}`,
      })),
    }
  }
}

async function failRun(
  client: PayloadRestClient,
  jobId: number,
  phases: PhasesMap,
  reason: string,
  passed: number,
  failed: number,
  results?: TestResult[],
): Promise<void> {
  await client.update({
    collection: 'test-suite-runs',
    id: jobId,
    data: {
      status: 'failed',
      currentPhase: 'done',
      phases,
      results: results ?? null,
      failureReason: reason,
      passed,
      failed,
      completedAt: new Date().toISOString(),
    },
  })
}
