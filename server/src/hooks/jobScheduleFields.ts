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
 * - `schedule`: cron expression (UTC) for recurring execution
 * - `scheduleLimit`: max number of runs (0 = unlimited)
 * - `scheduleCount`: how many times this job has completed (auto-incremented)
 * - `scheduledFor`: computed next-run datetime (auto-set from cron)
 */
export const jobScheduleFields: Field[] = [
  {
    name: 'schedule',
    type: 'text',
    label: 'Cron Schedule (UTC)',
    admin: {
      position: 'sidebar',
      components: {
        Field: '@/components/CronExpressionField',
      },
      description: 'Cron expression in UTC (e.g. 0 6 * * * = daily at 06:00 UTC). Leave empty for one-time jobs.',
    },
  },
  {
    name: 'scheduleLimit',
    type: 'number',
    label: 'Run Limit',
    defaultValue: 0,
    min: 0,
    admin: {
      position: 'sidebar',
      description: 'Maximum number of runs. 0 = unlimited.',
      condition: (data) => Boolean(data?.schedule),
    },
  },
  {
    name: 'scheduleCount',
    type: 'number',
    label: 'Run Count',
    defaultValue: 0,
    admin: {
      position: 'sidebar',
      readOnly: true,
      description: 'How many times this job has completed.',
      condition: (data) => Boolean(data?.schedule),
    },
  },
  {
    name: 'scheduledFor',
    type: 'date',
    label: 'Next Run',
    admin: {
      position: 'sidebar',
      readOnly: true,
      date: {
        pickerAppearance: 'dayAndTime',
      },
      description: 'When this job will transition to pending. Set automatically from cron.',
      condition: (data) => data?.status === 'scheduled',
    },
  },
]
