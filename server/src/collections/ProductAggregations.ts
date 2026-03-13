import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobClaimFields } from '@/hooks/jobClaimFields'
import { DEFAULT_IMAGE_SOURCE_PRIORITY } from './shared/store-fields'

export const ProductAggregations: CollectionConfig = {
  slug: 'product-aggregations',
  labels: {
    singular: 'Product Aggregation',
    plural: 'Product Aggregations',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'aggregated', 'errors', 'startedAt'],
    group: 'Products',
  },
  hooks: {
    beforeChange: [
      enforceJobClaim,
      createResetJobOnPending({
        total: null,
        aggregated: 0,
        errors: 0,
        tokensUsed: 0,
        aggregationProgress: null,
        products: [],
        lastCheckedSourceId: 0,
      }),
    ],
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
      name: 'startedAt',
      type: 'date',
      label: 'Started At',
      admin: {
        readOnly: true,
        position: 'sidebar',
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
        position: 'sidebar',
        date: {
          pickerAppearance: 'dayAndTime',
        },
      },
    },
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Source',
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
              name: 'includeSisterVariants',
              type: 'checkbox',
              label: 'Include Sister Variants',
              defaultValue: true,
              admin: {
                description:
                  'When enabled, automatically discovers and groups all sibling GTINs that share a source-product. ' +
                  'For example, if you enter the GTIN for a 50ml moisturizer, the 100ml variant will also be included ' +
                  'and both will become variants of the same unified product.',
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
              defaultValue: DEFAULT_IMAGE_SOURCE_PRIORITY,
              admin: {
                description:
                  'Ordered list of source slugs to prefer when selecting a product image. First source with images wins.',
              },
            },
            {
              name: 'minBoxArea',
              type: 'number',
              label: 'Min Detection Box Area (%)',
              defaultValue: 5,
              min: 0,
              max: 100,
              admin: {
                description:
                  'Minimum detection box area as a percentage of the source image area. ' +
                  'Detections smaller than this are discarded as background noise. Default: 5%.',
              },
            },
          ],
        },
        {
          label: 'Stages',
          fields: [
            {
              type: 'row',
              fields: [
                {
                  name: 'stageResolve',
                  type: 'checkbox',
                  label: 'Resolve',
                  defaultValue: true,
                  admin: {
                    description: 'Find/create products + variants from GTINs, merge duplicates, aggregate basic data.',
                    width: '25%',
                  },
                },
                {
                  name: 'stageClassify',
                  type: 'checkbox',
                  label: 'Classify',
                  defaultValue: true,
                  admin: {
                    description: 'LLM classification: product type, attributes, claims, warnings, pH, usage.',
                    width: '25%',
                  },
                },
                {
                  name: 'stageMatchBrand',
                  type: 'checkbox',
                  label: 'Match Brand',
                  defaultValue: true,
                  admin: {
                    description: 'LLM brand matching to the brands collection.',
                    width: '25%',
                  },
                },
                {
                  name: 'stageIngredients',
                  type: 'checkbox',
                  label: 'Ingredients',
                  defaultValue: true,
                  admin: {
                    description: 'LLM ingredient parsing + matching per variant.',
                    width: '25%',
                  },
                },
              ],
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'stageImages',
                  type: 'checkbox',
                  label: 'Images',
                  defaultValue: true,
                  admin: {
                    description: 'Download best image per variant and upload to media.',
                    width: '25%',
                  },
                },
                {
                  name: 'stageObjectDetection',
                  type: 'checkbox',
                  label: 'Object Detection',
                  defaultValue: true,
                  admin: {
                    description: 'Grounding DINO detection of cosmetics packaging + crop per variant.',
                    width: '25%',
                  },
                },
                {
                  name: 'stageEmbedImages',
                  type: 'checkbox',
                  label: 'Embed Images',
                  defaultValue: true,
                  admin: {
                    description: 'CLIP embedding vectors for recognition image crops (for visual similarity search).',
                    width: '25%',
                  },
                },
                {
                  name: 'stageDescriptions',
                  type: 'checkbox',
                  label: 'Descriptions',
                  defaultValue: true,
                  admin: {
                    description: 'LLM consensus description + deduplicated labels per variant.',
                    width: '25%',
                  },
                },
                {
                  name: 'stageScoreHistory',
                  type: 'checkbox',
                  label: 'Score History',
                  defaultValue: true,
                  admin: {
                    description: 'Compute store + creator scores and prepend to score history.',
                    width: '25%',
                  },
                },
              ],
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
                    description: 'Stage-executions successfully completed',
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
                    description: 'Stage-executions that failed',
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
                    description: 'Total LLM tokens consumed',
                    width: '33%',
                  },
                },
              ],
            },
          ],
        },
        {
          label: 'Aggregation Progress',
          fields: [
            {
              name: 'aggregationProgress',
              type: 'json',
              label: 'Aggregation Progress',
              admin: {
                readOnly: true,
                description: 'Maps product IDs to last completed stage name. Example: { "42": "resolve", "43": "classify" }',
              },
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
