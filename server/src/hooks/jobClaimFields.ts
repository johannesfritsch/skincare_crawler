import type { Field } from 'payload'

/**
 * Shared fields for job claim locking. Add these to every job collection's
 * `fields` array (typically in the sidebar).
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
]
