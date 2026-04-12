import type { PayloadHandler } from 'payload'

/**
 * POST /api/start-test-suite-run
 * Body: { testSuiteId: number }
 * Creates a pending test-suite-run. The worker picks it up and orchestrates execution.
 */
export const handleStartTestSuiteRun: PayloadHandler = async (req) => {
  if (!req.user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json!() as { testSuiteId?: number }
  const testSuiteId = body?.testSuiteId
  if (!testSuiteId) {
    return Response.json({ error: 'testSuiteId is required' }, { status: 400 })
  }

  // Verify the test suite exists
  try {
    await req.payload.findByID({ collection: 'test-suites', id: testSuiteId })
  } catch {
    return Response.json({ error: 'Test suite not found' }, { status: 404 })
  }

  // Create a pending run — the worker will claim and orchestrate it
  const run = await req.payload.create({
    collection: 'test-suite-runs',
    data: {
      testSuite: testSuiteId,
      status: 'pending',
      currentPhase: 'pending',
    },
  })

  return Response.json({ success: true, runId: run.id })
}
