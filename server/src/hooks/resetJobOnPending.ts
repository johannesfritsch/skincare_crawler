import type { CollectionBeforeChangeHook } from 'payload'

/**
 * Resets progress and counter fields when a job's status is set back to "pending".
 *
 * Each job collection declares which fields to zero out via the `resetFields`
 * parameter. This hook checks if status is transitioning TO "pending" from any
 * other value and clears the specified fields plus shared claim/timing fields.
 *
 * Usage:
 *   hooks: {
 *     beforeChange: [
 *       enforceJobClaim,
 *       createResetJobOnPending({
 *         aggregated: 0,
 *         errors: 0,
 *         aggregationProgress: null,
 *       }),
 *     ],
 *   }
 */
export function createResetJobOnPending(
  resetFields: Record<string, unknown>,
): CollectionBeforeChangeHook {
  return async ({ data, originalDoc }) => {
    // Only act when status is transitioning TO pending from another state
    if (data?.status !== 'pending') return data
    if (!originalDoc || originalDoc.status === 'pending') return data

    // If retryCount is being incremented, this is a worker retry — don't reset progress
    if (data.retryCount != null && data.retryCount > (originalDoc.retryCount ?? 0)) return data

    // Reset collection-specific fields
    for (const [field, defaultValue] of Object.entries(resetFields)) {
      data[field] = defaultValue
    }

    // Always reset shared claim fields
    data.claimedAt = null
    data.claimedBy = null
    data.retryCount = 0
    data.failedAt = null
    data.failureReason = null

    // Always reset timing fields
    data.startedAt = null
    data.completedAt = null
    data.scheduledFor = null

    return data
  }
}
