import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'

export const IngredientsDiscoveries: CollectionConfig = {
  slug: 'ingredients-discoveries',
  labels: {
    singular: 'Ingredients Discovery',
    plural: 'Ingredients Discoveries',
  },
  admin: {
    useAsTitle: 'sourceUrl',
    defaultColumns: ['sourceUrl', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Ingredients',
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor],
    afterChange: [rescheduleOnComplete],
  },
  fields: [
    // Main configuration - always visible
    {
      name: 'sourceUrl',
      type: 'text',
      label: 'Source URL',
      required: true,
      admin: {
        description: 'URL that determines which driver to use (e.g., "https://ec.europa.eu/growth/tools-databases/cosing/")',
      },
    },
    jobStatusField,
    ...jobClaimFields,
    ...jobScheduleFields,
    {
      name: 'pagesPerTick',
      type: 'number',
      label: 'Batch Size',
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Max pages per batch (default: 10).',
      },
    },
    // Everything below only shows after creation
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Progress',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'discovered',
                  type: 'number',
                  label: 'Discovered',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
                {
                  name: 'created',
                  type: 'number',
                  label: 'Created',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
                {
                  name: 'existing',
                  type: 'number',
                  label: 'Existing',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
                {
                  name: 'errors',
                  type: 'number',
                  label: 'Errors',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '25%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'currentTerm',
                  type: 'text',
                  label: 'Current Term',
                  admin: {
                    readOnly: true,
                    width: '33%',
                  },
                },
                {
                  name: 'currentPage',
                  type: 'number',
                  label: 'Current Page',
                  admin: {
                    readOnly: true,
                    width: '33%',
                  },
                },
                {
                  name: 'totalPagesForTerm',
                  type: 'number',
                  label: 'Total Pages',
                  admin: {
                    readOnly: true,
                    width: '33%',
                  },
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
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
                {
                  name: 'completedAt',
                  type: 'date',
                  label: 'Completed At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: {
                      pickerAppearance: 'dayAndTime',
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Details',
          fields: [
            {
              name: 'termQueue',
              type: 'json',
              label: 'Term Queue',
              admin: {
                readOnly: true,
                description: 'Remaining search terms to process',
              },
            },
          ],
        },

        {
          label: 'Events',
          fields: [
            {
              name: 'events',
              type: 'join',
              collection: 'events',
              on: 'job',
            },
          ],
        },
      ],
      admin: {
        condition: (data) => !!data?.id,
      },
    },
  ],
}
