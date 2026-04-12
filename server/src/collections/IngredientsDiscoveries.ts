import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
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
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      completed: 0, errors: 0, total: null, created: 0, existing: 0,
      currentTerm: '', currentPage: null, totalPagesForTerm: null, termQueue: null,
    })],
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
    ...jobRetryFields,
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
            ...jobClaimProgressFields,
            ...jobProgressFields,
            {
              type: 'row',
              fields: [
                {
                  name: 'created',
                  type: 'number',
                  label: 'Created',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    width: '33%',
                  },
                },
                {
                  name: 'existing',
                  type: 'number',
                  label: 'Existing',
                  defaultValue: 0,
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
              name: 'eventsView',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/EventsView',
                },
              },
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
