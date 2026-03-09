import type { PayloadRestClient } from '@/lib/payload-client'
import { createLogger, type JobCollection } from '@/lib/logger'

const log = createLogger('JobFailure')

/** Default max retries before a job is marked as failed */
export const DEFAULT_MAX_RETRIES = 3

/**
 * Mark a job as failed with a reason. Emits an error event and sets
 * status=failed, failedAt, failureReason.
 */
export async function failJob(
  payload: PayloadRestClient,
  collection: JobCollection,
  jobId: number,
  reason: string,
): Promise<void> {
  const jlog = log.forJob(collection, jobId)

  try {
    await payload.update({
      collection,
      id: jobId,
      data: {
        status: 'failed',
        failedAt: new Date().toISOString(),
        failureReason: reason,
        claimedBy: null,
        claimedAt: null,
      },
    })
    jlog.event('job.failed', { reason })
  } catch (e) {
    log.error('Failed to mark job as failed', { collection, jobId, error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Increment retryCount on a job and either release it for retry or fail it
 * if maxRetries has been exceeded. Returns true if the job was failed.
 */
export async function retryOrFail(
  payload: PayloadRestClient,
  collection: JobCollection,
  jobId: number,
  reason: string,
): Promise<boolean> {
  const jlog = log.forJob(collection, jobId)

  try {
    // Fetch current retry state
    const job = await payload.findByID({ collection, id: jobId })
    const retryCount = ((job as Record<string, unknown>).retryCount as number) ?? 0
    const maxRetries = ((job as Record<string, unknown>).maxRetries as number) ?? DEFAULT_MAX_RETRIES
    const nextRetryCount = retryCount + 1

    if (nextRetryCount > maxRetries) {
      // Exceeded max retries — fail the job
      await payload.update({
        collection,
        id: jobId,
        data: {
          status: 'failed',
          retryCount: nextRetryCount,
          failedAt: new Date().toISOString(),
          failureReason: `Max retries exceeded (${maxRetries}). Last error: ${reason}`,
          claimedBy: null,
          claimedAt: null,
        },
      })
      jlog.event('job.failed_max_retries', { retryCount: nextRetryCount, maxRetries, reason })
      return true
    }

    // Release claim for retry
    await payload.update({
      collection,
      id: jobId,
      data: {
        retryCount: nextRetryCount,
        claimedBy: null,
        claimedAt: null,
      },
    })
    jlog.event('job.retrying', { retryCount: nextRetryCount, maxRetries, reason })
    return false
  } catch (e) {
    log.error('Failed to update retry state', { collection, jobId, error: e instanceof Error ? e.message : String(e) })
    return false
  }
}
