import type { CollectionBeforeChangeHook } from 'payload'

/**
 * Prevents two workers from claiming the same job concurrently.
 *
 * When a worker sets `claimedBy` on a job, this hook checks whether the job
 * is already claimed by a different worker with a recent `claimedAt` timestamp.
 * If the existing claim is still fresh (within the timeout window configured
 * by the worker via the `X-Job-Timeout-Minutes` header), the update is rejected.
 *
 * Stale claims (older than the timeout) are treated as abandoned — the new
 * worker is allowed to take over. Workers refresh `claimedAt` via heartbeat
 * to keep their claims alive.
 *
 * This hook runs inside Payload's DB transaction, so Postgres serialization
 * handles the concurrency even with multiple server instances.
 */
const DEFAULT_JOB_TIMEOUT_MINUTES = 30

export const enforceJobClaim: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
}) => {
  const incomingClaimedBy = data?.claimedBy
  if (!incomingClaimedBy) return data

  const existingClaimedBy =
    typeof originalDoc?.claimedBy === 'object' && originalDoc.claimedBy !== null
      ? originalDoc.claimedBy.id
      : originalDoc?.claimedBy

  // No existing claim — allow
  if (!existingClaimedBy) return data

  // Same worker refreshing its own claim — allow
  if (existingClaimedBy === incomingClaimedBy) return data

  // Different worker trying to claim — check if existing claim is stale
  const existingClaimedAt = originalDoc?.claimedAt
    ? new Date(originalDoc.claimedAt).getTime()
    : 0

  // Read timeout from custom header (set by worker), fall back to default
  const headerValue = typeof req.headers.get === 'function'
    ? req.headers.get('x-job-timeout-minutes')
    : null
  const timeoutMinutes = parseInt(headerValue ?? String(DEFAULT_JOB_TIMEOUT_MINUTES), 10)

  const timeoutMs = timeoutMinutes * 60 * 1000
  const now = Date.now()

  if (existingClaimedAt && (now - existingClaimedAt) < timeoutMs) {
    // Claim is still fresh — reject
    const staleInMinutes = Math.round((now - existingClaimedAt) / 60_000)
    throw new Error(
      `Job is already claimed by worker #${existingClaimedBy} (${staleInMinutes}m ago, timeout=${timeoutMinutes}m). ` +
      `Claim will expire after ${timeoutMinutes}m of inactivity.`,
    )
  }

  // Existing claim is stale — allow takeover
  return data
}
