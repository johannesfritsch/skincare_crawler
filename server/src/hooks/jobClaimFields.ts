import type { Field } from 'payload'

/** Default max retries before a job is marked as failed */
export const DEFAULT_MAX_RETRIES = 3

/**
 * Shared fields for job claim locking and retry tracking. Add these to every
 * job collection's `fields` array (typically in the sidebar).
 */
export const jobClaimFields: Field[] = [
  {
    name: 'claimedAt',
    type: 'date',
    label: 'Claimed At',
    admin: {
      position: 'sidebar',
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
      position: 'sidebar',
      readOnly: true,
      description: 'Worker currently processing this job',
    },
  },
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
  {
    name: 'failedAt',
    type: 'date',
    label: 'Failed At',
    admin: {
      position: 'sidebar',
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
      position: 'sidebar',
      readOnly: true,
      description: 'Why the job was marked as failed',
    },
  },
]
