import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'

export const ProductDiscoveries: CollectionConfig = {
  slug: 'product-discoveries',
  labels: {
    singular: 'Product Discovery',
    plural: 'Product Discoveries',
  },
  admin: {
    useAsTitle: 'sourceUrls',
    defaultColumns: ['sourceUrls', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Jobs',
  },
  hooks: {
    beforeChange: [enforceJobClaim],
  },
  fields: [
    // Main configuration - always visible
    {
      name: 'sourceUrls',
      type: 'textarea',
      label: 'Source URLs',
      required: true,
      admin: {
        description: 'Category or product URLs, one per line. Product URLs (e.g. dm.de/...-p1234.html) create source products directly.',
      },
    },
    {
      name: 'status',
      type: 'select',
      label: 'Status',
      defaultValue: 'pending',
      options: [
        { label: 'Pending', value: 'pending' },
        { label: 'In Progress', value: 'in_progress' },
        { label: 'Completed', value: 'completed' },
        { label: 'Failed', value: 'failed' },
      ],
      index: true,
      admin: {
        position: 'sidebar',
      },
    },
    ...jobClaimFields,
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
    // Hidden field used by worker to track discovered URLs
    {
      name: 'productUrls',
      type: 'textarea',
      validate: () => true,
      admin: {
        hidden: true,
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
                    description: 'Products found on the page',
                    width: '33%',
                  },
                },
                {
                  name: 'created',
                  type: 'number',
                  label: 'Created',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'New products created',
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
                    description: 'Products already in database',
                    width: '33%',
                  },
                },
              ],
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
              name: 'discoveredProducts',
              type: 'join',
              collection: 'discovery-results',
              on: 'discovery',
              admin: { allowCreate: false },
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
      admin: {
        condition: (data) => !!data?.id,
      },
    },
  ],
}
