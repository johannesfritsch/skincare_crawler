import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'

export const ProductDiscoveries: CollectionConfig = {
  slug: 'product-discoveries',
  labels: {
    singular: 'Product Discovery',
    plural: 'Product Discoveries',
  },
  admin: {
    useAsTitle: 'sourceUrls',
    defaultColumns: ['sourceUrls', 'status', 'discovered', 'startedAt'],
    group: 'Source Products',
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor],
    afterChange: [rescheduleOnComplete],
  },
  fields: [
    jobStatusField,
    ...jobClaimFields,
    ...jobScheduleFields,
    {
      name: 'itemsPerTick',
      type: 'number',
      label: 'Batch Size',
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Max pages per batch. Empty = unlimited.',
      },
    },
    {
      name: 'delay',
      type: 'number',
      label: 'Delay (ms)',
      min: 0,
      admin: {
        position: 'sidebar',
        description: 'Milliseconds between requests. Default: 2000.',
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
    // Worker accumulates discovered URLs here; shown read-only on the Output tab
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
              name: 'sourceUrls',
              type: 'textarea',
              label: 'Source URLs',
              required: true,
              admin: {
                description:
                  'Category or product URLs, one per line. Product URLs (e.g. dm.de/...-p1234.html) create source products directly.',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            {
              name: 'discovered',
              type: 'number',
              label: 'URLs Discovered',
              defaultValue: 0,
              admin: {
                readOnly: true,
                description: 'Product URLs found',
              },
            },
            {
              name: 'progress',
              type: 'json',
              label: 'Progress State',
              admin: {
                readOnly: true,
                description: 'Internal state for resumable discovery',
              },
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
                      description: 'One URL per line, accumulated during discovery.',
                    },
                  },
                },
              },
            },
            {
              name: 'downloadUrls',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/components/DownloadDiscoveredUrlsButton',
                },
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
    },
  ],
}
