import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { jobClaimFields } from '@/hooks/jobClaimFields'

export const IngredientCrawls: CollectionConfig = {
  slug: 'ingredient-crawls',
  labels: {
    singular: 'Ingredient Crawl',
    plural: 'Ingredient Crawls',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'crawled', 'errors', 'startedAt'],
    group: 'Jobs',
  },
  hooks: {
    beforeChange: [enforceJobClaim],
  },
  fields: [
    ...jobClaimFields,
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
    {
      name: 'itemsPerTick',
      type: 'number',
      label: 'Batch Size',
      defaultValue: 10,
      min: 1,
      admin: {
        position: 'sidebar',
        description: 'Ingredients to process per batch.',
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
              defaultValue: 'all_uncrawled',
              options: [
                { label: 'All Uncrawled', value: 'all_uncrawled' },
                { label: 'Selected Ingredients', value: 'selected' },
              ],
            },
            {
              name: 'ingredientIds',
              type: 'relationship',
              relationTo: 'ingredients',
              hasMany: true,
              label: 'Ingredients',
              admin: {
                description: 'Specific ingredients to crawl',
                condition: (data) => data?.type === 'selected',
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
                description: 'Total ingredients to crawl',
              },
            },
            {
              type: 'row',
              fields: [
                {
                  name: 'crawled',
                  type: 'number',
                  label: 'Crawled',
                  defaultValue: 0,
                  admin: {
                    readOnly: true,
                    description: 'Ingredients successfully crawled',
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
                    description: 'Ingredients that failed',
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
                    description: 'Total LLM tokens spent',
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
                    date: { pickerAppearance: 'dayAndTime' },
                  },
                },
                {
                  name: 'completedAt',
                  type: 'date',
                  label: 'Completed At',
                  admin: {
                    readOnly: true,
                    width: '50%',
                    date: { pickerAppearance: 'dayAndTime' },
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
              name: 'ingredients',
              type: 'relationship',
              relationTo: 'ingredients',
              hasMany: true,
              label: 'Crawled Ingredients',
              admin: {
                readOnly: true,
                description: 'Ingredients enriched by this crawl',
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
      name: 'lastCheckedIngredientId',
      type: 'number',
      defaultValue: 0,
      admin: {
        hidden: true,
      },
    },
  ],
}
