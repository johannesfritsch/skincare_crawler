import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'
import { SOURCE_OPTIONS, ALL_SOURCE_SLUGS } from './shared/store-fields'

export const ProductSearches: CollectionConfig = {
  slug: 'product-searches',
  labels: {
    singular: 'Product Search',
    plural: 'Product Searches',
  },
  admin: {
    useAsTitle: 'query',
    defaultColumns: ['query', 'sources', 'status', 'discovered', 'startedAt'],
    group: 'Source Products',
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      completed: 0, errors: 0, productUrls: '',
    })],
    afterChange: [rescheduleOnComplete],
  },
  fields: [
    jobStatusField,
    ...jobRetryFields,
    ...jobScheduleFields,
    {
      name: 'maxResults',
      type: 'number',
      label: 'Max Results Per Source',
      min: 1,
      defaultValue: 50,
      admin: {
        position: 'sidebar',
        description: 'Maximum products to import per source. Default: 50.',
      },
    },
    {
      name: 'debug',
      type: 'checkbox',
      label: 'Debug Mode',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Keep browser visible (non-headless).',
      },
    },
    // Hidden field used by worker to track discovered URLs
    {
      name: 'productUrls',
      type: 'textarea',
      validate: () => true,
      admin: {
        hidden: true,
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Source',
          fields: [
            {
              name: 'isGtinSearch',
              type: 'checkbox',
              label: 'GTIN Search',
              defaultValue: true,
              admin: {
                description:
                  'When enabled, the query is treated as a GTIN and drivers filter results to only return exact GTIN matches.',
              },
            },
            {
              name: 'query',
              type: 'textarea',
              label: 'Search Queries',
              required: true,
              admin: {
                description:
                  'One query per line. Each line is searched independently across all selected stores.',
              },
            },
            {
              name: 'sources',
              type: 'select',
              label: 'Sources',
              hasMany: true,
              required: true,
              defaultValue: [...ALL_SOURCE_SLUGS],
              options: [...SOURCE_OPTIONS],
              admin: {
                description: 'Which stores to search. All selected by default.',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            ...jobClaimProgressFields,
            ...jobProgressFields,
          ],
        },
        {
          label: 'Output',
          fields: [
            {
              name: 'productUrlsDisplay',
              type: 'ui',
              admin: {
                components: {
                  Field: {
                    path: '@/components/JobOutputField',
                    clientProps: {
                      fieldName: 'productUrls',
                      label: 'Discovered URLs',
                      description: 'One URL per line, accumulated during search.',
                    },
                  },
                },
              },
            },
            {
              name: 'downloadSearchedSourceUrls',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/DownloadSearchedGtinsButton',
                },
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
    },
  ],
}
