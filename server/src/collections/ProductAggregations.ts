import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'

export const ProductAggregations: CollectionConfig = {
  slug: 'product-aggregations',
  labels: {
    singular: 'Product Aggregation',
    plural: 'Product Aggregations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'aggregated', 'errors', 'startedAt'],
    group: 'Jobs',
  },
  hooks: {
    beforeChange: [enforceJobClaim],
  },
  fields: [
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
      name: 'scope',
      type: 'select',
      label: 'Scope',
      defaultValue: 'full',
      required: true,
      options: [
        { label: 'Full', value: 'full' },
        { label: 'Partial', value: 'partial' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Full: runs LLM classification (description, product type, attributes, claims), brand matching, ingredient matching, and image selection. ' +
          'Partial: only updates score history and basic product data (name, sources) — no LLM calls, no image downloads.',
      },
    },
    {
      name: 'itemsPerTick',
      type: 'number',
      label: 'Batch Size',
      defaultValue: 10,
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Products to aggregate per batch.',
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Configuration',
          fields: [
            {
              name: 'type',
              type: 'select',
              label: 'Type',
              required: true,
              defaultValue: 'selected_gtins',
              options: [
                { label: 'All Non-Aggregated', value: 'all' },
                { label: 'Selected GTINs', value: 'selected_gtins' },
              ],
            },
            {
              name: 'gtins',
              type: 'textarea',
              label: 'GTINs',
              admin: {
                description: 'GTINs to aggregate, one per line',
                condition: (data) => data?.type === 'selected_gtins',
              },
            },
            {
              name: 'language',
              type: 'select',
              label: 'Description Language',
              defaultValue: 'de',
              options: [
                { label: 'German', value: 'de' },
                { label: 'English', value: 'en' },
              ],
              admin: {
                description: 'Language for the generated product description.',
              },
            },
            {
              name: 'imageSourcePriority',
              type: 'json',
              label: 'Image Source Priority',
              defaultValue: ['dm', 'rossmann', 'mueller'],
              admin: {
                description:
                  'Ordered list of sources to prefer when selecting a product image. First source with images wins. Default: ["dm", "rossmann", "mueller"]',
              },
            },
          ],
        },
        {
          label: 'Progress',
          fields: [
            {
              name: 'total',
              type: 'number',
              label: 'Total',
              admin: {
                readOnly: true,
                description: 'Total products to aggregate',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'aggregated',
                  type: 'number',
                  label: 'Aggregated',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Products successfully aggregated',
                    width: '33%',
                  },
                },
                {
                  name: 'errors',
                  type: 'number',
                  label: 'Errors',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Products that failed to aggregate',
                    width: '33%',
                  },
                },
                {
                  name: 'tokensUsed',
                  type: 'number',
                  label: 'Tokens Used',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Total LLM tokens spent on ingredient matching',
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
              name: 'products',
              type: 'relationship',
              relationTo: 'products',
              hasMany: true,
              label: 'Aggregated Products',
              admin: {
                readOnly: true,
                description: 'Products created or updated by this aggregation',
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
    {
      name: 'lastCheckedSourceId',
      type: 'number',
      defaultValue: 0,
      admin: {
        hidden: true,
      },
    },
  ],
}
