import type { Field } from 'payload'

/**
 * Shared status options for all job collections.
 * Replaces the identical inline arrays that were duplicated across 9 collections.
 */
export const JOB_STATUS_OPTIONS = [
  { label: 'Pending', value: 'pending' },
  { label: 'Scheduled', value: 'scheduled' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Failed', value: 'failed' },
] as const

/**
 * Shared status field for all job collections. Use this instead of defining
 * the status select field inline in each collection config.
 */
export const jobStatusField: Field = {
  name: 'status',
  type: 'select',
  label: 'Status',
  defaultValue: 'pending',
  options: [...JOB_STATUS_OPTIONS],
  index: true,
  admin: {
    position: 'sidebar',
  },
}

/**
 * Scheduling fields for recurring/deferred job execution. Spread these into
 * every job collection's `fields` array alongside `jobClaimFields`.
 *
 * The 4 data fields are hidden from the form — all UI is handled by the
 * ScheduleWidget component rendered via the `scheduleWidget` UI field.
 *
 * - `schedule`: cron expression (UTC) for recurring execution
 * - `scheduleLimit`: max number of runs (0 = unlimited)
 * - `scheduleCount`: how many times this job has completed (auto-incremented)
 * - `scheduledFor`: computed next-run datetime (auto-set from cron)
 * - `scheduleWidget`: UI-only field that renders the compact sidebar widget
 */
export const jobScheduleFields: Field[] = [
  {
    name: 'schedule',
    type: 'text',
    admin: { hidden: true },
  },
  {
    name: 'scheduleLimit',
    type: 'number',
    defaultValue: 0,
    min: 0,
    admin: { hidden: true },
  },
  {
    name: 'scheduleCount',
    type: 'number',
    defaultValue: 0,
    admin: { hidden: true },
  },
  {
    name: 'scheduledFor',
    type: 'date',
    admin: { hidden: true },
  },
  {
    name: 'scheduleWidget',
    type: 'ui',
    admin: {
      position: 'sidebar',
      components: {
        Field: '@/components/ScheduleWidget',
      },
    },
  },
]
