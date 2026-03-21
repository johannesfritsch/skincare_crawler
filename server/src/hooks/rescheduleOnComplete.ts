import { Cron } from 'croner'
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'

/**
 * beforeChange hook that auto-computes `scheduledFor` whenever a job's status
 * is set to `scheduled` and it has a `schedule` cron expression. This handles:
 * - Manual status change to "scheduled" in the admin UI
 * - The rescheduleOnComplete afterChange hook setting status to "scheduled"
 *
 * If `scheduledFor` is already set (e.g. manually by the admin), it is preserved.
 *
 * Usage:
 *   hooks: {
 *     beforeChange: [enforceJobClaim, computeScheduledFor],
 *   }
 */
export const computeScheduledFor: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
}) => {
  if (data?.status !== 'scheduled') return data

  const schedule = data.schedule ?? originalDoc?.schedule
  if (!schedule) return data

  // If scheduledFor is already being set explicitly, don't override
  if (data.scheduledFor) return data

  try {
    const cron = new Cron(schedule, { timezone: 'UTC' })
    const nextRun = cron.nextRun()
    if (nextRun) {
      data.scheduledFor = nextRun.toISOString()
    }
  } catch {
    // Invalid cron — leave scheduledFor unset; the UI shows validation errors
  }

  return data
}

/**
 * afterChange hook that reschedules a recurring job when it completes.
 *
 * When a job transitions to `completed` and has a `schedule` cron expression:
 * 1. Increments `scheduleCount`
 * 2. If `scheduleLimit > 0` and `scheduleCount >= scheduleLimit`, the job stays
 *    completed and `scheduledFor`/`schedule` are cleared — the run limit is reached.
 * 3. Otherwise, sets `status: 'scheduled'`. The `computeScheduledFor` beforeChange
 *    hook then auto-computes the next `scheduledFor` datetime.
 *
 * Job lifecycle: scheduled → pending → in_progress → completed → scheduled → ...
 *               (or completed if run limit reached)
 *
 * Usage:
 *   hooks: {
 *     beforeChange: [enforceJobClaim, computeScheduledFor],
 *     afterChange: [rescheduleOnComplete],
 *   }
 */
export const rescheduleOnComplete: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  collection,
  req,
  context,
}) => {
  // Skip if explicitly marked (prevents infinite recursion)
  if (context.skipReschedule) return doc

  // Only act on transitions TO completed
  if (doc.status !== 'completed') return doc
  if (previousDoc?.status === 'completed') return doc

  // Only reschedule if a cron schedule is set
  const schedule = doc.schedule as string | undefined | null
  if (!schedule) return doc

  const scheduleCount = ((doc.scheduleCount as number) ?? 0) + 1
  const scheduleLimit = (doc.scheduleLimit as number) ?? 0

  // Check if run limit reached
  if (scheduleLimit > 0 && scheduleCount >= scheduleLimit) {
    // Final run — stay completed, clear scheduling fields
    try {
      await req.payload.update({
        collection: collection.slug as any,
        id: doc.id,
        data: {
          scheduleCount,
          schedule: null,
          scheduledFor: null,
        },
        req,
        context: { skipReschedule: true },
      })

      req.payload.logger.info(
        `[reschedule] ${collection.slug}#${doc.id} completed final run (${scheduleCount}/${scheduleLimit})`,
      )
    } catch (err) {
      req.payload.logger.error(
        `[reschedule] Failed to finalize ${collection.slug}#${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    return doc
  }

  // Reschedule for next run
  try {
    await req.payload.update({
      collection: collection.slug as any,
      id: doc.id,
      data: {
        status: 'scheduled',
        scheduleCount,
      },
      req,
      context: { skipReschedule: true },
    })

    req.payload.logger.info(
      `[reschedule] ${collection.slug}#${doc.id} → scheduled (run ${scheduleCount}${scheduleLimit > 0 ? `/${scheduleLimit}` : ''})`,
    )

    // Emit rescheduled event (best-effort)
    try {
      const nextRun = new Cron(schedule, { timezone: 'UTC' }).nextRun()
      await req.payload.create({
        collection: 'events',
        data: {
          type: 'info',
          name: 'job.rescheduled',
          level: 'info',
          component: 'server',
          message: `Rescheduled ${collection.slug}#${doc.id} for ${nextRun?.toISOString() ?? 'unknown'} (run ${scheduleCount}${scheduleLimit > 0 ? `/${scheduleLimit}` : ''})`,
          data: {
            collection: collection.slug,
            jobId: doc.id,
            schedule,
            scheduleCount,
            scheduleLimit,
            nextScheduledFor: nextRun?.toISOString() ?? null,
          },
          labels: [{ label: 'scheduling' }],
          job: { relationTo: collection.slug as 'product-crawls', value: doc.id },
        },
        req,
      })
    } catch {
      // Event emission is best-effort
    }
  } catch (err) {
    req.payload.logger.error(
      `[reschedule] Failed to reschedule ${collection.slug}#${doc.id}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return doc
}
