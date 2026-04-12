import type { Field } from 'payload'

/** Default max retries before a job is marked as failed */
export const DEFAULT_MAX_RETRIES = 3

/**
 * Claim tracking fields for the Progress tab. These show which worker
 * is currently processing the job and when it was claimed.
 */
export const jobClaimProgressFields: Field[] = [
  {
    name: 'claimedAt',
    type: 'date',
    label: 'Claimed At',
    admin: {
      readOnly: true,
      date: {
        pickerAppearance: 'dayAndTime',
      },
      description: 'When the current worker claimed this job',
    },
  },
  {
    name: 'claimedBy',
    type: 'relationship',
    relationTo: 'workers',
    label: 'Claimed By',
    admin: {
      readOnly: true,
      description: 'Worker currently processing this job',
    },
  },
]

/**
 * Retry fields for the sidebar. These control retry behavior and
 * show how many times the job has been retried.
 */
export const jobRetryFields: Field[] = [
  {
    name: 'retryCount',
    type: 'number',
    label: 'Retry Count',
    defaultValue: 0,
    admin: {
      position: 'sidebar',
      readOnly: true,
      description: 'Number of times this job has been retried after failures',
    },
  },
  {
    name: 'maxRetries',
    type: 'number',
    label: 'Max Retries',
    defaultValue: DEFAULT_MAX_RETRIES,
    admin: {
      position: 'sidebar',
      description: 'Maximum number of retries before the job is marked as failed. Set to 0 to disable retries.',
    },
  },
]

/**
 * Retry fields WITHOUT maxRetries — use when maxRetries is placed
 * in a Configuration tab via `maxRetriesField` instead of the sidebar.
 */
export const jobRetryFieldsNoMax: Field[] = jobRetryFields.filter(
  (f) => !('name' in f && f.name === 'maxRetries'),
)


/**
 * Max retries field for placement in a Configuration tab instead of the sidebar.
 * Use this when a job collection has a dedicated Configuration tab.
 */
export const maxRetriesField: Field = {
  name: 'maxRetries',
  type: 'number',
  label: 'Max Retries',
  defaultValue: DEFAULT_MAX_RETRIES,
  admin: {
    description: 'Maximum number of retries before the job is marked as failed. Set to 0 to disable retries.',
  },
}

/**
 * Batch size field for placement in a Configuration tab.
 * Use this when a job collection has a dedicated Configuration tab.
 */
export const batchSizeField: Field = {
  name: 'itemsPerTick',
  type: 'number',
  label: 'Batch Size',
  defaultValue: 10,
  min: 1,
  admin: {
    description: 'Items to process per batch.',
  },
}

/**
 * Standardized progress fields for all job collections.
 * Every job gets: total, completed, errors, startedAt, completedAt.
 * Worker sends counterUpdates: { completed: 1 } or { errors: 1 } everywhere.
 */
export const jobProgressFields: Field[] = [
  {
    type: 'row',
    fields: [
      {
        name: 'total',
        type: 'number',
        label: 'Total',
        defaultValue: 0,
        admin: { readOnly: true, width: '33%' },
      },
      {
        name: 'completed',
        type: 'number',
        label: 'Completed',
        defaultValue: 0,
        admin: { readOnly: true, width: '33%' },
      },
      {
        name: 'errors',
        type: 'number',
        label: 'Errors',
        defaultValue: 0,
        admin: { readOnly: true, width: '33%' },
      },
    ],
  },
  {
    type: 'row',
    fields: [
      {
        name: 'startedAt',
        type: 'date',
        label: 'Started At',
        admin: {
          readOnly: true,
          width: '50%',
          date: { pickerAppearance: 'dayAndTime' },
        },
      },
      {
        name: 'completedAt',
        type: 'date',
        label: 'Completed At',
        admin: {
          readOnly: true,
          width: '50%',
          date: { pickerAppearance: 'dayAndTime' },
        },
      },
    ],
  },
]

/**
 * Failure fields for job collections. Place these inside the Output tab
 * so failure info is visible alongside job results.
 */
export const jobFailureFields: Field[] = [
  {
    name: 'failedAt',
    type: 'date',
    label: 'Failed At',
    admin: {
      readOnly: true,
      date: {
        pickerAppearance: 'dayAndTime',
      },
      description: 'When the job was marked as failed',
    },
  },
  {
    name: 'failureReason',
    type: 'textarea',
    label: 'Failure Reason',
    admin: {
      readOnly: true,
      description: 'Why the job was marked as failed',
    },
  },
]
