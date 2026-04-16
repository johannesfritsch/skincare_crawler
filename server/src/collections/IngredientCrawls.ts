import type { CollectionConfig } from 'payload'
import { enforceJobClaim } from '@/hooks/enforceJobClaim'
import { createResetJobOnPending } from '@/hooks/resetJobOnPending'
import { jobRetryFields, jobClaimProgressFields, jobProgressFields } from '@/hooks/jobClaimFields'
import { jobStatusField, jobScheduleFields } from '@/hooks/jobScheduleFields'
import { computeScheduledFor, rescheduleOnComplete } from '@/hooks/rescheduleOnComplete'
import { deleteWorkItems } from '@/hooks/deleteWorkItems'

export const IngredientCrawls: CollectionConfig = {
  slug: 'ingredient-crawls',
  labels: {
    singular: 'Ingredient Crawl',
    plural: 'Ingredient Crawls',
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['id', 'type', 'status', 'crawled', 'errors', 'startedAt'],
    group: 'Ingredients',
    components: {
      edit: {
        SaveButton: '@/components/JobSaveButton',
      },
    },
  },
  hooks: {
    beforeChange: [enforceJobClaim, computeScheduledFor, createResetJobOnPending({
      total: null, completed: 0, errors: 0, tokensUsed: 0, lastCheckedIngredientId: 0,
    })],
    afterChange: [rescheduleOnComplete],
    afterDelete: [deleteWorkItems('ingredient-crawls')],
  },
  fields: [
    jobStatusField,
    ...jobRetryFields,
    ...jobScheduleFields,
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
            ...jobClaimProgressFields,
            ...jobProgressFields,
            {
              name: 'tokensUsed',
              type: 'number',
              label: 'Tokens Used',
              defaultValue: 0,
              admin: {
                readOnly: true,
                description: 'Total LLM tokens spent',
              },
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
