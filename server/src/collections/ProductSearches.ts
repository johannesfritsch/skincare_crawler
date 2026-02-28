import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'

export const ProductSearches: CollectionConfig = {
  slug: 'product-searches',
  labels: {
    singular: 'Product Search',
    plural: 'Product Searches',
  },
  admin: {
    useAsTitle: 'query',
    defaultColumns: ['query', 'sources', 'status', 'discovered', 'created', 'startedAt'],
    group: 'Products',
  },
  hooks: {
    beforeChange: [enforceJobClaim],
  },
  fields: [
    {
      name: 'query',
      type: 'text',
      label: 'Search Query',
      required: true,
      admin: {
        description: 'Product name, brand, or keyword to search for across selected stores.',
      },
    },
    {
      name: 'sources',
      type: 'select',
      label: 'Sources',
      hasMany: true,
      required: true,
      defaultValue: ['dm', 'mueller', 'rossmann'],
      options: [
        { label: 'dm', value: 'dm' },
        { label: 'Müller', value: 'mueller' },
        { label: 'Rossmann', value: 'rossmann' },
      ],
      admin: {
        description: 'Which stores to search. All selected by default.',
      },
    },
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
      name: 'debug',
      type: 'checkbox',
      label: 'Debug Mode',
      defaultValue: false,
      admin: {
        position: 'sidebar',
        description: 'Keep browser visible (non-headless).',
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
                    description: 'Products found across all sources',
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
              name: 'searchResults',
              type: 'join',
              collection: 'search-results',
              on: 'search',
              admin: { allowCreate: false },
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
