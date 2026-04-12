'use server'

/**
 * Test suite actions — validation logic.
 * The worker orchestrates test suite runs; this file provides
 * shared types and the getTestSuiteRunStatus polling helper.
 */

export async function getTestSuiteRunStatus(
  collection: string,
  jobId: number,
): Promise<{ status: string; currentPhase?: string; errors?: number }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SERVER_URL || ''}/api/test-suite-runs/${jobId}?depth=0`)
  if (!res.ok) return { status: 'unknown' }
  const doc = await res.json()
  return {
    status: doc.status ?? 'unknown',
    currentPhase: doc.currentPhase,
    errors: doc.failed ?? 0,
  }
}
